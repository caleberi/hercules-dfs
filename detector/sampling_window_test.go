package failuredetector

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSamplingWindowClean(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test", 10, 30*time.Second, opts)
	require.NoError(t, err)
	defer sw.Close()

	ctx := context.Background()
	now := time.Now()

	for i := range 5 {
		entry := Entry{
			Id:       uuid.New().String(),
			Eta:      now.Add(time.Duration(-i) * time.Second),
			Duration: time.Second,
		}
		err := sw.Add(ctx, entry)
		assert.NoError(t, err)
	}

	card, err := sw.rdb.ZCard(ctx, sw.key+":main_set").Result()
	assert.NoError(t, err)
	assert.Equal(t, int64(5), card)

	expiredEntry := Entry{
		Id:       uuid.New().String(),
		Eta:      now.Add(-31 * time.Second),
		Duration: time.Second,
	}
	err = sw.Add(ctx, expiredEntry)
	assert.NoError(t, err)

	card, err = sw.rdb.ZCard(ctx, sw.key+":main_set").Result()
	assert.NoError(t, err)
	assert.Equal(t, int64(6), card)

	for i := range 6 {
		entry := Entry{
			Id:       uuid.New().String(),
			Eta:      now.Add(time.Duration(-i) * time.Second),
			Duration: time.Second,
		}
		err = sw.Add(ctx, entry)
		assert.NoError(t, err)
	}

	card, err = sw.rdb.ZCard(ctx, sw.key+":main_set").Result()
	assert.NoError(t, err)
	assert.LessOrEqual(t, card, int64(10), "Window size should be enforced")
}

func TestSamplingWindow_DefaultValues(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test", 0, time.Second, opts)
	require.NoError(t, err)
	defer sw.Close()
	assert.Equal(t, 10, sw.size, "Should default to 10")

	sw2, err := NewSamplingWindow[Entry]("test2", 5, 0, opts)
	require.NoError(t, err)
	defer sw2.Close()
	assert.Equal(t, time.Second, sw2.ttl, "Should default to 1 second")
}

func TestSamplingWindow_Get_EmptyWindow(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test-empty", 10, time.Second, opts)
	require.NoError(t, err)
	defer sw.Close()

	ctx := context.Background()
	entries, err := sw.Get(ctx)
	assert.NoError(t, err)
	assert.Empty(t, entries)
}

func TestSamplingWindow_Add_MultipleEntries(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test-multi", 5, time.Minute, opts)
	require.NoError(t, err)
	defer sw.Close()

	ctx := context.Background()
	now := time.Now()

	for i := range 7 {
		entry := Entry{
			Id:       uuid.New().String(),
			Eta:      now.Add(time.Duration(i) * time.Millisecond),
			Duration: time.Duration(i) * time.Millisecond,
		}
		err := sw.Add(ctx, entry)
		assert.NoError(t, err)
	}

	entries, err := sw.Get(ctx)
	assert.NoError(t, err)
	assert.LessOrEqual(t, len(entries), 5, "Should not exceed window size")
}

func TestSamplingWindow_Close(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test-close", 10, time.Second, opts)
	require.NoError(t, err)

	err = sw.Close()
	assert.NoError(t, err)

	// Verify connection is closed by attempting an operation
	ctx := context.Background()
	entry := Entry{Id: "test", Eta: time.Now(), Duration: time.Second}
	err = sw.Add(ctx, entry)
	assert.Error(t, err, "Should fail after close")
}

func TestSamplingWindow_ErrorHandling(t *testing.T) {
	mr := miniredis.RunT(t)
	opts := &redis.Options{Addr: mr.Addr()}

	sw, err := NewSamplingWindow[Entry]("test-error", 5, time.Second, opts)
	require.NoError(t, err)
	defer sw.Close()

	ctx := context.Background()

	entry := Entry{
		Id:       "test-1",
		Eta:      time.Now(),
		Duration: time.Second,
	}

	err = sw.Add(ctx, entry)
	assert.NoError(t, err)

	entries, err := sw.Get(ctx)
	assert.NoError(t, err)
	assert.Len(t, entries, 1)
}
