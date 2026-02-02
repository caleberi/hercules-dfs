# Archive Manager Design Documentation

## Overview

The Archive Manager is a concurrent compression/decompression service for the Hercules distributed file system. It implements a worker pool pattern to efficiently process multiple files in parallel using gzip compression.

## Architecture

### Design Patterns

#### 1. Worker Pool Pattern
The core architecture uses a worker pool to manage concurrent compression and decompression operations:

```
┌─────────────────┐
│  ArchiverManager│
├─────────────────┤
│                 │
│  ┌───────────┐  │     ┌──────────────┐
│  │Compress   │  │────▶│ Compress     │
│  │Pipeline   │  │     │ Workers (N/2)│
│  └───────────┘  │     └──────────────┘
│                 │
│  ┌───────────┐  │     ┌──────────────┐
│  │Decompress │  │────▶│ Decompress   │
│  │Pipeline   │  │     │ Workers (N/2)│
│  └───────────┘  │     └──────────────┘
│                 │
└─────────────────┘
```

**Benefits:**
- Efficient resource utilization
- Natural backpressure through buffered channels
- Scalable concurrent processing
- Clean separation of concerns

#### 2. Pipeline Pattern
Each operation type (compress/decompress) uses a pipeline with task and result channels:

```
Submit Task → Task Channel → Worker Pool → Result Channel → Consumer
```

**Benefits:**
- Asynchronous operation
- Decoupling of producers and consumers
- Built-in buffering and flow control

#### 3. Context-Based Lifecycle Management
Uses `context.Context` for graceful shutdown and cancellation:

```go
ctx, cancel := context.WithCancel(parentCtx)
```

**Benefits:**
- Coordinated shutdown across all workers
- Timeout support
- Cancellation propagation

## Component Design

### Core Components

#### ArchiverManager
**Responsibilities:**
- Lifecycle management (creation, shutdown)
- Worker coordination
- Pipeline management
- Thread-safe state tracking

**Key Fields:**
```go
type ArchiverManager struct {
    mu                 sync.RWMutex       // Protects isClosed flag
    CompressPipeline   CompressPipeline   // Compression operations
    DecompressPipeline DecompressPipeline // Decompression operations
    fileSystem         *FileSystem        // File operations
    ctx                context.Context    // Cancellation
    cancel             context.CancelFunc // Shutdown trigger
    wg                 sync.WaitGroup     // Worker tracking
    isClosed           bool               // Shutdown state
}
```

#### CompressPipeline / DecompressPipeline
**Responsibilities:**
- Task submission interface
- Result delivery
- Buffering and flow control

**Design:**
```go
type CompressPipeline struct {
    Task   chan common.Path  // Buffered task queue
    Result chan ResultInfo   // Buffered result queue
}
```

**Buffer Sizing:**
- Default: 10 items per channel
- Prevents blocking on bursty workloads
- Configurable via constants

### Concurrency Model

#### Thread Safety Mechanisms

1. **RWMutex for State Protection**
   ```go
   ac.mu.RLock()  // Read lock for checking state
   if ac.isClosed {
       ac.mu.RUnlock()
       return error
   }
   ac.mu.RUnlock()
   ```
   - Allows multiple concurrent reads (submissions)
   - Exclusive write lock only during shutdown
   - Minimizes contention

2. **Channel-Based Communication**
   - No shared mutable state between workers
   - Natural synchronization through channel operations
   - Type-safe message passing

3. **WaitGroup for Worker Tracking**
   - Ensures all workers complete before shutdown
   - Coordinates graceful termination
   - Timeout protection against hung workers

#### Worker Distribution

Workers are split evenly between compression and decompression:
```go
compressWorkers := numWorkers / 2    // Minimum 1
decompressWorkers := numWorkers - compressWorkers
```

**Rationale:**
- Balanced resource allocation
- Handles mixed workloads efficiently
- Prevents starvation of either operation type

#### Worker Lifecycle

```
Start → Wait for Task → Process → Send Result → Loop
  ↓                                              ↑
  └──────── Context Cancelled? ─────────────────┘
                    ↓
                 Exit
```

Each worker:
1. Waits on task channel or context cancellation
2. Processes file operation
3. Sends result (with timeout protection)
4. Returns to step 1 or exits on shutdown

### Error Handling Strategy

#### Layered Error Handling

1. **Operation Level**
   ```go
   if err != nil {
       cleanup()  // Resource cleanup
       return "", fmt.Errorf("operation failed for %s: %w", path, err)
   }
   ```
   - Immediate cleanup on failure
   - Error wrapping with context
   - Preserves error chain for debugging

2. **Pipeline Level**
   ```go
   Result <- ResultInfo{Path: newPath, Err: err}
   ```
   - Non-blocking error delivery
   - Errors don't block other operations
   - Consumer decides error handling policy

3. **Submission Level**
   ```go
   if ac.isClosed {
       return fmt.Errorf("archiver has been closed")
   }
   ```
   - Early validation
   - Descriptive error messages
   - Timeout protection

#### Resource Cleanup

**Principle:** Delete corrupted output, preserve source

**Compression Error Cleanup:**
```go
if err != nil {
    ac.fileSystem.RemoveFile(destinationPath)  // Delete corrupted .gz
    return "", fmt.Errorf("...")
}
// Success: Delete source
ac.fileSystem.RemoveFile(string(path))
```

**Decompression Error Cleanup:**
```go
if err != nil {
    ac.fileSystem.RemoveFile(uncompressedFilePath)  // Delete corrupted output
    return "", fmt.Errorf("...")
}
// Success: Delete compressed source
ac.fileSystem.RemoveFile(string(path))
```

**Rationale:**
- Prevents data loss (source preserved on error)
- Maintains filesystem consistency
- Idempotent operations

### Shutdown Design

#### Graceful Shutdown Sequence

```
1. Set isClosed flag (prevents new submissions)
2. Cancel context (signals workers to stop)
3. Close task channels (wakes up waiting workers)
4. Wait for workers with timeout
5. Close result channels
```

**Implementation:**
```go
func (ac *ArchiverManager) Close() {
    ac.mu.Lock()
    if ac.isClosed {
        ac.mu.Unlock()
        return  // Idempotent
    }
    ac.isClosed = true
    ac.mu.Unlock()
    
    ac.cancel()  // Signal workers
    close(ac.CompressPipeline.Task)
    close(ac.DecompressPipeline.Task)
    
    // Wait with timeout
    done := make(chan struct{})
    go func() {
        ac.wg.Wait()
        close(done)
    }()
    
    select {
    case <-done:
        // Clean shutdown
    case <-time.After(defaultShutdownTimeout):
        // Timeout - workers may be hung
    }
    
    close(ac.CompressPipeline.Result)
    close(ac.DecompressPipeline.Result)
}
```

**Features:**
- Idempotent (safe to call multiple times)
- Non-blocking with timeout
- Progressive shutdown (drain tasks first)
- Logged for observability

### Performance Considerations

#### Design Decisions

1. **Buffered Channels**
   - Reduces blocking on submission
   - Smooths bursty workloads
   - Trade-off: Memory vs. latency

2. **Read-Only Source Files**
   ```go
   sourceFile, err := ac.fileSystem.GetFile(string(path), os.O_RDONLY, 0644)
   ```
   - Prevents accidental corruption
   - Allows concurrent reads (if filesystem supports)
   - Safer error recovery

3. **Streaming I/O**
   ```go
   io.Copy(compressor, sourceFile)
   ```
   - Constant memory usage
   - Efficient for large files
   - CPU-bound (gzip) rather than memory-bound

4. **Worker Pool Sizing**
   - Configurable at creation
   - No runtime resizing (simplicity)
   - Caller determines optimal size based on workload

#### Benchmarking Strategy

Key metrics tracked:
- Operations per second
- Memory allocations per operation
- Throughput by file size
- Scalability with worker count

See `archiver_manager_test.go` benchmarks:
- `BenchmarkCompression` - Single operation performance
- `BenchmarkConcurrentSubmissions` - Scalability testing
- `BenchmarkArchiverLifecycle` - Overhead measurement

### Observability

#### Structured Logging

Using zerolog for low-overhead structured logging:

```go
log.Info().Int("workers", numWorkers).Msg("ArchiverManager started")
log.Debug().Str("path", path).Msg("Compression task submitted")
log.Warn().Err(err).Str("path", path).Msg("Failed to remove source file")
```

**Log Levels:**
- **Info:** Lifecycle events (start, shutdown)
- **Debug:** Task submissions, completions
- **Warn:** Non-critical errors (cleanup failures)

**Benefits:**
- Negligible performance impact
- Machine-parseable output
- Rich contextual information

## API Design

### Public Interface

#### Creation
```go
func NewArchiver(ctx context.Context, fileSystem *FileSystem, numWorkers int) *ArchiverManager
```
- Context for lifecycle management
- Filesystem dependency injection
- Configurable concurrency

#### Task Submission
```go
func (ac *ArchiverManager) SubmitCompress(path common.Path) error
func (ac *ArchiverManager) SubmitDecompress(path common.Path) error
```
- Asynchronous submission
- Non-blocking (with timeout)
- Error for invalid state

#### Result Consumption
```go
result := <-archiver.CompressPipeline.Result
result := <-archiver.DecompressPipeline.Result
```
- Consumer pulls results at own pace
- Backpressure naturally applied
- Type-safe result delivery

#### Cleanup
```go
func (ac *ArchiverManager) Close()
```
- Graceful shutdown
- Idempotent
- Timeout protected

### Usage Pattern

```go
// 1. Create
archiver := NewArchiver(ctx, filesystem, 8)
defer archiver.Close()

// 2. Submit tasks
go func() {
    for _, path := range paths {
        archiver.SubmitCompress(path)
    }
}()

// 3. Consume results
go func() {
    for result := range archiver.CompressPipeline.Result {
        if result.Err != nil {
            log.Error(result.Err)
        } else {
            log.Info("Compressed:", result.Path)
        }
    }
}()
```

## Configuration

### Tunable Constants

```go
const (
    zipExt                 = ".gz"
    defaultChannelBuffer   = 10
    defaultSubmitTimeout   = 5 * time.Second
    defaultShutdownTimeout = 10 * time.Second
)
```

**Tuning Guidelines:**

- **Channel Buffer:** Increase for bursty workloads, decrease to save memory
- **Submit Timeout:** Increase if workers are consistently slow
- **Shutdown Timeout:** Increase for large files or slow filesystems
- **Worker Count:** 2-4x CPU cores for I/O-bound, 1x for CPU-bound

## Testing Strategy

### Unit Tests
- Individual compression/decompression operations
- Error handling paths
- State management (isClosed flag)

### Integration Tests
- Full pipeline workflows
- Concurrent operations
- Graceful shutdown

### Benchmark Tests
- Performance regression detection
- Scalability validation
- Memory allocation tracking

## Future Enhancements

### Potential Improvements

1. **Compression Level Configuration**
   ```go
   compressor.Level = gzip.BestCompression  // vs. DefaultCompression
   ```

2. **Alternative Compression Formats**
   - Support for zstd, lz4, brotli
   - Format negotiation

3. **Metrics Collection**
   - Prometheus metrics
   - Operation counters
   - Latency histograms

4. **Adaptive Worker Pool**
   - Dynamic scaling based on load
   - CPU/memory usage monitoring

5. **Priority Queues**
   - Urgent vs. background tasks
   - Weighted fair queuing

6. **Compression Ratio Tracking**
   - Statistics on compression effectiveness
   - Automatic format selection

## Dependencies

- `compress/gzip` - Compression algorithm
- `github.com/rs/zerolog` - Structured logging
- `filesystem.FileSystem` - File operations abstraction

## Compatibility

- Go 1.18+ (uses generics in error handling)
- Thread-safe for concurrent use
- Context-aware for modern Go patterns

## References

- [Go Concurrency Patterns](https://go.dev/blog/pipelines)
- [Worker Pool Pattern](https://gobyexample.com/worker-pools)
- [Graceful Shutdown](https://pkg.go.dev/context)
