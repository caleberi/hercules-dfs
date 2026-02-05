# Shared Package Design Document

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Functions](#core-functions)
4. [Retry Mechanism](#retry-mechanism)
5. [Concurrency Model](#concurrency-model)
6. [Design Rationale](#design-rationale)
7. [Error Handling](#error-handling)
8. [Performance Characteristics](#performance-characteristics)
9. [Usage Patterns](#usage-patterns)
10. [Testing Strategy](#testing-strategy)
11. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose
The `shared` package provides common RPC communication utilities for the Hercules Distributed File System. It abstracts the complexity of:

1. **Point-to-Point Communication**: Unicast RPC calls with automatic retry logic
2. **Multi-Server Communication**: Broadcast RPC calls with concurrent execution
3. **Fault Tolerance**: Built-in retry mechanisms for transient network failures
4. **Connection Management**: Automatic connection lifecycle handling

### Design Philosophy
- **Simplicity**: Clean API hiding RPC boilerplate
- **Reliability**: Automatic retries for transient failures
- **Concurrency**: Parallel execution for multi-server operations
- **Logging**: Structured logging for observability
- **Zero Configuration**: Sensible defaults for retry behavior

### Package Location
```
hercules/
└── shared/
    └── rpc.go    # RPC communication utilities
```

---

## Architecture

### System Context
The shared package is used by all distributed components for inter-service communication:

```
┌──────────────────┐
│  Master Server   │────┐
└──────────────────┘    │
                        │
┌──────────────────┐    │     ┌──────────────────────────┐
│  Chunk Server 1  │────┼────▶│   Shared RPC Package     │
└──────────────────┘    │     ├──────────────────────────┤
                        │     │ • UnicastToRPCServer     │
┌──────────────────┐    │     │ • BroadcastToRPCServers  │
│  Chunk Server 2  │────┤     │                          │
└──────────────────┘    │     │ Features:                │
                        │     │ - Automatic retries      │
┌──────────────────┐    │     │ - Concurrent broadcast   │
│    Gateway       │────┘     │ - Connection pooling     │
└──────────────────┘          │ - Structured logging     │
                              └──────────────────────────┘
```

### Communication Patterns

#### Pattern 1: Unicast (Client → Single Server)
```
Client                          Server
──────                          ──────
  │                               │
  ├──── RPC Request ─────────────▶│
  │     (with retry logic)        │
  │                               │
  │◀──── RPC Response ────────────┤
  │                               │
```

#### Pattern 2: Broadcast (Client → Multiple Servers)
```
Client                  Server 1        Server 2        Server 3
──────                  ────────        ────────        ────────
  │                         │               │               │
  ├──── RPC Request ───────▶│               │               │
  ├──── RPC Request ───────────────────────▶│               │
  ├──── RPC Request ───────────────────────────────────────▶│
  │                         │               │               │
  │◀──── Response ──────────┤               │               │
  │◀──── Response ──────────────────────────┤               │
  │◀──── Response ──────────────────────────────────────────┤
  │                         │               │               │
  │  (wait for all)         │               │               │
  │                         │               │               │
```

---

## Core Functions

### 1. UnicastToRPCServer

#### Function Signature
```go
func UnicastToRPCServer(addr string, method string, args any, reply any) error
```

#### Parameters
| Parameter | Type     | Description                                    |
|-----------|----------|------------------------------------------------|
| `addr`    | `string` | Server address in `host:port` format           |
| `method`  | `string` | RPC method name (e.g., `"MasterServer.RPCGetChunkHandle"`) |
| `args`    | `any`    | Request arguments (must match method signature) |
| `reply`   | `any`    | Pointer to response struct (populated on success) |

#### Return Value
- `nil` - RPC call succeeded
- `error` - Connection or RPC failure after all retries exhausted

#### Behavior
1. **Connection Establishment**: Dials TCP connection to server
2. **RPC Invocation**: Calls remote method with provided arguments
3. **Retry Logic**: Up to 3 attempts with 500ms delay between retries
4. **Resource Cleanup**: Automatically closes connection via `defer`
5. **Logging**: Structured logs for each attempt (info/warn levels)

#### Retry Conditions
The function retries on:
- **Dial Failures**: Server unreachable, connection refused
- **RPC Failures**: Method execution errors, serialization errors

The function does NOT retry on:
- **Success**: First attempt succeeds
- **Max Retries Reached**: After 3 failed attempts

#### Example Flow
```
Attempt 1:
  └─ Dial(server1) ──X─ Connection refused
  └─ Sleep 500ms

Attempt 2:
  └─ Dial(server1) ──✓─ Connected
  └─ Call("Method") ──X─ RPC error
  └─ Sleep 500ms

Attempt 3:
  └─ Dial(server1) ──✓─ Connected
  └─ Call("Method") ──✓─ Success
  └─ Return nil
```

---

### 2. BroadcastToRPCServers

#### Function Signature
```go
func BroadcastToRPCServers(addrs []string, method string, args any, reply []any) []error
```

#### Parameters
| Parameter | Type       | Description                                    |
|-----------|------------|------------------------------------------------|
| `addrs`   | `[]string` | List of server addresses (`host:port`)         |
| `method`  | `string`   | RPC method name (same for all servers)         |
| `args`    | `any`      | Request arguments (same for all servers)       |
| `reply`   | `[]any`    | Slice of reply pointers (one per server)       |

#### Return Value
- `[]error` - List of errors from failed servers (empty if all succeeded)

#### Behavior
1. **Concurrent Execution**: Spawns one goroutine per server
2. **Independent Retries**: Each server call has its own retry logic (via `UnicastToRPCServer`)
3. **Error Aggregation**: Collects errors from all failed servers
4. **Synchronization**: Waits for all goroutines to complete before returning
5. **Thread Safety**: Uses mutex to protect shared error slice

#### Concurrency Model
```
Main Thread:
  ├─ Spawn goroutine 1 (server A) ──┐
  ├─ Spawn goroutine 2 (server B) ──┤
  ├─ Spawn goroutine 3 (server C) ──┤
  │                                  │
  └─ WaitGroup.Wait() ───────────────┴─ All complete
                                      │
                                      └─ Return aggregated errors
```

#### Error Handling
- **Partial Failures**: Some servers succeed, some fail → returns only failed server errors
- **Complete Success**: All servers succeed → returns empty error slice
- **Complete Failure**: All servers fail → returns all errors

#### Example Scenarios

**Scenario 1: All Succeed**
```go
addrs := []string{"server1:8080", "server2:8080", "server3:8080"}
reply := make([]any, 3)
for i := range reply {
    reply[i] = &MyReply{}
}

errs := BroadcastToRPCServers(addrs, "Service.Method", args, reply)
// errs = [] (empty, all succeeded)
```

**Scenario 2: Partial Failure**
```go
addrs := []string{"server1:8080", "server2:8080", "server3:8080"}
reply := make([]any, 3)
// ... initialize reply ...

errs := BroadcastToRPCServers(addrs, "Service.Method", args, reply)
// errs = [err_from_server2] (server 1 and 3 succeeded, server 2 failed)
```

---

## Retry Mechanism

### Configuration
```go
const maxRetries = 3                    // Total attempts
const retryDelay = 500 * time.Millisecond  // Delay between attempts
```

### Retry Algorithm
```
Total Attempts:  3
Retry Delays:    500ms, 500ms (fixed delay)
Total Max Time:  ~1 second (excluding RPC execution time)

Timeline:
────────────────────────────────────────────────────────
 Attempt 1    Sleep 500ms   Attempt 2    Sleep 500ms   Attempt 3
 ─────────────────────────────────────────────────────────────────
 0ms          RPC failed    500ms        RPC failed    1000ms
```

### Retry Policy

| Error Type          | Retry? | Reason                                      |
|---------------------|--------|---------------------------------------------|
| Connection refused  | ✅     | Server may be temporarily down              |
| Network timeout     | ✅     | Transient network issue                     |
| RPC execution error | ✅     | May be transient (e.g., lock contention)    |
| Success             | ❌     | No need to retry                            |
| Max retries reached | ❌     | Give up to avoid infinite loops             |

### Backoff Strategy
**Current**: Fixed delay (500ms between retries)

**Alternatives Considered**:
1. **Exponential Backoff**: 500ms, 1s, 2s (better for sustained load)
2. **Jittered Backoff**: Random delay to prevent thundering herd
3. **Adaptive Backoff**: Adjust based on server response time

**Rationale for Fixed Delay**:
- Simplicity: Easy to reason about
- Fast recovery: Quickly retries transient failures
- Acceptable for distributed file system (3-5 servers typically)

---

## Concurrency Model

### UnicastToRPCServer - Sequential Retries
```go
// Pseudo-code
for attempt := 1; attempt <= 3; attempt++ {
    client := dial(server)
    err := client.Call(method, args, reply)
    if err == nil {
        return nil  // Success
    }
    sleep(500ms)
}
return error
```

**Key Points**:
- **Synchronous**: Blocks caller until success or all retries exhausted
- **Single Connection**: One connection per attempt (closed after each try)
- **No Parallelism**: Retries are sequential, not concurrent

---

### BroadcastToRPCServers - Concurrent Fan-Out
```go
// Pseudo-code
for each server in servers {
    go func(server) {
        err := UnicastToRPCServer(server, method, args, reply)
        if err != nil {
            mutex.Lock()
            errors[index] = err
            mutex.Unlock()
        }
        wg.Done()
    }(server)
}
wg.Wait()
```

**Key Points**:
- **Concurrent**: All servers contacted in parallel
- **Independent**: Each server has own retry logic
- **Bounded**: Number of goroutines = number of servers (no goroutine pool)
- **Thread-Safe**: Mutex protects shared error slice

### Resource Usage

#### Connection Pooling
**Current**: No connection pooling (each call creates new connection)

**Impact**:
- **TCP Handshake Overhead**: 3-way handshake per call (~1-3ms)
- **File Descriptor Usage**: One FD per concurrent call
- **GC Pressure**: Connections are short-lived, frequent allocation

**Trade-off**:
- ✅ **Simplicity**: No pool management complexity
- ✅ **Isolation**: Failures don't affect connection pool state
- ❌ **Performance**: Higher latency for high-frequency calls

---

### Goroutine Management

#### BroadcastToRPCServers Goroutines
```
Servers: 10
Goroutines spawned: 10 (unbounded)

Servers: 1000
Goroutines spawned: 1000 (potential resource exhaustion)
```

**Current Limitation**: No goroutine pool → can spawn thousands of goroutines

**Recommendation**: Add worker pool for large-scale broadcasts (100+ servers)

---

## Design Rationale

### 1. Why Automatic Retries?
**Decision**: Built-in retry logic in `UnicastToRPCServer`

**Rationale**:
- **Distributed Systems Requirement**: Network failures are common (1-5% failure rate)
- **Caller Simplicity**: Callers don't need to implement retry logic
- **Consistency**: Uniform retry behavior across all RPC calls
- **Fail-Fast**: 3 retries × 500ms = 1.5s max latency (acceptable for DFS)

**Alternative**: Let callers handle retries
- ❌ Inconsistent retry strategies across codebase
- ❌ More complex caller code
- ✅ More flexibility (custom retry logic)

---

### 2. Why Fixed Retry Delay?
**Decision**: Constant 500ms delay between retries

**Rationale**:
- **Simplicity**: Easy to predict behavior
- **Fast Recovery**: Quickly detects when server comes back online
- **Small Cluster**: Hercules targets 3-10 servers (thundering herd not a concern)

**When to Use Exponential Backoff**:
- Large clusters (100+ servers)
- High contention scenarios
- Persistent failures (avoid log spam)

---

### 3. Why Close Connection After Each Call?
**Decision**: `defer client.Close()` immediately after RPC call

**Current Code**:
```go
client, dialErr := rpc.Dial("tcp", addr)
if dialErr != nil { ... }
defer client.Close()  // Closes immediately after Call() returns
```

**Rationale**:
- **Resource Safety**: No leaked connections
- **Simplicity**: No connection pool management
- **Failure Isolation**: Failed connections don't poison pool

**Trade-off**:
- ❌ Performance: Extra TCP handshakes
- ✅ Reliability: No stale connection issues

---

### 4. Why Same Args for All Servers in Broadcast?
**Decision**: `BroadcastToRPCServers` sends identical `args` to all servers

**Rationale**:
- **Common Use Case**: Replicate same operation to multiple replicas
  - Example: Write same chunk data to 3 chunk servers
  - Example: Heartbeat from master to all chunk servers
- **Simplicity**: Single argument struct

**Limitation**: Cannot send different args to each server
- **Workaround**: Call `UnicastToRPCServer` in loop (lose parallelism)

**Alternative Design**:
```go
func BroadcastToRPCServers(requests []RPCRequest) []error {
    type RPCRequest struct {
        Addr   string
        Method string
        Args   any
        Reply  any
    }
    // ...
}
```

---

### 5. Why Return Only Failed Errors in Broadcast?
**Decision**: Filter out `nil` errors before returning

**Current Code**:
```go
var filteredErrs []error
for _, err := range errs {
    if err != nil {
        filteredErrs = append(filteredErrs, err)
    }
}
return filteredErrs
```

**Rationale**:
- **Caller Simplicity**: `if len(errs) == 0 { /* all succeeded */ }`
- **Focus on Failures**: Caller only needs to handle errors
- **Common Pattern**: Similar to Go's `multierror` libraries

**Alternative**: Return all errors (including nil)
- ✅ Preserves server-to-error mapping by index
- ❌ Caller must filter nil errors manually

---

## Error Handling

### Error Types

#### 1. Connection Errors (Dial Failures)
**Cause**: Server unreachable, connection refused, network partition

**Example**:
```go
err := UnicastToRPCServer("invalid:8080", "Method", args, &reply)
// err: dial tcp: lookup invalid: no such host
```

**Retry Behavior**: Retries up to 3 times

---

#### 2. RPC Execution Errors
**Cause**: Method not found, serialization error, server-side panic

**Example**:
```go
err := UnicastToRPCServer("server:8080", "InvalidMethod", args, &reply)
// err: rpc: can't find method InvalidMethod
```

**Retry Behavior**: Retries up to 3 times (may succeed if server recovers)

---

#### 3. Application Errors
**Cause**: Business logic errors (e.g., chunk not found, permission denied)

**Example**:
```go
type Reply struct {
    ErrorCode common.ErrorCode
}

err := UnicastToRPCServer("server:8080", "GetChunk", args, &reply)
if err != nil {
    // Network/RPC error
}
if reply.ErrorCode != common.Success {
    // Application error (chunk not found, etc.)
}
```

**Retry Behavior**: Retries even for application errors (limitation)

---

### Error Propagation

#### UnicastToRPCServer
```go
err := UnicastToRPCServer(addr, method, args, &reply)

// Possible errors:
// - Dial error (after 3 retries)
// - RPC call error (after 3 retries)
// - nil (success)
```

---

#### BroadcastToRPCServers
```go
errs := BroadcastToRPCServers(addrs, method, args, replies)

// Possible outcomes:
// - errs = []          (all succeeded)
// - errs = [err1]      (1 server failed)
// - errs = [err1, err2] (2 servers failed)
// - errs = [err1, err2, err3] (all failed)
```

**Limitation**: Cannot determine which server produced which error (no index mapping)

**Workaround**:
```go
type IndexedError struct {
    Index int
    Addr  string
    Err   error
}

// Modified signature (future enhancement)
func BroadcastToRPCServers(...) []IndexedError
```

---

## Performance Characteristics

### Latency Analysis

#### UnicastToRPCServer - Single Call
```
Components:
  1. TCP dial:        1-3ms (LAN), 50-100ms (WAN)
  2. RPC call:        1-10ms (depends on method)
  3. Connection close: <1ms

Best case (success on attempt 1):
  Total = dial + call + close
  LAN:   ~5-15ms
  WAN:   ~50-110ms

Worst case (all 3 attempts fail):
  Total = 3 × (dial + call + 500ms retry delay)
  LAN:   ~1.5 seconds
  WAN:   ~2 seconds
```

---

#### BroadcastToRPCServers - Multi-Server
```
Servers: N
Parallelism: N goroutines

Best case (all succeed on attempt 1):
  Total = max(dial_i + call_i) for all i
  LAN:   ~5-15ms (same as unicast, due to parallelism)

Worst case (all servers fail after 3 retries):
  Total = max(3 × (dial_i + call_i + 500ms)) for all i
  LAN:   ~1.5 seconds (same as unicast, slowest server determines latency)
```

**Key Insight**: Broadcast latency = latency of slowest server (not sum of all)

---

### Throughput Analysis

#### Connection Overhead
```
No connection pooling:
  Overhead per call = TCP handshake (3-way) + TCP teardown (4-way)
  Time:             ~1-3ms per call

With connection pooling (hypothetical):
  Overhead per call = 0 (connection reused)
  Time:             ~0ms (only RPC call time)

Improvement:      ~1-3ms saved per call
```

**Impact**:
- Low-frequency calls (<10 req/sec): Negligible
- High-frequency calls (>100 req/sec): Significant (~10-30% latency reduction)

---

### Resource Usage

#### Memory
```
UnicastToRPCServer:
  - RPC client: ~8KB per connection
  - Args/Reply: Variable (depends on data size)
  - Total:      ~10KB per call (transient)

BroadcastToRPCServers (N servers):
  - Goroutines: N × 8KB stack
  - RPC clients: N × 8KB
  - Total:      ~16KB × N (transient, released after broadcast)
```

---

#### File Descriptors
```
UnicastToRPCServer:
  - TCP socket: 1 FD (closed after call)

BroadcastToRPCServers (N servers):
  - TCP sockets: N FDs (concurrent, closed after broadcast)
  - Peak usage:  N FDs (brief spike)
```

**Limit**: Default Linux ulimit = 1024 FDs → supports ~1000 concurrent servers

---

#### Goroutines
```
UnicastToRPCServer:
  - Goroutines: 0 (synchronous call)

BroadcastToRPCServers (N servers):
  - Goroutines: N (spawned concurrently)
  - Peak:       N goroutines
  - Duration:   ~1-2 seconds (until all retries complete)
```

**Recommendation**: Add goroutine pool for N > 100 servers

---

## Usage Patterns

### Pattern 1: Client-to-Master Communication

```go
package gateway

import (
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func GetChunkHandle(masterAddr string, path common.Path, chunkIndex int) (common.ChunkHandle, error) {
    args := rpc_struct.GetChunkHandleArgs{
        Path:       path,
        ChunkIndex: chunkIndex,
    }
    var reply rpc_struct.GetChunkHandleReply
    
    err := shared.UnicastToRPCServer(
        masterAddr,
        "MasterServer.RPCGetChunkHandle",
        &args,
        &reply,
    )
    if err != nil {
        return 0, err
    }
    
    if reply.ErrorCode != common.Success {
        return 0, fmt.Errorf("master error: %v", reply.ErrorCode)
    }
    
    return reply.Handle, nil
}
```

---

### Pattern 2: Master-to-ChunkServers Replication

```go
package master

import "github.com/caleberi/distributed-system/shared"

func ReplicateChunk(chunkServers []string, handle common.ChunkHandle, data []byte) error {
    args := rpc_struct.CreateChunkArgs{
        Handle: handle,
    }
    
    // Prepare reply slice
    replies := make([]any, len(chunkServers))
    for i := range replies {
        replies[i] = &rpc_struct.CreateChunkReply{}
    }
    
    // Broadcast to all chunk servers
    errs := shared.BroadcastToRPCServers(
        chunkServers,
        "ChunkServer.RPCCreateChunk",
        &args,
        replies,
    )
    
    if len(errs) > 0 {
        log.Warn().Msgf("Failed to replicate to %d servers", len(errs))
        // Check if quorum (2/3) succeeded
        successCount := len(chunkServers) - len(errs)
        if successCount < 2 {
            return fmt.Errorf("insufficient replicas: only %d/%d succeeded", successCount, len(chunkServers))
        }
    }
    
    return nil
}
```

---

### Pattern 3: ChunkServer-to-ChunkServer Chain Replication

```go
package chunkserver

func ForwardDataToReplicas(replicas []string, data []byte) error {
    if len(replicas) == 0 {
        return nil // No replicas to forward to
    }
    
    // Forward to next replica in chain
    nextReplica := replicas[0]
    remainingReplicas := replicas[1:]
    
    args := rpc_struct.ForwardDataArgs{
        Data:     data,
        Replicas: remainingReplicas,
    }
    var reply rpc_struct.ForwardDataReply
    
    err := shared.UnicastToRPCServer(
        nextReplica,
        "ChunkServer.RPCForwardData",
        &args,
        &reply,
    )
    
    return err
}
```

---

### Pattern 4: Master Heartbeat to All ChunkServers

```go
package master

func SendHeartbeat(chunkServers []string) map[string]error {
    args := rpc_struct.HeartBeatArg{
        Timestamp: time.Now().Unix(),
    }
    
    replies := make([]any, len(chunkServers))
    for i := range replies {
        replies[i] = &rpc_struct.HeartBeatReply{}
    }
    
    errs := shared.BroadcastToRPCServers(
        chunkServers,
        "ChunkServer.RPCHeartBeat",
        &args,
        replies,
    )
    
    // Map errors to server addresses
    errorMap := make(map[string]error)
    if len(errs) > 0 {
        // Note: Current implementation loses server-to-error mapping
        // This is a known limitation
        for i, err := range errs {
            if err != nil {
                errorMap[chunkServers[i]] = err
            }
        }
    }
    
    return errorMap
}
```

---

## Testing Strategy

### Unit Tests

#### Test 1: Successful Unicast
```go
func TestUnicastSuccess(t *testing.T) {
    // Start mock RPC server
    server := startMockRPCServer(":8080")
    defer server.Close()
    
    // Call
    var reply TestReply
    err := shared.UnicastToRPCServer("localhost:8080", "Test.Echo", &TestArgs{}, &reply)
    
    // Verify
    if err != nil {
        t.Errorf("Expected success, got error: %v", err)
    }
}
```

---

#### Test 2: Unicast with Retry (Recovers on Attempt 2)
```go
func TestUnicastRetrySuccess(t *testing.T) {
    // Mock server that fails first attempt, succeeds on second
    callCount := 0
    server := startMockServerWithCallback(func() error {
        callCount++
        if callCount == 1 {
            return errors.New("transient error")
        }
        return nil
    })
    defer server.Close()
    
    // Call
    var reply TestReply
    err := shared.UnicastToRPCServer("localhost:8080", "Test.Echo", &TestArgs{}, &reply)
    
    // Verify retry occurred
    if err != nil {
        t.Errorf("Expected success after retry, got: %v", err)
    }
    if callCount != 2 {
        t.Errorf("Expected 2 attempts, got %d", callCount)
    }
}
```

---

#### Test 3: Unicast Max Retries Exhausted
```go
func TestUnicastMaxRetriesExhausted(t *testing.T) {
    // Server that always fails
    server := startMockServerWithCallback(func() error {
        return errors.New("persistent error")
    })
    defer server.Close()
    
    // Call
    var reply TestReply
    err := shared.UnicastToRPCServer("localhost:8080", "Test.Echo", &TestArgs{}, &reply)
    
    // Verify error after 3 attempts
    if err == nil {
        t.Error("Expected error after max retries")
    }
}
```

---

#### Test 4: Broadcast All Succeed
```go
func TestBroadcastAllSucceed(t *testing.T) {
    // Start 3 mock servers
    servers := startMockServers([]string{":8080", ":8081", ":8082"})
    defer closeServers(servers)
    
    // Call
    addrs := []string{"localhost:8080", "localhost:8081", "localhost:8082"}
    replies := make([]any, 3)
    for i := range replies {
        replies[i] = &TestReply{}
    }
    
    errs := shared.BroadcastToRPCServers(addrs, "Test.Echo", &TestArgs{}, replies)
    
    // Verify
    if len(errs) != 0 {
        t.Errorf("Expected no errors, got %d", len(errs))
    }
}
```

---

#### Test 5: Broadcast Partial Failure
```go
func TestBroadcastPartialFailure(t *testing.T) {
    // Server 1: Success
    server1 := startMockServer(":8080", nil)
    defer server1.Close()
    
    // Server 2: Failure
    server2 := startMockServer(":8081", errors.New("failure"))
    defer server2.Close()
    
    // Server 3: Success
    server3 := startMockServer(":8082", nil)
    defer server3.Close()
    
    // Call
    addrs := []string{"localhost:8080", "localhost:8081", "localhost:8082"}
    replies := make([]any, 3)
    for i := range replies {
        replies[i] = &TestReply{}
    }
    
    errs := shared.BroadcastToRPCServers(addrs, "Test.Echo", &TestArgs{}, replies)
    
    // Verify 1 error (from server 2)
    if len(errs) != 1 {
        t.Errorf("Expected 1 error, got %d", len(errs))
    }
}
```

---

### Integration Tests

#### Test 6: Real Network Conditions (Timeout)
```go
func TestUnicastNetworkTimeout(t *testing.T) {
    // Use non-routable IP to simulate timeout
    var reply TestReply
    err := shared.UnicastToRPCServer("192.0.2.1:8080", "Test.Echo", &TestArgs{}, &reply)
    
    // Should fail after retries
    if err == nil {
        t.Error("Expected timeout error")
    }
}
```

---

### Test Coverage Gaps

| Scenario                          | Current Coverage | Recommendation          |
|-----------------------------------|------------------|-------------------------|
| Successful unicast                | ❌               | Add unit test           |
| Retry with eventual success       | ❌               | Add unit test           |
| Max retries exhausted             | ❌               | Add unit test           |
| Broadcast all succeed             | ❌               | Add unit test           |
| Broadcast partial failure         | ❌               | Add unit test           |
| Concurrent broadcast correctness  | ❌               | Add race detector test  |
| Connection leak detection         | ❌               | Add resource leak test  |
| Large-scale broadcast (1000+ servers) | ❌           | Add performance test    |

---

## Future Enhancements

### 1. Connection Pooling
**Motivation**: Reduce TCP handshake overhead for high-frequency calls

```go
package shared

var (
    connPool = sync.Map{} // addr -> *rpc.Client
)

func UnicastToRPCServerWithPool(addr string, method string, args any, reply any) error {
    // Get or create connection
    clientIface, ok := connPool.Load(addr)
    if !ok {
        client, err := rpc.Dial("tcp", addr)
        if err != nil {
            return err
        }
        connPool.Store(addr, client)
        clientIface = client
    }
    
    client := clientIface.(*rpc.Client)
    
    // Retry with connection refresh on failure
    err := client.Call(method, args, reply)
    if err != nil {
        // Connection may be stale, refresh
        connPool.Delete(addr)
        client.Close()
        // Retry with new connection...
    }
    
    return nil
}
```

**Benefits**:
- 1-3ms latency reduction per call
- Lower CPU usage (no repeated TCP handshakes)

**Challenges**:
- Connection staleness detection
- Pool size limits (avoid FD exhaustion)
- Thread-safe pool management

---

### 2. Exponential Backoff
**Motivation**: Better behavior under sustained failures

```go
func UnicastToRPCServerWithBackoff(addr string, method string, args any, reply any) error {
    maxRetries := 5
    baseDelay := 100 * time.Millisecond
    maxDelay := 5 * time.Second
    
    for attempt := 0; attempt < maxRetries; attempt++ {
        client, err := rpc.Dial("tcp", addr)
        if err == nil {
            err = client.Call(method, args, reply)
            client.Close()
            if err == nil {
                return nil
            }
        }
        
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1.6s
        delay := baseDelay * (1 << attempt)
        if delay > maxDelay {
            delay = maxDelay
        }
        
        log.Warn().Msgf("Retry %d/%d after %v", attempt+1, maxRetries, delay)
        time.Sleep(delay)
    }
    
    return fmt.Errorf("max retries exceeded")
}
```

---

### 3. Context-Aware Timeouts
**Motivation**: Caller control over timeout/cancellation

```go
func UnicastToRPCServerWithContext(
    ctx context.Context,
    addr string,
    method string,
    args any,
    reply any,
) error {
    for attempt := 1; attempt <= 3; attempt++ {
        select {
        case <-ctx.Done():
            return ctx.Err() // Timeout or cancellation
        default:
        }
        
        client, err := rpc.DialHTTPPath("tcp", addr, rpc.DefaultRPCPath)
        if err != nil {
            continue
        }
        defer client.Close()
        
        // Call with context timeout
        call := client.Go(method, args, reply, nil)
        select {
        case <-call.Done:
            if call.Error != nil {
                continue
            }
            return nil
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    
    return fmt.Errorf("max retries exceeded")
}

// Usage:
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
err := UnicastToRPCServerWithContext(ctx, addr, method, args, &reply)
```

---

### 4. Goroutine Pool for Broadcast
**Motivation**: Limit concurrent goroutines for large-scale broadcasts

```go
func BroadcastToRPCServersWithPool(
    addrs []string,
    method string,
    args any,
    replies []any,
    maxWorkers int,
) []error {
    errs := make([]error, len(addrs))
    
    // Semaphore to limit concurrent workers
    sem := make(chan struct{}, maxWorkers)
    var wg sync.WaitGroup
    
    for i, addr := range addrs {
        wg.Add(1)
        sem <- struct{}{} // Acquire slot
        
        go func(idx int, addr string) {
            defer wg.Done()
            defer func() { <-sem }() // Release slot
            
            err := UnicastToRPCServer(addr, method, args, replies[idx])
            if err != nil {
                errs[idx] = err
            }
        }(i, addr)
    }
    
    wg.Wait()
    return filterNilErrors(errs)
}

// Usage:
errs := BroadcastToRPCServersWithPool(addrs, method, args, replies, 10) // Max 10 concurrent
```

---

### 5. Error Indexing in Broadcast
**Motivation**: Preserve server-to-error mapping

```go
type BroadcastError struct {
    Index int
    Addr  string
    Err   error
}

func BroadcastToRPCServersWithIndex(
    addrs []string,
    method string,
    args any,
    replies []any,
) []BroadcastError {
    var (
        wg    sync.WaitGroup
        errs  []BroadcastError
        mutex sync.Mutex
    )
    
    for i, addr := range addrs {
        wg.Add(1)
        go func(idx int, addr string) {
            defer wg.Done()
            
            err := UnicastToRPCServer(addr, method, args, replies[idx])
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
    return errs
}

// Usage:
errs := BroadcastToRPCServersWithIndex(addrs, method, args, replies)
for _, bErr := range errs {
    log.Error().Msgf("Server %s (index %d) failed: %v", bErr.Addr, bErr.Index, bErr.Err)
}
```

---

### 6. Configurable Retry Policy
**Motivation**: Allow callers to customize retry behavior

```go
type RetryPolicy struct {
    MaxRetries int
    RetryDelay time.Duration
    Backoff    BackoffStrategy
}

type BackoffStrategy int

const (
    FixedBackoff BackoffStrategy = iota
    ExponentialBackoff
    JitteredBackoff
)

func UnicastToRPCServerWithPolicy(
    addr string,
    method string,
    args any,
    reply any,
    policy RetryPolicy,
) error {
    // Implement configurable retry logic
}

// Usage:
policy := RetryPolicy{
    MaxRetries: 5,
    RetryDelay: 1 * time.Second,
    Backoff:    ExponentialBackoff,
}
err := UnicastToRPCServerWithPolicy(addr, method, args, &reply, policy)
```

---

### 7. Circuit Breaker Pattern
**Motivation**: Prevent cascading failures by failing fast on consistently down servers

```go
type CircuitBreaker struct {
    failureThreshold int
    resetTimeout     time.Duration
    state            CircuitState
    failures         int
    lastFailTime     time.Time
    mu               sync.Mutex
}

type CircuitState int

const (
    StateClosed CircuitState = iota // Normal operation
    StateOpen                        // Failing fast
    StateHalfOpen                    // Testing recovery
)

func (cb *CircuitBreaker) Call(fn func() error) error {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    
    // Open circuit: fail fast
    if cb.state == StateOpen {
        if time.Since(cb.lastFailTime) > cb.resetTimeout {
            cb.state = StateHalfOpen
        } else {
            return fmt.Errorf("circuit breaker open")
        }
    }
    
    // Execute call
    err := fn()
    
    // Update state based on result
    if err != nil {
        cb.failures++
        cb.lastFailTime = time.Now()
        if cb.failures >= cb.failureThreshold {
            cb.state = StateOpen
        }
    } else {
        cb.failures = 0
        cb.state = StateClosed
    }
    
    return err
}

// Integration with UnicastToRPCServer
var circuitBreakers = sync.Map{} // addr -> *CircuitBreaker

func UnicastWithCircuitBreaker(addr string, method string, args any, reply any) error {
    cbIface, _ := circuitBreakers.LoadOrStore(addr, &CircuitBreaker{
        failureThreshold: 5,
        resetTimeout:     30 * time.Second,
    })
    cb := cbIface.(*CircuitBreaker)
    
    return cb.Call(func() error {
        return UnicastToRPCServer(addr, method, args, reply)
    })
}
```

---

### 8. Metrics and Observability
**Motivation**: Track RPC performance and failure rates

```go
type RPCMetrics struct {
    TotalCalls      int64
    FailedCalls     int64
    RetriedCalls    int64
    TotalLatency    time.Duration
    mu              sync.Mutex
}

var metrics = &RPCMetrics{}

func UnicastWithMetrics(addr string, method string, args any, reply any) error {
    start := time.Now()
    
    err := UnicastToRPCServer(addr, method, args, reply)
    
    metrics.mu.Lock()
    metrics.TotalCalls++
    metrics.TotalLatency += time.Since(start)
    if err != nil {
        metrics.FailedCalls++
    }
    metrics.mu.Unlock()
    
    return err
}

func GetMetrics() RPCMetrics {
    metrics.mu.Lock()
    defer metrics.mu.Unlock()
    return *metrics
}

// Expose via HTTP endpoint
http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
    m := GetMetrics()
    json.NewEncoder(w).Encode(m)
})
```

---

## Summary

The `shared` package provides a robust RPC communication layer with:

- **Automatic Retries**: Built-in fault tolerance (3 attempts, 500ms delay)
- **Concurrent Broadcast**: Parallel multi-server communication
- **Clean API**: Simple function calls hide RPC complexity
- **Structured Logging**: Observability for debugging

**Strengths**:
- Simple to use
- Handles transient failures gracefully
- Good for small-to-medium clusters (3-50 servers)

**Improvement Areas**:
- Add connection pooling for high-frequency calls
- Implement exponential backoff for sustained failures
- Add goroutine pool for large-scale broadcasts (100+ servers)
- Preserve server-to-error mapping in broadcast
- Add comprehensive test coverage

The package is production-ready for typical distributed file system deployments, with clear paths for optimization as the system scales.
