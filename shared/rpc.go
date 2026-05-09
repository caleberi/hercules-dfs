package shared

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"net/rpc"
	"sync"
	"time"

	"github.com/caleberi/distributed-system/common"
	"github.com/rs/zerolog/log"
)

// RetryConfig configures dialing/call timeouts and retry behavior for RPC calls.
//
// Notes:
//   - Go's net/rpc does not support context cancellation directly; timeouts are
//     enforced by setting deadlines on the underlying net.Conn.
//   - Backoff is exponential with optional jitter to avoid coordinated retries.
type RetryConfig struct {
	// MaxRetries is the number of attempts including the initial try.
	MaxRetries int
	// RetryDelay is the base delay for exponential backoff.
	RetryDelay time.Duration
	// MaxBackoff caps the exponential backoff.
	MaxBackoff time.Duration
	// DialTimeout bounds the TCP dial time.
	DialTimeout time.Duration
	// CallTimeout bounds the overall RPC call time (including server handling).
	CallTimeout time.Duration
	// JitterFrac adds +/- jitter fraction to backoff delays (0 disables jitter).
	// Example: 0.2 means up to 20% jitter.
	JitterFrac float64
}

var DefaultRetryConfig = RetryConfig{
	MaxRetries:  3,
	RetryDelay:  500 * time.Millisecond,
	MaxBackoff:  5 * time.Second,
	DialTimeout: 2 * time.Second,
	CallTimeout: 10 * time.Second,
	JitterFrac:  0.2,
}

func calculateBackoff(attempt int, cfg RetryConfig) time.Duration {
	// attempt is 0-based for retries: 0 -> base, 1 -> 2*base, ...
	delay := cfg.RetryDelay * (1 << attempt)
	if cfg.MaxBackoff > 0 && delay > cfg.MaxBackoff {
		delay = cfg.MaxBackoff
	}
	if cfg.JitterFrac <= 0 {
		return delay
	}
	// Apply symmetric jitter in [1-j, 1+j].
	j := cfg.JitterFrac
	factor := 1 + ((rand.Float64()*2 - 1) * j)
	jittered := time.Duration(float64(delay) * factor)
	if jittered < 0 {
		return 0
	}
	return jittered
}

// UnicastToRPCServer sends an RPC request to a single server with automatic retries.
//
// Parameters:
//   - addr: Server address in "host:port" format (e.g., "localhost:8080")
//   - method: RPC method name in "Service.Method" format
//   - args: Request arguments (commonly a pointer to a struct)
//   - reply: Reply output (must be a pointer)
//   - config: Retry configuration
//
// Returns:
//   - nil: RPC succeeded
//   - error: Connection or RPC failure after all retries exhausted
func UnicastToRPCServer(addr string, method string, args any, reply any, config RetryConfig) error {
	return UnicastToRPCServerContext(context.Background(), addr, method, args, reply, config)
}

// UnicastToRPCServerContext is like UnicastToRPCServer but allows callers to bound
// total time via ctx. If ctx has a deadline, it is used as the connection deadline.
func UnicastToRPCServerContext(ctx context.Context, addr string, method string, args any, reply any, config RetryConfig) error {
	if config.MaxRetries <= 0 {
		config.MaxRetries = 1
	}
	if reply == nil {
		return errors.New("reply must be non-nil pointer")
	}

	var lastErr error
	for attempt := 0; attempt < config.MaxRetries; attempt++ {
		// Establish deadline for this attempt.
		deadline := time.Now().Add(config.CallTimeout)
		if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
			deadline = dl
		}

		dialer := net.Dialer{Timeout: config.DialTimeout}
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			lastErr = fmt.Errorf("dial %s: %w", addr, err)
		} else {
			_ = conn.SetDeadline(deadline)
			client := rpc.NewClient(conn)
			callErr := client.Call(method, args, reply)
			_ = client.Close()
			if callErr == nil {
				return nil
			}
			lastErr = fmt.Errorf("rpc call %s on %s: %w", method, addr, callErr)
		}

		if attempt < config.MaxRetries-1 {
			backoff := calculateBackoff(attempt, config)
			log.Warn().
				Int("attempt", attempt+1).
				Str("addr", addr).
				Str("method", method).
				Err(lastErr).
				Msg("RPC attempt failed; retrying")

			timer := time.NewTimer(backoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	return lastErr
}

// BroadcastError carries per-target error details for a broadcast RPC call.
type BroadcastError struct {
	Err   error
	Addr  string
	Index int
}

// BroadcastToRPCServers sends an RPC request to multiple servers concurrently.
//
// replies must be the same length as addrs, and each element must be a pointer
// to the reply value for the corresponding address.
func BroadcastToRPCServers(addrs []string, method string, args any, replies []any, config RetryConfig) []error {
	var (
		wg    sync.WaitGroup
		errs  []BroadcastError
		mutex sync.Mutex
	)

	if len(addrs) == 0 {
		return nil
	}
	if len(replies) != len(addrs) {
		return []error{fmt.Errorf("replies length (%d) must match addrs length (%d)", len(replies), len(addrs))}
	}

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

	return common.TransformSlice(errs, func(err BroadcastError) error { return err.Err })
}
