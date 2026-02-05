# Shared Package - User Guide

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [API Reference](#api-reference)
4. [Usage Patterns](#usage-patterns)
5. [Error Handling](#error-handling)
6. [Performance Tips](#performance-tips)
7. [Testing](#testing)
8. [FAQ](#faq)

---

## Overview

The `shared` package provides RPC communication utilities for distributed systems. It simplifies making remote procedure calls with automatic retry logic and concurrent broadcast capabilities.

### Features
- ✅ **Automatic Retries**: Built-in retry logic for transient failures
- ✅ **Concurrent Broadcast**: Send RPCs to multiple servers in parallel
- ✅ **Simple API**: Clean function calls, no boilerplate
- ✅ **Structured Logging**: Detailed logs for debugging

### Installation

```bash
import "github.com/caleberi/distributed-system/shared"
```

---

## Quick Start

### Example 1: Simple RPC Call

```go
package main

import (
    "fmt"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func main() {
    // Prepare request
    args := rpc_struct.GetChunkHandleArgs{
        Path:       "/file.txt",
        ChunkIndex: 0,
    }
    var reply rpc_struct.GetChunkHandleReply
    
    // Make RPC call (with automatic retries)
    err := shared.UnicastToRPCServer(
        "master-server:8080",
        "MasterServer.RPCGetChunkHandle",
        &args,
        &reply,
    )
    
    if err != nil {
        fmt.Printf("RPC failed: %v\n", err)
        return
    }
    
    fmt.Printf("Chunk handle: %d\n", reply.Handle)
}
```

---

### Example 2: Broadcast to Multiple Servers

```go
package main

import (
    "fmt"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func main() {
    // List of chunk servers
    servers := []string{
        "chunk-server-1:8080",
        "chunk-server-2:8080",
        "chunk-server-3:8080",
    }
    
    // Prepare request (same for all servers)
    args := rpc_struct.CreateChunkArgs{
        Handle: 12345,
    }
    
    // Prepare reply slice (one per server)
    replies := make([]any, len(servers))
    for i := range replies {
        replies[i] = &rpc_struct.CreateChunkReply{}
    }
    
    // Broadcast to all servers (concurrent)
    errs := shared.BroadcastToRPCServers(
        servers,
        "ChunkServer.RPCCreateChunk",
        &args,
        replies,
    )
    
    // Check results
    if len(errs) == 0 {
        fmt.Println("All servers succeeded")
    } else {
        fmt.Printf("%d servers failed\n", len(errs))
    }
}
```

---

## API Reference

### UnicastToRPCServer

Send RPC request to a single server with automatic retries.

#### Signature
```go
func UnicastToRPCServer(addr string, method string, args any, reply any) error
```

#### Parameters

| Parameter | Type     | Description                                          |
|-----------|----------|------------------------------------------------------|
| `addr`    | `string` | Server address in `host:port` format                 |
| `method`  | `string` | RPC method name (e.g., `"Service.Method"`)           |
| `args`    | `any`    | Pointer to request arguments struct                  |
| `reply`   | `any`    | Pointer to response struct (populated on success)    |

#### Returns
- `nil` - RPC succeeded
- `error` - Connection or RPC failure after all retries

#### Retry Behavior
- **Max Attempts**: 3
- **Retry Delay**: 500ms between attempts
- **Total Max Time**: ~1.5 seconds

#### Example

```go
// Define request/response
type EchoArgs struct {
    Message string
}

type EchoReply struct {
    Message string
}

// Make RPC call
args := EchoArgs{Message: "Hello"}
var reply EchoReply

err := shared.UnicastToRPCServer(
    "localhost:8080",
    "Echo.Say",
    &args,
    &reply,
)

if err != nil {
    log.Fatalf("RPC failed: %v", err)
}

fmt.Printf("Server replied: %s\n", reply.Message)
```

---

### BroadcastToRPCServers

Send RPC request to multiple servers concurrently.

#### Signature
```go
func BroadcastToRPCServers(addrs []string, method string, args any, reply []any) []error
```

#### Parameters

| Parameter | Type       | Description                                         |
|-----------|------------|-----------------------------------------------------|
| `addrs`   | `[]string` | List of server addresses (`host:port`)              |
| `method`  | `string`   | RPC method name (same for all servers)              |
| `args`    | `any`      | Pointer to request arguments (same for all servers) |
| `reply`   | `[]any`    | Slice of reply pointers (one per server)            |

#### Returns
- `[]error` - List of errors from failed servers (empty if all succeeded)

#### Behavior
- **Concurrency**: One goroutine per server (all run in parallel)
- **Retry Logic**: Each server gets 3 retry attempts independently
- **Wait Policy**: Blocks until all servers respond or timeout
- **Partial Failures**: Returns only errors from failed servers

#### Example

```go
// Server list
servers := []string{
    "10.0.0.1:8080",
    "10.0.0.2:8080",
    "10.0.0.3:8080",
}

// Prepare request
args := MyArgs{Value: 42}

// Prepare replies
replies := make([]any, len(servers))
for i := range replies {
    replies[i] = &MyReply{}
}

// Broadcast
errs := shared.BroadcastToRPCServers(
    servers,
    "Service.Method",
    &args,
    replies,
)

// Handle results
if len(errs) == 0 {
    fmt.Println("All servers succeeded")
} else {
    for _, err := range errs {
        log.Printf("Server error: %v", err)
    }
}

// Access individual replies
for i, replyIface := range replies {
    reply := replyIface.(*MyReply)
    fmt.Printf("Server %d returned: %v\n", i, reply.Result)
}
```

---

## Usage Patterns

### Pattern 1: Client-to-Master Metadata Request

```go
package client

import (
    "fmt"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
    "github.com/caleberi/distributed-system/common"
)

func GetChunkLocations(masterAddr string, path common.Path, chunkIndex int) ([]string, error) {
    // Prepare request
    args := rpc_struct.GetChunkHandleArgs{
        Path:       path,
        ChunkIndex: chunkIndex,
    }
    var handleReply rpc_struct.GetChunkHandleReply
    
    // Get chunk handle
    err := shared.UnicastToRPCServer(
        masterAddr,
        "MasterServer.RPCGetChunkHandle",
        &args,
        &handleReply,
    )
    if err != nil {
        return nil, fmt.Errorf("failed to get chunk handle: %w", err)
    }
    
    // Get replica locations
    replicaArgs := rpc_struct.RetrieveReplicasArgs{
        Handle: handleReply.Handle,
    }
    var replicaReply rpc_struct.RetrieveReplicasReply
    
    err = shared.UnicastToRPCServer(
        masterAddr,
        "MasterServer.RPCGetReplicas",
        &replicaArgs,
        &replicaReply,
    )
    if err != nil {
        return nil, fmt.Errorf("failed to get replicas: %w", err)
    }
    
    return replicaReply.Locations, nil
}
```

---

### Pattern 2: Master-to-ChunkServers Write Replication

```go
package master

import (
    "fmt"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func ReplicateChunk(chunkServers []string, handle int, data []byte) error {
    // Step 1: Forward data to all replicas
    forwardArgs := rpc_struct.ForwardDataArgs{
        Data:     data,
        Replicas: chunkServers[1:], // Chain replication
    }
    
    forwardReplies := make([]any, len(chunkServers))
    for i := range forwardReplies {
        forwardReplies[i] = &rpc_struct.ForwardDataReply{}
    }
    
    errs := shared.BroadcastToRPCServers(
        chunkServers,
        "ChunkServer.RPCForwardData",
        &forwardArgs,
        forwardReplies,
    )
    
    if len(errs) > 0 {
        return fmt.Errorf("data forward failed on %d servers", len(errs))
    }
    
    // Step 2: Commit write on all replicas
    writeArgs := rpc_struct.WriteChunkArgs{
        Handle: handle,
    }
    
    writeReplies := make([]any, len(chunkServers))
    for i := range writeReplies {
        writeReplies[i] = &rpc_struct.WriteChunkReply{}
    }
    
    errs = shared.BroadcastToRPCServers(
        chunkServers,
        "ChunkServer.RPCWriteChunk",
        &writeArgs,
        writeReplies,
    )
    
    // Check quorum (need 2/3 success)
    successCount := len(chunkServers) - len(errs)
    if successCount < 2 {
        return fmt.Errorf("write failed: only %d/%d replicas succeeded", 
            successCount, len(chunkServers))
    }
    
    return nil
}
```

---

### Pattern 3: Gateway Read with Fallback

```go
package gateway

import (
    "fmt"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func ReadChunk(replicas []string, handle int, offset int64, length int) ([]byte, error) {
    args := rpc_struct.ReadChunkArgs{
        Handle: handle,
        Offset: offset,
        Length: length,
    }
    
    // Try each replica until one succeeds
    for i, replica := range replicas {
        var reply rpc_struct.ReadChunkReply
        
        err := shared.UnicastToRPCServer(
            replica,
            "ChunkServer.RPCReadChunk",
            &args,
            &reply,
        )
        
        if err == nil && reply.ErrorCode == common.Success {
            fmt.Printf("Read succeeded from replica %d\n", i)
            return reply.Data, nil
        }
        
        fmt.Printf("Replica %d failed: %v, trying next...\n", i, err)
    }
    
    return nil, fmt.Errorf("all replicas failed")
}
```

---

### Pattern 4: Master Heartbeat to All ChunkServers

```go
package master

import (
    "time"
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
    "github.com/rs/zerolog/log"
)

func SendHeartbeats(chunkServers []string) {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    
    for range ticker.C {
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
        
        // Log failures
        if len(errs) > 0 {
            log.Warn().Msgf("Heartbeat failed for %d servers", len(errs))
            // Mark failed servers as down
            for i, err := range errs {
                if err != nil {
                    log.Error().Msgf("Server %s unreachable: %v", 
                        chunkServers[i], err)
                }
            }
        } else {
            log.Info().Msg("All chunk servers healthy")
        }
    }
}
```

---

### Pattern 5: ChunkServer Chain Replication

```go
package chunkserver

import (
    "github.com/caleberi/distributed-system/shared"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func ForwardToNextReplica(data []byte, replicas []string) error {
    if len(replicas) == 0 {
        return nil // End of chain
    }
    
    // Forward to next replica
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

## Error Handling

### Understanding Error Types

#### 1. Connection Errors
**Cause**: Server unreachable, network down, wrong address

```go
err := shared.UnicastToRPCServer("invalid-host:8080", "Method", args, &reply)
// err: dial tcp: lookup invalid-host: no such host
```

**Handling**:
```go
if err != nil {
    if strings.Contains(err.Error(), "dial tcp") {
        log.Error().Msg("Connection failed - check server address")
    }
}
```

---

#### 2. RPC Execution Errors
**Cause**: Method not found, serialization error

```go
err := shared.UnicastToRPCServer("server:8080", "WrongMethod", args, &reply)
// err: rpc: can't find method WrongMethod
```

**Handling**:
```go
if err != nil {
    if strings.Contains(err.Error(), "can't find method") {
        log.Error().Msg("RPC method not registered on server")
    }
}
```

---

#### 3. Application Errors
**Cause**: Business logic failures (handled via reply struct)

```go
type Reply struct {
    ErrorCode common.ErrorCode
    Data      []byte
}

var reply Reply
err := shared.UnicastToRPCServer("server:8080", "Method", args, &reply)

// Check RPC-level error
if err != nil {
    log.Fatal().Msgf("RPC failed: %v", err)
}

// Check application-level error
if reply.ErrorCode != common.Success {
    log.Error().Msgf("Application error: %v", reply.ErrorCode)
}
```

---

### Handling Broadcast Errors

#### Scenario 1: All Succeed
```go
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

if len(errs) == 0 {
    log.Info().Msg("All servers succeeded")
}
```

---

#### Scenario 2: Partial Failure (Quorum Check)
```go
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

successCount := len(servers) - len(errs)
requiredQuorum := (len(servers) / 2) + 1

if successCount >= requiredQuorum {
    log.Info().Msgf("Quorum achieved: %d/%d", successCount, len(servers))
} else {
    log.Error().Msgf("Quorum failed: only %d/%d", successCount, len(servers))
    return fmt.Errorf("insufficient replicas")
}
```

---

#### Scenario 3: Complete Failure
```go
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

if len(errs) == len(servers) {
    log.Fatal().Msg("All servers failed - system unavailable")
}
```

---

### Retry Exhaustion

```go
// Unicast retries 3 times automatically
err := shared.UnicastToRPCServer(addr, method, args, &reply)

if err != nil {
    // Error after 3 attempts (~1.5 seconds)
    log.Error().Msgf("Giving up after retries: %v", err)
}
```

---

## Performance Tips

### 1. Pre-allocate Reply Slices

**Inefficient**:
```go
var replies []any
for range servers {
    replies = append(replies, &MyReply{}) // Multiple allocations
}
```

**Optimized**:
```go
replies := make([]any, len(servers)) // Single allocation
for i := range replies {
    replies[i] = &MyReply{}
}
```

---

### 2. Use Broadcast for Parallel Operations

**Sequential (Slow)**:
```go
for _, server := range servers {
    var reply MyReply
    err := shared.UnicastToRPCServer(server, method, &args, &reply)
    // Total time: N × RPC_time
}
```

**Parallel (Fast)**:
```go
replies := make([]any, len(servers))
for i := range replies {
    replies[i] = &MyReply{}
}

errs := shared.BroadcastToRPCServers(servers, method, &args, replies)
// Total time: max(RPC_time) (fastest server determines latency)
```

---

### 3. Check Reply ErrorCode Before Processing

```go
type Reply struct {
    ErrorCode common.ErrorCode
    Data      []byte
}

var reply Reply
err := shared.UnicastToRPCServer(addr, method, &args, &reply)

if err != nil {
    return err
}

// Always check ErrorCode
if reply.ErrorCode != common.Success {
    return fmt.Errorf("operation failed: %v", reply.ErrorCode)
}

// Safe to use reply.Data
processData(reply.Data)
```

---

### 4. Avoid Broadcast for Large Payloads

**Problem**: Same large payload sent to all servers

```go
largeData := make([]byte, 10*1024*1024) // 10 MB

args := MyArgs{Data: largeData}

// Sends 10 MB × N servers concurrently (high network load)
shared.BroadcastToRPCServers(servers, method, &args, replies)
```

**Alternative**: Unicast sequentially or use streaming

```go
// Sequential (lower network burst)
for _, server := range servers {
    var reply MyReply
    shared.UnicastToRPCServer(server, method, &args, &reply)
}
```

---

## Testing

### Unit Test: Mock RPC Server

```go
package mypackage

import (
    "net"
    "net/rpc"
    "testing"
    "github.com/caleberi/distributed-system/shared"
)

// Mock service
type MockService struct{}

func (m *MockService) Echo(args *EchoArgs, reply *EchoReply) error {
    reply.Message = args.Message
    return nil
}

type EchoArgs struct {
    Message string
}

type EchoReply struct {
    Message string
}

func TestUnicastSuccess(t *testing.T) {
    // Start mock server
    service := new(MockService)
    rpc.Register(service)
    
    listener, err := net.Listen("tcp", ":0")
    if err != nil {
        t.Fatal(err)
    }
    defer listener.Close()
    
    go rpc.Accept(listener)
    
    addr := listener.Addr().String()
    
    // Test RPC call
    args := EchoArgs{Message: "Hello"}
    var reply EchoReply
    
    err = shared.UnicastToRPCServer(addr, "MockService.Echo", &args, &reply)
    
    if err != nil {
        t.Errorf("Expected success, got error: %v", err)
    }
    
    if reply.Message != "Hello" {
        t.Errorf("Expected 'Hello', got '%s'", reply.Message)
    }
}
```

---

### Integration Test: Real Network

```go
func TestRealServer(t *testing.T) {
    // Assumes real server running at localhost:8080
    args := MyArgs{Value: 42}
    var reply MyReply
    
    err := shared.UnicastToRPCServer(
        "localhost:8080",
        "Service.Method",
        &args,
        &reply,
    )
    
    if err != nil {
        t.Skipf("Server not available: %v", err)
    }
    
    // Verify response
    if reply.Result != 84 {
        t.Errorf("Expected 84, got %d", reply.Result)
    }
}
```

---

## FAQ

### Q1: How many times does UnicastToRPCServer retry?
**A**: 3 attempts total with 500ms delay between retries.

```
Attempt 1 → Fail → Sleep 500ms
Attempt 2 → Fail → Sleep 500ms
Attempt 3 → Fail → Return error

Total time: ~1.5 seconds (excluding RPC execution time)
```

---

### Q2: What happens if a server is down during broadcast?
**A**: The server's goroutine retries 3 times, then the error is included in the returned error slice. Other servers continue independently.

```go
servers := []string{"good-server:8080", "down-server:8080", "good-server2:8080"}
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

// errs = [error from down-server]
// replies[0] and replies[2] contain valid responses
// replies[1] is unmodified (error occurred)
```

---

### Q3: Can I use different arguments for each server in broadcast?
**A**: No, `BroadcastToRPCServers` sends the same `args` to all servers. Use a loop with `UnicastToRPCServer` if you need different arguments:

```go
for i, server := range servers {
    args := differentArgsForEachServer[i]
    var reply MyReply
    
    go func(s string, a MyArgs) {
        shared.UnicastToRPCServer(s, method, &a, &reply)
    }(server, args)
}
```

---

### Q4: How do I know which server failed in a broadcast?
**A**: Current implementation doesn't preserve the server-to-error mapping. You can work around this by checking reply values:

```go
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

// Check individual replies
for i, replyIface := range replies {
    reply := replyIface.(*MyReply)
    if reply.ErrorCode != common.Success {
        log.Printf("Server %s failed: %v", servers[i], reply.ErrorCode)
    }
}
```

---

### Q5: What's the maximum number of servers for broadcast?
**A**: No hard limit, but practical limits:
- **File Descriptors**: ~1000 (default Linux ulimit)
- **Goroutines**: Limited by memory (~10,000-100,000)
- **Network**: Bandwidth and switch capacity

For >100 servers, consider implementing a goroutine pool.

---

### Q6: Can I customize retry delay or max retries?
**A**: Not currently. The values are hardcoded:

```go
const maxRetries = 3
const retryDelay = 500 * time.Millisecond
```

To customize, you'd need to implement your own retry logic or modify the package.

---

### Q7: Are connections reused across calls?
**A**: No, each call creates a new connection. This simplifies code but adds TCP handshake overhead (~1-3ms per call).

For high-frequency calls, consider implementing connection pooling (see [DESIGN.md](DESIGN.md#future-enhancements)).

---

### Q8: What happens if I pass nil as reply?
**A**: RPC will panic. Always pass a valid pointer:

```go
// Wrong
shared.UnicastToRPCServer(addr, method, args, nil) // PANIC

// Correct
var reply MyReply
shared.UnicastToRPCServer(addr, method, args, &reply)
```

---

### Q9: How can I timeout a long-running RPC?
**A**: Current implementation doesn't support timeouts. Workaround with channels:

```go
done := make(chan error, 1)

go func() {
    err := shared.UnicastToRPCServer(addr, method, args, &reply)
    done <- err
}()

select {
case err := <-done:
    // RPC completed
case <-time.After(5 * time.Second):
    // Timeout
    return fmt.Errorf("RPC timeout")
}
```

---

### Q10: Can I cancel an in-flight RPC?
**A**: No, the current implementation doesn't support cancellation. Once started, the RPC runs to completion or timeout.

Future enhancement: Add context support (see [DESIGN.md](DESIGN.md#future-enhancements)).

---

## Best Practices

### 1. Always Check Both RPC and Application Errors

```go
var reply MyReply
err := shared.UnicastToRPCServer(addr, method, args, &reply)

// Check RPC error
if err != nil {
    return fmt.Errorf("RPC failed: %w", err)
}

// Check application error
if reply.ErrorCode != common.Success {
    return fmt.Errorf("operation failed: %v", reply.ErrorCode)
}
```

---

### 2. Use Broadcast for Independent Operations

**Good**: Creating chunks on multiple servers (independent operations)
```go
shared.BroadcastToRPCServers(servers, "ChunkServer.RPCCreateChunk", args, replies)
```

**Bad**: Chain replication (dependent operations - use sequential unicast)
```go
// Don't broadcast - each server depends on previous
for _, server := range servers {
    shared.UnicastToRPCServer(server, "ChunkServer.RPCForwardData", args, &reply)
    args.NextServer = nextServer // Update for chain
}
```

---

### 3. Handle Partial Failures Gracefully

```go
errs := shared.BroadcastToRPCServers(servers, method, args, replies)

// Don't fail immediately
if len(errs) > 0 {
    log.Warn().Msgf("%d servers failed, but continuing...", len(errs))
}

// Check quorum
successCount := len(servers) - len(errs)
if successCount >= requiredQuorum {
    return nil // Acceptable
}

return fmt.Errorf("quorum not met")
```

---

### 4. Log RPC Failures with Context

```go
err := shared.UnicastToRPCServer(addr, method, args, &reply)
if err != nil {
    log.Error().
        Str("server", addr).
        Str("method", method).
        Msgf("RPC failed: %v", err)
}
```

---

### 5. Pre-allocate Reply Slices

```go
// Good
replies := make([]any, len(servers))
for i := range replies {
    replies[i] = &MyReply{}
}

// Bad
var replies []any
for range servers {
    replies = append(replies, &MyReply{})
}
```

---

## Summary

The `shared` package simplifies RPC communication in distributed systems:

- **Unicast**: Single server RPC with automatic retries
- **Broadcast**: Multi-server parallel RPC
- **Fault Tolerance**: Built-in retry logic (3 attempts, 500ms delay)
- **Simple API**: No RPC boilerplate

**Quick Reference**:
```go
// Single server
err := shared.UnicastToRPCServer(addr, method, &args, &reply)

// Multiple servers
errs := shared.BroadcastToRPCServers(addrs, method, &args, replies)
```

For detailed design and implementation, see [DESIGN.md](DESIGN.md).
