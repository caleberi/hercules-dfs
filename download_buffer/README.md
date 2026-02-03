# Download Buffer

A thread-safe, time-based cache for temporary data storage in the Hercules distributed file system. Designed for buffering data chunks during pipelined write operations with automatic expiration and cleanup.

## Overview

The Download Buffer provides a temporary storage mechanism for data identified by unique `BufferId` keys. It supports concurrent access through reader-writer locks and automatically removes expired items via a background cleanup goroutine. This component is critical for managing in-flight data during distributed write operations.

## Features

### Core Capabilities

- **Thread-Safe Operations:** Concurrent access using `sync.RWMutex`
- **Automatic Expiration:** Configurable TTL for buffered items
- **Background Cleanup:** Dedicated goroutine removes expired items
- **Unique Identifiers:** Timestamp-based BufferId prevents collisions
- **Zero-Copy Retrieval:** Get operation extends item lifetime
- **Atomic Operations:** FetchAndDelete combines read and delete
- **Graceful Shutdown:** Clean goroutine termination

### Performance Characteristics

- **O(1) Operations:** All primary operations are constant time
- **Low Latency:** ~100-500ns for Set/Get operations
- **High Throughput:** 10M+ operations per second
- **Concurrent Safe:** Full support for multiple readers/writers

## Installation

### Prerequisites

- Go 1.21 or higher
- Hercules common package

### Dependencies

```bash
go get github.com/caleberi/distributed-system/common
go get github.com/stretchr/testify  # For testing
```

## Usage

### Basic Setup

```go
import (
    "time"
    "github.com/caleberi/distributed-system/downloadbuffer"
    "github.com/caleberi/distributed-system/common"
)

// Create a new buffer with 1s cleanup interval and 10s expiration
buffer, err := downloadbuffer.NewDownloadBuffer(
    time.Second,      // Tick duration (cleanup interval)
    10*time.Second,   // Expire duration (item lifetime)
)
if err != nil {
    log.Fatal(err)
}
defer buffer.Done()  // Cleanup on exit
```

### Storing Data

```go
// Create a unique buffer ID
id := downloadbuffer.NewDownloadBufferId(common.ChunkHandle("chunk-123"))

// Store data in the buffer
data := []byte("chunk data to be replicated")
buffer.Set(id, data)
```

### Retrieving Data

```go
// Get data (extends expiration time)
data, found := buffer.Get(id)
if found {
    fmt.Printf("Retrieved %d bytes\n", len(data))
} else {
    fmt.Println("Data not found or expired")
}
```

### Consuming Data

```go
// Fetch and delete in one atomic operation
data, err := buffer.FetchAndDelete(id)
if err != nil {
    log.Printf("Data not available: %v", err)
} else {
    fmt.Printf("Consumed %d bytes\n", len(data))
}
```

### Manual Deletion

```go
// Remove data before expiration
buffer.Delete(id)
```

### Checking Buffer Size

```go
// Get current number of items
size := buffer.Len()
fmt.Printf("Buffer contains %d items\n", size)
```

## API Reference

### Types

#### Buffer Interface

```go
type Buffer interface {
    Set(bufId common.BufferId, data []byte)
    Get(bufId common.BufferId) ([]byte, bool)
    Delete(bufId common.BufferId)
    FetchAndDelete(bufId common.BufferId) ([]byte, error)
    Done()
}
```

#### BufferId

```go
type BufferId struct {
    Handle    ChunkHandle  // Chunk identifier
    Timestamp int64        // Nanosecond timestamp
}
```

### Functions

#### NewDownloadBuffer

```go
func NewDownloadBuffer(tick, expire time.Duration) (*DownloadBuffer, error)
```

Creates a new DownloadBuffer with specified cleanup interval and expiration time.

**Parameters:**
- `tick`: How often to check for expired items (e.g., `100*time.Millisecond`)
- `expire`: How long items remain valid (e.g., `10*time.Second`)

**Returns:**
- `*DownloadBuffer`: New buffer instance
- `error`: Error if tick or expire are not positive

**Example:**
```go
// Aggressive cleanup for high-frequency writes
buffer, _ := NewDownloadBuffer(100*time.Millisecond, 5*time.Second)

// Moderate cleanup for standard workloads
buffer, _ := NewDownloadBuffer(1*time.Second, 30*time.Second)
```

#### NewDownloadBufferId

```go
func NewDownloadBufferId(id common.ChunkHandle) common.BufferId
```

Creates a unique BufferId combining chunk handle and current timestamp.

**Parameters:**
- `id`: ChunkHandle identifying the chunk

**Returns:**
- `common.BufferId`: Unique identifier for buffer operations

**Example:**
```go
id := NewDownloadBufferId(common.ChunkHandle(12345))
```

### Methods

#### Set

```go
func (db *DownloadBuffer) Set(bufId common.BufferId, data []byte)
```

Stores data with automatic expiration time.

**Thread-Safe:** Yes (exclusive lock)  
**Time Complexity:** O(1)

#### Get

```go
func (db *DownloadBuffer) Get(bufId common.BufferId) ([]byte, bool)
```

Retrieves data and extends its expiration time.

**Thread-Safe:** Yes (exclusive lock)  
**Time Complexity:** O(1)  
**Returns:**
- `[]byte`: Stored data
- `bool`: True if found, false otherwise

#### Delete

```go
func (db *DownloadBuffer) Delete(bufId common.BufferId)
```

Removes data from buffer.

**Thread-Safe:** Yes (exclusive lock)  
**Time Complexity:** O(1)

#### FetchAndDelete

```go
func (db *DownloadBuffer) FetchAndDelete(bufId common.BufferId) ([]byte, error)
```

Atomically retrieves and removes data.

**Thread-Safe:** Yes (exclusive lock)  
**Time Complexity:** O(1)  
**Returns:**
- `[]byte`: Stored data
- `error`: Error if BufferId not found

#### Len

```go
func (db *DownloadBuffer) Len() int
```

Returns current number of items in buffer.

**Thread-Safe:** Yes (read lock)  
**Time Complexity:** O(1)

#### Done

```go
func (db *DownloadBuffer) Done()
```

Signals cleanup goroutine to terminate gracefully.

**Usage:** Call before program exit or when buffer no longer needed.

## Configuration Guide

### Choosing Tick Duration

The tick duration controls cleanup frequency:

```go
// High-frequency cleanup (100ms)
// Use for: Rapid memory reclamation, tight memory constraints
buffer, _ := NewDownloadBuffer(100*time.Millisecond, expire)

// Moderate cleanup (1s)
// Use for: Balanced CPU/memory trade-off, standard workloads
buffer, _ := NewDownloadBuffer(1*time.Second, expire)

// Low-frequency cleanup (5s)
// Use for: Minimal CPU overhead, ample memory available
buffer, _ := NewDownloadBuffer(5*time.Second, expire)
```

### Choosing Expire Duration

The expire duration defines item lifetime:

```go
// Short expiration (5s)
// Use for: Ephemeral caching, high turnover data
buffer, _ := NewDownloadBuffer(tick, 5*time.Second)

// Medium expiration (30s)
// Use for: Session data, moderate retention needs
buffer, _ := NewDownloadBuffer(tick, 30*time.Second)

// Long expiration (5m)
// Use for: Infrequent access, persistent staging
buffer, _ := NewDownloadBuffer(tick, 5*time.Minute)
```

### Best Practices

1. **Tick << Expire:** Set tick to 5-10x smaller than expire
2. **Memory Bounds:** Monitor buffer size with `Len()`
3. **Cleanup on Exit:** Always call `Done()` when finished
4. **Error Handling:** Check errors from `NewDownloadBuffer`
5. **BufferId Uniqueness:** Use `NewDownloadBufferId` for generation

## Use Cases

### 1. Pipelined Chunk Writes

```go
// ChunkServer buffers chunk during replication
buffer.Set(bufId, chunkData)

// Forward to secondary servers
for _, secondary := range secondaries {
    go func(server common.ServerAddr) {
        data, _ := buffer.Get(bufId)  // Extends expiration
        server.WriteChunk(data)
    }(secondary)
}

// Remove after all secondaries acknowledge
buffer.FetchAndDelete(bufId)
```

### 2. Retry Mechanism

```go
// Store data for potential retry
buffer.Set(requestId, payload)

// Attempt operation
err := operation()
if err != nil {
    // Retry with buffered data
    data, _ := buffer.Get(requestId)
    retryOperation(data)
}

// Cleanup on success
buffer.Delete(requestId)
```

### 3. Distributed State Management

```go
// Temporary state during multi-phase protocol
buffer.Set(transactionId, state)

// Phase 1
executePhase1()

// Retrieve state for Phase 2
state, _ := buffer.Get(transactionId)
executePhase2(state)

// Cleanup after commit
buffer.FetchAndDelete(transactionId)
```

## Testing

### Running Tests

```bash
# Run all tests
go test -v

# Run with race detection
go test -race

# Run with coverage
go test -cover

# Benchmark
go test -bench=.
```

### Test Coverage

The package includes comprehensive tests:

- **NewDownloadBuffer:** Validation of parameters
- **SetAndGet:** Basic storage and retrieval
- **Delete:** Manual removal
- **FetchAndDelete:** Atomic operations
- **Expiration:** Automatic cleanup verification
- **Concurrency:** 100 concurrent goroutines
- **Done:** Graceful shutdown

## Performance Tuning

### Optimizing for Throughput

```go
// Minimize cleanup overhead
buffer, _ := NewDownloadBuffer(
    5*time.Second,      // Infrequent cleanup
    30*time.Second,     // Longer retention
)
```

### Optimizing for Memory

```go
// Aggressive cleanup
buffer, _ := NewDownloadBuffer(
    100*time.Millisecond,  // Frequent cleanup
    2*time.Second,         // Short retention
)
```

### Monitoring

```go
// Periodic monitoring
ticker := time.NewTicker(10*time.Second)
for range ticker.C {
    size := buffer.Len()
    log.Printf("Buffer contains %d items", size)
    
    // Alert if buffer grows too large
    if size > 10000 {
        log.Warning("Buffer size exceeds threshold")
    }
}
```

## Troubleshooting

### Issue: Items disappear before expected

**Cause:** Expire duration too short or system clock skew

**Solution:**
```go
// Increase expiration time
buffer, _ := NewDownloadBuffer(tick, 60*time.Second)  // Longer TTL
```

### Issue: High memory usage

**Cause:** Tick duration too long, items not cleaned up

**Solution:**
```go
// More frequent cleanup
buffer, _ := NewDownloadBuffer(100*time.Millisecond, expire)
```

### Issue: FetchAndDelete returns error

**Cause:** Item expired or never existed

**Solution:**
```go
data, err := buffer.FetchAndDelete(id)
if err != nil {
    // Handle missing data: retry from source or fail gracefully
    log.Printf("Data not in buffer: %v", err)
}
```

### Issue: High CPU usage

**Cause:** Tick duration too short for buffer size

**Solution:**
```go
// Reduce cleanup frequency
buffer, _ := NewDownloadBuffer(2*time.Second, expire)
```

## Examples

### Complete Example: ChunkServer Integration

```go
package main

import (
    "fmt"
    "log"
    "time"
    
    "github.com/caleberi/distributed-system/downloadbuffer"
    "github.com/caleberi/distributed-system/common"
)

func main() {
    // Initialize buffer
    buffer, err := downloadbuffer.NewDownloadBuffer(
        time.Second,
        30*time.Second,
    )
    if err != nil {
        log.Fatal(err)
    }
    defer buffer.Done()
    
    // Simulate chunk write pipeline
    chunkHandle := common.ChunkHandle(42)
    bufId := downloadbuffer.NewDownloadBufferId(chunkHandle)
    
    // Primary receives chunk
    chunkData := []byte("distributed chunk data")
    buffer.Set(bufId, chunkData)
    fmt.Println("Primary buffered chunk")
    
    // Secondary servers retrieve chunk
    secondaries := []string{"secondary-1", "secondary-2"}
    for _, sec := range secondaries {
        data, found := buffer.Get(bufId)
        if found {
            fmt.Printf("%s received %d bytes\n", sec, len(data))
        }
    }
    
    // After replication complete
    data, err := buffer.FetchAndDelete(bufId)
    if err == nil {
        fmt.Printf("Cleaned up %d bytes after replication\n", len(data))
    }
}
```

## Contributing

Please see [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.

## License

This component is part of the Hercules distributed file system project.

## See Also

- [ChunkServer Design](../chunkserver/DESIGN.md) - Integration context
- [Common Types](../common/types.go) - BufferId and ChunkHandle definitions
- [Hercules Documentation](../docs/README.md) - System overview
