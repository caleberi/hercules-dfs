package failuredetector

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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

// addScript atomically:
//  1. Purges expired members (score < now - ttl)
//  2. Adds the new entry with score = now (data embedded as "id|json")
//  3. Trims oldest entries if the window exceeds its size cap
//
// Single round-trip. No separate expiry set or data keys needed.
var addScript = redis.NewScript(`
	local key   = KEYS[1]
	local now   = tonumber(ARGV[1])
	local ttlMs = tonumber(ARGV[2])
	local size  = tonumber(ARGV[3])
	local score = tonumber(ARGV[4])
	local data  = ARGV[5]

	redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttlMs)
	redis.call('ZADD', key, score, data)

	local card = redis.call('ZCARD', key)
	if card > size then
		redis.call('ZREMRANGEBYRANK', key, 0, card - size - 1)
	end

	return redis.status_reply('OK')
`)

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

func (sw *SamplingWindow[T]) Add(ctx context.Context, entry T) error {
	jsn, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal entry: %w", err)
	}

	now := time.Now().UnixMilli()
	member := entry.ID() + "|" + string(jsn)
	return addScript.Run(ctx, sw.rdb, []string{sw.key},
		now,                    // ARGV[1] — current time (ms), used for TTL purge
		sw.ttl.Milliseconds(),  // ARGV[2] — window TTL in ms
		sw.size,                // ARGV[3] — max window size
		float64(entry.Score()), // ARGV[4] — sort score for the new member
		member,                 // ARGV[5] — "id|json" payload
	).Err()
}

// Get retrieves all current entries in the sampling window.
// Returns entries in reverse chronological order (newest first).
// Uses a single ZRangeByScore call filtered to the live TTL range.
func (sw *SamplingWindow[T]) Get(ctx context.Context) ([]T, error) {
	minScore := time.Now().UnixMilli() - sw.ttl.Milliseconds()

	members, err := sw.rdb.ZRangeByScore(ctx, sw.key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", minScore),
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to query window: %w", err)
	}

	result := make([]T, 0, len(members))
	for i := len(members) - 1; i >= 0; i-- {
		raw := members[i]

		_, after, ok := strings.Cut(raw, "|")
		if !ok {
			return nil, fmt.Errorf("malformed member (missing separator): %q", raw)
		}

		var entry T
		if err := json.Unmarshal([]byte(after), &entry); err != nil {
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
