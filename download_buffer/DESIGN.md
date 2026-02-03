# Download Buffer Design Documentation

## Overview

The Download Buffer is a thread-safe, time-based caching component for the Hercules distributed file system. It provides temporary storage for data chunks during pipelined write operations, with automatic expiration and cleanup mechanisms to prevent memory leaks and manage resource utilization.

## Architecture

### Design Patterns

#### 1. Time-To-Live (TTL) Cache Pattern
The buffer implements a TTL-based cache with automatic expiration:

```
┌─────────────────────────────────────┐
│       DownloadBuffer                │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Buffer Map                 │  │
│  │   BufferId → BufferedItem    │  │
│  │                              │  │
│  │   Item: {                    │  │
│  │     data: []byte             │  │
│  │     expire: time.Time        │  │
│  │   }                          │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Background Cleanup         │  │
│  │   Ticker → Remove Expired    │  │
│  └──────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

**Benefits:**
- Automatic memory management
- Prevents stale data accumulation
- Configurable retention policies
- No manual cleanup required

#### 2. Reader-Writer Lock Pattern
Uses `sync.RWMutex` for concurrent access:

```
Read Operations (RLock):
├─ Expiration Scanning
└─ Length Checking

Write Operations (Lock):
├─ Set
├─ Delete
├─ FetchAndDelete
└─ Get (updates expiration)
```

**Benefits:**
- Multiple concurrent readers
- Exclusive writer access
- Optimal read performance
- Thread-safe operations

#### 3. Background Worker Pattern
A dedicated goroutine manages cleanup:

```
Main Goroutine              Background Worker
     │                            │
     ├─── NewDownloadBuffer ────→ │
     │                            │
     │                      ┌─────▼────────┐
     │                      │   Ticker     │
     │                      └─────┬────────┘
     │                            │
     │                      ┌─────▼────────┐
     │                      │ Clear Expired│
     │                      └─────┬────────┘
     │                            │
     │                         (loop)
     │                            │
     ├─── Done() ───────────────→ │
     │                      ┌─────▼────────┐
     │                      │   Shutdown   │
     │                      └──────────────┘
```

**Benefits:**
- Non-blocking cleanup
- Predictable resource usage
- Graceful shutdown
- Independent lifecycle

## Component Design

### Core Types

#### BufferId
Unique identifier for buffered data:

```go
type BufferId struct {
    Handle    ChunkHandle  // Chunk identifier
    Timestamp int64        // Nanosecond timestamp
}
```

**Design Rationale:**
- **ChunkHandle:** Links buffer entries to specific chunks
- **Timestamp:** Ensures uniqueness for repeated operations on same chunk
- **Nanosecond precision:** Prevents collisions in high-frequency operations

#### BufferedItem
Storage container with expiration metadata:

```go
type BufferedItem struct {
    data   []byte      // Stored byte array
    expire time.Time   // Absolute expiration time
}
```

**Design Rationale:**
- **Private fields:** Encapsulation prevents external manipulation
- **Absolute time:** Simplifies expiration checking vs relative duration
- **Byte slice:** Generic storage for any chunk data

#### DownloadBuffer
Main buffer implementation:

```go
type DownloadBuffer struct {
    buffer       map[BufferId]*BufferedItem
    expire, tick time.Duration
    mu           sync.RWMutex
    done         chan bool
}
```

**Key Design Decisions:**

| Field | Type | Purpose |
|-------|------|---------|
| `buffer` | `map[BufferId]*BufferedItem` | O(1) lookup, pointer avoids copy |
| `expire` | `time.Duration` | Configurable item lifetime |
| `tick` | `time.Duration` | Cleanup frequency control |
| `mu` | `sync.RWMutex` | Concurrent access protection |
| `done` | `chan bool` | Graceful shutdown signal |

## Operational Semantics

### Data Lifecycle

```
┌──────────┐
│   Set    │ ← Data enters buffer with expiration time
└────┬─────┘
     │
     ├─→ ┌──────────┐
     │   │   Get    │ ← Retrieves data, extends expiration
     │   └──────────┘
     │
     ├─→ ┌──────────┐
     │   │ Delete   │ ← Manual removal
     │   └──────────┘
     │
     ├─→ ┌──────────────────┐
     │   │ FetchAndDelete   │ ← Atomic read + remove
     │   └──────────────────┘
     │
     └─→ ┌──────────────────┐
         │   Expiration     │ ← Automatic cleanup
         └──────────────────┘
```

### Expiration Strategy

#### Lazy Expiration
Items remain in buffer until actively cleaned:

```go
// Cleanup function runs every tick duration
clearBuffer := func(downloadBuffer *DownloadBuffer) {
    // 1. Read phase: Identify expired items
    downloadBuffer.mu.RLock()
    for id, item := range downloadBuffer.buffer {
        if item.expire.Before(time.Now()) {
            expiredKeys = append(expiredKeys, id)
        }
    }
    downloadBuffer.mu.RUnlock()

    // 2. Write phase: Remove expired items
    downloadBuffer.mu.Lock()
    for _, key := range expiredKeys {
        delete(downloadBuffer.buffer, key)
    }
    downloadBuffer.mu.Unlock()
}
```

**Advantages:**
- Minimizes lock contention (separate read/write phases)
- Batch deletion efficiency
- Predictable performance characteristics

**Trade-offs:**
- Expired items persist until next tick
- Memory usage spikes before cleanup
- Not immediate reclamation

### Access Patterns

#### Set Operation
```
Client → Set(id, data)
           │
           ├─ Acquire write lock
           │
           ├─ Create BufferedItem
           │    ├─ data: input bytes
           │    └─ expire: now + buffer.expire
           │
           ├─ buffer[id] = item
           │
           └─ Release lock
```

**Time Complexity:** O(1)  
**Lock Type:** Exclusive write lock

#### Get Operation
```
Client → Get(id)
           │
           ├─ Acquire write lock (for expiration update)
           │
           ├─ Lookup buffer[id]
           │    │
           │    ├─ Found → Update expire time
           │    │           Return data, true
           │    │
           │    └─ Not Found → Return nil, false
           │
           └─ Release lock
```

**Time Complexity:** O(1)  
**Lock Type:** Exclusive write lock (expiration update)  
**Design Note:** Uses write lock to atomically update expiration

#### FetchAndDelete Operation
```
Client → FetchAndDelete(id)
           │
           ├─ Acquire write lock
           │
           ├─ Lookup buffer[id]
           │    │
           │    ├─ Found → Delete from buffer
           │    │           Return data, nil
           │    │
           │    └─ Not Found → Return nil, error
           │
           └─ Release lock
```

**Time Complexity:** O(1)  
**Lock Type:** Exclusive write lock  
**Use Case:** Consume data exactly once

## Concurrency Model

### Lock Acquisition Strategy

```
Operation          Lock Type     Duration         Contention Risk
─────────────────────────────────────────────────────────────────
Set                Write         Minimal          Medium
Get                Write         Minimal          Medium
Delete             Write         Minimal          Low
FetchAndDelete     Write         Minimal          Low
Len                Read          Instant          Negligible
Cleanup (scan)     Read          Variable         Low
Cleanup (delete)   Write         Short burst      Low
```

### Concurrency Safety Guarantees

1. **Mutual Exclusion:** Only one writer OR multiple readers at any time
2. **Atomicity:** Each operation is atomic with respect to the buffer state
3. **Visibility:** Changes are immediately visible after lock release
4. **Progress:** No deadlocks or livelocks possible
5. **Fairness:** RWMutex provides writer preference to prevent starvation

### Race Condition Prevention

#### Scenario 1: Concurrent Set/Get
```
Thread A: Set(id, data1)
Thread B: Get(id)

Timeline:
A: ├─ Lock ─┤
B:          ├─ Lock ─┤
Result: B either gets data1 or nil (consistent)
```

#### Scenario 2: Concurrent Get/Cleanup
```
Thread A: Get(id)
Thread B: Cleanup

Timeline (Get acquires lock first):
A: ├─ Lock ─┤ (extends expiration)
B:          ├─ RLock ─┤ (sees new expiration)
Result: Item not cleaned up (correct)
```

## Configuration Parameters

### Tick Duration
**Purpose:** Controls cleanup frequency  
**Typical Values:**
- High-frequency writes: 100ms - 500ms
- Moderate workload: 500ms - 2s
- Low-frequency access: 2s - 10s

**Trade-offs:**

| Short Tick (100ms) | Long Tick (10s) |
|--------------------|-----------------|
| ✓ Fast memory reclamation | ✓ Lower CPU overhead |
| ✓ Tight memory bounds | ✓ Fewer lock acquisitions |
| ✗ Higher CPU usage | ✗ Delayed cleanup |
| ✗ More lock contention | ✗ Higher peak memory |

### Expire Duration
**Purpose:** Defines item lifetime  
**Typical Values:**
- Ephemeral cache: 1s - 10s
- Session data: 10s - 60s
- Long-lived cache: 1m - 10m

**Considerations:**
- Should be >> tick duration (recommend 5-10x)
- Align with use case access patterns
- Balance memory vs availability

### Recommended Configurations

```go
// High-throughput pipelined writes
NewDownloadBuffer(100*time.Millisecond, 5*time.Second)

// Moderate distributed caching
NewDownloadBuffer(1*time.Second, 30*time.Second)

// Low-frequency staging area
NewDownloadBuffer(5*time.Second, 5*time.Minute)
```

## Integration Points

### ChunkServer Integration

```
Write Pipeline:
Client → ChunkServer → DownloadBuffer.Set(bufId, chunk)
                           │
                           ├─ Buffer chunk during replication
                           │
Secondary ←────────────────┴─ DownloadBuffer.Get(bufId)
   │                              │
   ├─ Process chunk               │
   │                              │
   └─ Acknowledge ─────────────→ DownloadBuffer.FetchAndDelete(bufId)
```

**Purpose in Hercules:**
- Temporary storage during pipelined chunk writes
- Decouples primary receive from secondary forwarding
- Enables retries without re-transmission from client
- Manages memory for in-flight writes

### Error Handling

#### Not Found Errors
```go
data, err := buffer.FetchAndDelete(id)
if err != nil {
    // Item expired or never existed
    // Retry from source or fail gracefully
}
```

#### Configuration Errors
```go
buffer, err := NewDownloadBuffer(0, 10*time.Second)
if err != nil {
    // Invalid parameters: tick and expire must be positive
}
```

## Performance Characteristics

### Time Complexity

| Operation | Average | Worst Case | Notes |
|-----------|---------|------------|-------|
| Set | O(1) | O(1) | Hash map insert |
| Get | O(1) | O(1) | Hash map lookup |
| Delete | O(1) | O(1) | Hash map delete |
| FetchAndDelete | O(1) | O(1) | Lookup + delete |
| Len | O(1) | O(1) | Map length |
| Cleanup | O(n) | O(n) | n = buffer size |

### Space Complexity

**Memory Usage:**
```
Total = n * (sizeof(BufferId) + sizeof(*BufferedItem) + data_size)

Where:
- n = number of items
- BufferId ≈ 16 bytes (8 bytes handle + 8 bytes timestamp)
- *BufferedItem = 8 bytes pointer
- BufferedItem ≈ 32 bytes (24 byte slice header + 8 byte time)
- data_size = variable chunk data
```

**Example:**
```
1000 items × 1KB chunks:
= 1000 × (16 + 8 + 32 + 1024) bytes
= 1000 × 1080 bytes
≈ 1.05 MB
```

### Benchmarks

Expected performance on modern hardware:

```
Operation              Ops/sec     Latency (p50)   Latency (p99)
─────────────────────────────────────────────────────────────────
Set                    10M+        100ns           500ns
Get                    10M+        100ns           500ns
Delete                 10M+        100ns           500ns
FetchAndDelete         10M+        150ns           600ns
Concurrent Set (10)    8M+         125ns           800ns
Cleanup (1000 items)   5K+         200μs           1ms
```

## Testing Strategy

### Unit Tests

1. **Basic Operations:** Set, Get, Delete, FetchAndDelete
2. **Edge Cases:** Non-existent IDs, empty buffer
3. **Expiration:** Items expire after configured duration
4. **Concurrency:** Multiple goroutines accessing buffer
5. **Lifecycle:** Done() properly shuts down cleanup goroutine
6. **Validation:** Invalid tick/expire durations rejected

### Test Coverage

```
downloadbuffer/
├─ download_buffer.go (100% coverage target)
│  ├─ NewDownloadBuffer
│  ├─ Set
│  ├─ Get
│  ├─ Delete
│  ├─ FetchAndDelete
│  ├─ Done
│  ├─ Len
│  └─ Background cleanup
└─ download_buffer_test.go
```

### Example Test Case

```go
t.Run("Concurrency", func(t *testing.T) {
    buffer, _ := NewDownloadBuffer(tick, expire)
    defer buffer.Done()

    var wg sync.WaitGroup
    numGoroutines := 100

    // Concurrent writes and reads
    for i := range numGoroutines {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            id := NewDownloadBufferId(ChunkHandle(i))
            buffer.Set(id, []byte("data"))
            data, ok := buffer.Get(id)
            assert.True(t, ok)
            assert.Equal(t, []byte("data"), data)
        }(i)
    }
    wg.Wait()
})
```

## Future Enhancements

### Potential Improvements

1. **Size-based Eviction**
   - Maximum buffer size limit
   - LRU eviction when size exceeded
   - Prevents unbounded memory growth

2. **Metrics & Monitoring**
   - Hit/miss rates
   - Eviction statistics
   - Memory usage tracking
   - Cleanup latency monitoring

3. **Persistence Option**
   - Spillover to disk for large items
   - Hybrid memory/disk buffer
   - Configurable thresholds

4. **Priority Levels**
   - Critical vs non-critical data
   - Different expiration policies
   - Priority-based eviction

5. **Sharding**
   - Multiple sub-buffers
   - Reduced lock contention
   - Better concurrent performance

6. **Compression**
   - Compress stored data
   - Reduce memory footprint
   - Trade CPU for memory

## References

- [Go sync.RWMutex Documentation](https://pkg.go.dev/sync#RWMutex)
- [Effective Go - Concurrency](https://go.dev/doc/effective_go#concurrency)
- [Cache Eviction Policies](https://en.wikipedia.org/wiki/Cache_replacement_policies)
- Hercules ChunkServer Design
- Google File System Paper (2003)
