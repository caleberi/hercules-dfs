package failuredetector

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Scorer interface {
	ID() string
	Score() int64
}

type SamplingWindow[T Scorer] struct {
	key  string
	size int
	ttl  time.Duration
	rdb  *redis.Client
}

// NewSamplingWindow creates a new Redis-backed sampling window.
//
// Parameters:
//   - key: Unique key prefix for Redis storage
//   - size: Maximum number of samples to retain (default: 10)
//   - ttl: Time-to-live for individual samples (default: 1 second)
//   - opts: Redis connection options
//
// Returns:
//   - Pointer to initialized SamplingWindow
//   - Error if Redis connection fails
func NewSamplingWindow[T Scorer](
	key string, size int, ttl time.Duration, opts *redis.Options) (*SamplingWindow[T], error) {
	if size <= 0 {
		size = 10
	}
	if ttl <= 0 {
		ttl = time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client := redis.NewClient(opts)
	if _, err := client.Ping(ctx).Result(); err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &SamplingWindow[T]{
		key:  key,
		size: size,
		ttl:  ttl,
		rdb:  client,
	}, nil
}

// clean removes expired entries and enforces window size limits.
// It performs cleanup in two phases:
//  1. Remove entries past their TTL
//  2. Remove oldest entries if window exceeds size limit
func (sw *SamplingWindow[T]) clean(ctx context.Context) error {
	windowKey := sw.key + ":main_set"
	expiredWindowKey := sw.key + ":expired_set"
	dataPrefix := sw.key + ":item:"

	card, err := sw.rdb.ZCard(ctx, windowKey).Result()
	if err != nil {
		return fmt.Errorf("failed to get window size: %w", err)
	}

	query := &redis.ZRangeBy{Min: "-inf", Max: fmt.Sprintf("%d", time.Now().UnixMilli())}
	expired, err := sw.rdb.ZRangeByScore(ctx, expiredWindowKey, query).Result()
	if err != nil {
		return fmt.Errorf("failed to query expired entries: %w", err)
	}

	if len(expired) > 0 {
		p := sw.rdb.Pipeline()
		for _, id := range expired {
			p.ZRem(ctx, expiredWindowKey, id)
			p.ZRem(ctx, windowKey, id)
			p.Del(ctx, dataPrefix+id)
		}
		if _, err := p.Exec(ctx); err != nil {
			return fmt.Errorf("failed to remove expired entries: %w", err)
		}
	}

	card, err = sw.rdb.ZCard(ctx, windowKey).Result()
	if err != nil {
		return fmt.Errorf("failed to get updated window size: %w", err)
	}

	if card > int64(sw.size) {
		numToRemove := card - int64(sw.size)
		oldest, err := sw.rdb.ZRange(ctx, windowKey, 0, numToRemove-1).Result()
		if err != nil {
			return fmt.Errorf("failed to query oldest entries: %w", err)
		}

		if len(oldest) > 0 {
			p := sw.rdb.Pipeline()
			for _, id := range oldest {
				p.ZRem(ctx, windowKey, id)
				p.ZRem(ctx, expiredWindowKey, id)
				p.Del(ctx, dataPrefix+id)
			}
			if _, err := p.Exec(ctx); err != nil {
				return fmt.Errorf("failed to enforce size limit: %w", err)
			}
		}
	}

	return nil
}

// Add inserts a new entry into the sampling window.
// Automatically cleans expired entries and enforces size limits.
func (sw *SamplingWindow[T]) Add(ctx context.Context, entry T) error {
	if err := sw.clean(ctx); err != nil {
		return err
	}

	jsn, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal entry: %w", err)
	}

	mainKey := sw.key + ":main_set"
	expKey := sw.key + ":expired_set"
	dataPrefix := sw.key + ":item:"
	member := entry.ID()
	score := float64(entry.Score())
	expScore := float64(time.Now().UnixMilli() + int64(sw.ttl.Milliseconds()))

	p := sw.rdb.Pipeline()
	p.Set(ctx, dataPrefix+member, jsn, 0)
	p.ZAdd(ctx, mainKey, redis.Z{Score: score, Member: member})
	p.ZAdd(ctx, expKey, redis.Z{Score: expScore, Member: member})
	if _, err := p.Exec(ctx); err != nil {
		return fmt.Errorf("failed to add entry: %w", err)
	}

	card, err := sw.rdb.ZCard(ctx, mainKey).Result()
	if err != nil {
		return fmt.Errorf("failed to get window size after add: %w", err)
	}

	if card > int64(sw.size) {
		numToRemove := card - int64(sw.size)
		oldest, err := sw.rdb.ZRange(ctx, mainKey, 0, numToRemove-1).Result()
		if err != nil {
			return fmt.Errorf("failed to query oldest for size enforcement: %w", err)
		}

		if len(oldest) > 0 {
			p = sw.rdb.Pipeline()
			for _, id := range oldest {
				p.ZRem(ctx, mainKey, id)
				p.ZRem(ctx, expKey, id)
				p.Del(ctx, dataPrefix+id)
			}
			if _, err := p.Exec(ctx); err != nil {
				return fmt.Errorf("failed to remove excess entries: %w", err)
			}
		}
	}

	return nil
}

// Get retrieves all current entries in the sampling window.
// Returns entries in reverse chronological order (newest first).
func (sw *SamplingWindow[T]) Get(ctx context.Context) ([]T, error) {
	if err := sw.clean(ctx); err != nil {
		return nil, err
	}

	mainKey := sw.key + ":main_set"
	dataPrefix := sw.key + ":item:"

	members, err := sw.rdb.ZRevRange(ctx, mainKey, 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get window members: %w", err)
	}

	if len(members) == 0 {
		return []T{}, nil
	}

	keys := make([]string, len(members))
	for i, member := range members {
		keys[i] = dataPrefix + member
	}

	values, err := sw.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get entry data: %w", err)
	}

	result := make([]T, 0, len(members))
	for _, val := range values {
		if val == nil {
			continue
		}

		jsStr, ok := val.(string)
		if !ok {
			continue
		}

		var entry T
		if err := json.Unmarshal([]byte(jsStr), &entry); err != nil {
			return nil, fmt.Errorf("failed to unmarshal entry: %w", err)
		}
		result = append(result, entry)
	}

	return result, nil
}

// Close closes the Redis connection.
func (sw *SamplingWindow[T]) Close() error {
	if sw.rdb != nil {
		return sw.rdb.Close()
	}
	return nil
}
