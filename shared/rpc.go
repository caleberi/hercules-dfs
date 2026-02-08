package shared

import (
	"net/rpc"
	"sync"
	"time"

	"github.com/caleberi/distributed-system/utils"
	"github.com/rs/zerolog/log"
)

type RetryConfig struct {
	MaxRetries int
	RetryDelay time.Duration
}

var DefaultRetryConfig = RetryConfig{
	MaxRetries: 3,
	RetryDelay: 500 * time.Millisecond,
}

func calculateBackoff(attempt int, baseDelay time.Duration) time.Duration {
	delay := baseDelay * (1 << attempt) // Exponential: 500ms, 1s, 2s, 4s
	maxDelay := 5 * time.Second
	if delay > maxDelay {
		return maxDelay
	}
	return delay
}

// UnicastToRPCServer sends an RPC request to a single server with automatic retries.
// It attempts up to 3 times with 500ms delay between attempts.
//
// Parameters:
//   - addr: Server address in "host:port" format (e.g., "localhost:8080")
//   - method: RPC method name in "Service.Method" format
//   - args: Pointer to request arguments struct
//   - reply: Pointer to response struct (populated on success)
//
// .  - config: Retry configuration
//
// Returns:
//   - nil: RPC succeeded
//   - error: Connection or RPC failure after all retries exhausted
//
// Retry behavior:
//   - Attempt 1: Immediate
//   - Attempt 2: After 500ms
//   - Attempt 3: After 1000ms total
//
// Example:
//
//	args := MyArgs{Value: 42}
//	var reply MyReply
//	err := UnicastToRPCServer("localhost:8080", "Service.Method", &args, &reply)
//	if err != nil {
//	    log.Fatal(err)
//	}
func UnicastToRPCServer[T, V any](addr string, method string, args T, reply V, config RetryConfig) error {
	var err error
	for attempt := 1; attempt <= config.MaxRetries; attempt++ {
		client, dialErr := rpc.Dial("tcp", addr)
		if dialErr != nil {
			if attempt == config.MaxRetries {
				return dialErr
			}
			time.Sleep(calculateBackoff(attempt, config.RetryDelay))
			continue
		}

		err = client.Call(method, args, reply)
		client.Close()

		if err == nil {
			return nil
		}
		if attempt < config.MaxRetries {
			time.Sleep(calculateBackoff(attempt, config.RetryDelay))
		}
		log.Warn().
			Int("attempt", attempt).
			Str("addr", addr).
			Str("method", method).
			Err(err).
			Msgf("RPC attempt failed")
	}
	return err
}

type BroadcastError struct {
	Index int
	Addr  string
	Err   error
}

// BroadcastToRPCServers sends an RPC request to multiple servers concurrently.
func BroadcastToRPCServers[T, V any](addrs []string, method string, args T, replies []V, config RetryConfig) []error {
	var (
		wg    sync.WaitGroup
		errs  []BroadcastError
		mutex sync.Mutex
	)

	for i, addr := range addrs {
		wg.Add(1)
		go func(idx int, addr string) {
			defer wg.Done()
			err := UnicastToRPCServer(addr, method, args, replies[idx], config)
			if err != nil {
				mutex.Lock()
				errs = append(errs, BroadcastError{
					Index: idx,
					Addr:  addr,
					Err:   err,
				})
				mutex.Unlock()
			}
		}(i, addr)
	}
	wg.Wait()

	return utils.TransformSlice(errs, func(err BroadcastError) error { return err.Err })
}
