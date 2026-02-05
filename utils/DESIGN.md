# Utils Package Design Document

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Data Structures](#data-structures)
5. [Functional Programming Utilities](#functional-programming-utilities)
6. [System Utilities](#system-utilities)
7. [Concurrency Model](#concurrency-model)
8. [Design Rationale](#design-rationale)
9. [Performance Characteristics](#performance-characteristics)
10. [Usage Patterns](#usage-patterns)
11. [Testing Strategy](#testing-strategy)
12. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose
The `utils` package provides foundational data structures and utility functions used throughout the Hercules Distributed File System. It serves as a common library offering:

1. **Concurrent Data Structures**: Thread-safe queue implementations for producer-consumer patterns
2. **Functional Programming Utilities**: Generic higher-order functions for collection manipulation
3. **System Utilities**: Cryptographic hashing, validation, and conversion functions
4. **Type-Safe Generics**: Leverage Go 1.18+ generics for type-safe, reusable components

### Design Philosophy
- **Zero External Dependencies**: Minimal reliance on third-party libraries (only `common` package)
- **Generic First**: Use Go generics to provide type-safe, reusable abstractions
- **Thread Safety**: Synchronization primitives for concurrent access patterns
- **Functional Style**: Immutable transformations and declarative data processing
- **Performance**: Optimized implementations with minimal allocation overhead

### Package Location
```
hercules/
└── utils/
    ├── queue.go          # Generic double-ended queue (deque)
    ├── queue_test.go     # Deque test suite
    ├── bqueue.go         # Blocking queue for producer-consumer
    ├── bqueue_test.go    # Blocking queue tests
    └── helpers.go        # Functional utilities and system helpers
```

---

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                         Utils Package                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Data Structures  │  │  Functional      │  │   System     │ │
│  │                   │  │  Utilities       │  │   Helpers    │ │
│  ├───────────────────┤  ├──────────────────┤  ├──────────────┤ │
│  │ • Deque[T]        │  │ • Map            │  │ • Sum        │ │
│  │ • BQueue[T]       │  │ • Filter         │  │ • Sample     │ │
│  │ • Node[T]         │  │ • Reduce         │  │ • Checksum   │ │
│  │                   │  │ • Find           │  │ • BToMb      │ │
│  │                   │  │ • GroupByKey     │  │ • Validate   │ │
│  │                   │  │ • ChunkSlice     │  │              │ │
│  │                   │  │ • ZipSlices      │  │              │ │
│  └───────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Synchronization Layer                         │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ • sync.RWMutex (Deque)                                     │  │
│  │ • sync.Mutex + sync.Cond (BQueue)                          │  │
│  │ • Fine-grained locking for concurrent access               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### System Context
The utils package is used by multiple Hercules components:

```
┌─────────────────┐
│  Master Server  │──┐
└─────────────────┘  │
                     │
┌─────────────────┐  │         ┌─────────────────────┐
│  Chunk Server   │──┼────────▶│   Utils Package     │
└─────────────────┘  │         ├─────────────────────┤
                     │         │ • Deque[T]          │
┌─────────────────┐  │         │ • BQueue[T]         │
│    Gateway      │──┤         │ • Functional Utils  │
└─────────────────┘  │         │ • System Helpers    │
                     │         └─────────────────────┘
┌─────────────────┐  │
│  File System    │──┘
└─────────────────┘
```

---

## Core Components

### 1. Deque[T] - Generic Double-Ended Queue

#### Structure
```go
type Node[T any] struct {
    data T           // Payload
    next *Node[T]    // Forward pointer
    prev *Node[T]    // Backward pointer
}

type Deque[T any] struct {
    mu     sync.RWMutex  // Read-write lock for synchronization
    head   *Node[T]      // Front of the queue
    tail   *Node[T]      // Back of the queue
    length int64         // Current size
}
```

#### Key Operations
| Operation   | Time Complexity | Thread-Safe | Description                          |
|-------------|-----------------|-------------|--------------------------------------|
| PushFront   | O(1)            | ✅          | Insert at head                       |
| PushBack    | O(1)            | ✅          | Insert at tail                       |
| PopFront    | O(1)            | ✅          | Remove from head                     |
| PopBack     | O(1)            | ✅          | Remove from tail                     |
| Length      | O(1)            | ✅          | Get current size                     |
| PopAll      | O(n)            | ✅          | Drain entire queue to slice          |
| Print       | O(n)            | ❌          | Debug output (unsafe, read-only use) |

#### Concurrency Guarantees
- **Lock Type**: `sync.RWMutex` for read-write separation
- **Granularity**: Coarse-grained locking (entire deque locked per operation)
- **Atomic Updates**: Length, pointers updated atomically within critical section
- **Zero-Value Safety**: Returns zero value `T` when popping from empty queue

#### Example: Task Queue
```go
// Create a task queue for background processing
taskQueue := utils.Deque[func()]{}

// Producer goroutine
go func() {
    taskQueue.PushBack(func() { fmt.Println("Task 1") })
    taskQueue.PushBack(func() { fmt.Println("Task 2") })
    taskQueue.PushBack(func() { fmt.Println("Task 3") })
}()

// Consumer goroutine
go func() {
    for taskQueue.Length() > 0 {
        task := taskQueue.PopFront()
        if task != nil {
            task()
        }
        time.Sleep(100 * time.Millisecond)
    }
}()
```

---

### 2. BQueue[T] - Blocking Queue

#### Structure
```go
type BQueue[T comparable] struct {
    mu       sync.Mutex   // Exclusive access lock
    c        sync.Cond    // Condition variable for blocking
    data     []T          // Underlying slice storage
    capacity int          // Maximum size
}
```

#### Key Operations
| Operation        | Behavior                                      | Blocking   |
|------------------|-----------------------------------------------|------------|
| `Put(item T)`    | Add item to queue, blocks if full             | ✅ (Full)  |
| `Take() T`       | Remove item from queue, blocks if empty       | ✅ (Empty) |
| `isFull()`       | Check if queue at capacity (private)          | ❌         |
| `isEmpty()`      | Check if queue has no items (private)         | ❌         |

#### Concurrency Model
- **Producer-Consumer Pattern**: Classic bounded buffer implementation
- **Synchronization**: Uses `sync.Cond` for efficient blocking/waking
- **Fairness**: FIFO ordering, no priority handling
- **Capacity Enforcement**: Hard limit prevents unbounded memory growth

#### Blocking Behavior
```
Producer                        BQueue (capacity=2)              Consumer
────────                        ───────────────────              ────────
Put(A) ──────────────────────▶ [A]                              
                                                                 
Put(B) ──────────────────────▶ [A, B]                           
                                                                 
Put(C) ──────────────────────▶ [A, B] (FULL - blocks)           
                               │                                 
                               │ Wait on cond var                
                               │                                 
                                                   ◀────────── Take() → A
                                                                 
        ◀──────────────────── [B, C] (space available)          
        (wakes up, inserts C)                                    
```

#### Example: Request Buffering
```go
// Create a bounded buffer for HTTP requests
requestBuffer := utils.NewBlockingQueue[*http.Request](100)

// Producer: Accept incoming requests
go func() {
    for {
        req := acceptRequest()
        requestBuffer.Put(req) // Blocks if buffer full (backpressure)
    }
}()

// Consumer: Process requests
go func() {
    for {
        req := requestBuffer.Take() // Blocks if buffer empty
        processRequest(req)
    }
}()
```

---

## Functional Programming Utilities

### Collection Transformations

#### 1. Map / TransformSlice
**Purpose**: Transform each element in a collection

```go
// Function signature (old API)
func Map[T, V comparable](data []T, fn func(v T) V) []V

// Function signature (new API)
func TransformSlice[T, V any](slice []T, transform func(T) V) []V

// Example: Convert file paths to lengths
paths := []string{"/home/user/doc.txt", "/etc/config"}
lengths := TransformSlice(paths, func(p string) int { return len(p) })
// Result: [18, 11]
```

**Design Note**: Both `Map` and `TransformSlice` exist for backward compatibility. New code should use `TransformSlice` for its more descriptive naming.

---

#### 2. Filter / FilterSlice
**Purpose**: Select elements matching a predicate

```go
// Function signature (old API)
func Filter[T comparable](data []T, fn func(v T) bool) []T

// Function signature (new API)
func FilterSlice[T any](slice []T, predicate func(T) bool) []T

// Example: Filter valid chunk handles
handles := []common.ChunkHandle{1, -1, 5, 0, 10}
validHandles := FilterSlice(handles, func(h common.ChunkHandle) bool {
    return h > 0
})
// Result: [1, 5, 10]
```

---

#### 3. Reduce / ReduceSlice
**Purpose**: Combine all elements into a single value

```go
// Function signature
func ReduceSlice[T, V any](slice []T, initial V, accumulator func(V, T) V) V

// Example: Calculate total file size
files := []FileInfo{{Size: 100}, {Size: 250}, {Size: 50}}
totalSize := ReduceSlice(files, 0, func(acc int, f FileInfo) int {
    return acc + f.Size
})
// Result: 400
```

---

#### 4. ForEach / ForEachInSlice
**Purpose**: Execute a side effect for each element

```go
// Function signature (old API)
func ForEach[T any](data []T, fn func(v T))

// Function signature (new API)
func ForEachInSlice[T any](slice []T, action func(T))

// Example: Log all server addresses
servers := []string{"192.168.1.1:8080", "192.168.1.2:8080"}
ForEachInSlice(servers, func(addr string) {
    log.Printf("Server online: %s", addr)
})
```

---

#### 5. FindInSlice
**Purpose**: Locate first element matching predicate

```go
// Function signature
func FindInSlice[T any](slice []T, predicate func(T) bool) (T, bool)

// Example: Find primary chunk server
type ChunkServer struct {
    Addr      string
    IsPrimary bool
}

servers := []ChunkServer{
    {Addr: "10.0.0.1", IsPrimary: false},
    {Addr: "10.0.0.2", IsPrimary: true},
    {Addr: "10.0.0.3", IsPrimary: false},
}

primary, found := FindInSlice(servers, func(cs ChunkServer) bool {
    return cs.IsPrimary
})
// Result: ChunkServer{Addr: "10.0.0.2", IsPrimary: true}, true
```

---

#### 6. GroupByKey
**Purpose**: Group elements by a derived key

```go
// Function signature
func GroupByKey[T any, K comparable](slice []T, keyFunc func(T) K) map[K][]T

// Example: Group files by extension
type File struct {
    Name string
    Ext  string
}

files := []File{
    {Name: "doc.txt", Ext: "txt"},
    {Name: "image.png", Ext: "png"},
    {Name: "notes.txt", Ext: "txt"},
}

grouped := GroupByKey(files, func(f File) string { return f.Ext })
// Result: map[string][]File{
//     "txt": [{Name: "doc.txt", Ext: "txt"}, {Name: "notes.txt", Ext: "txt"}],
//     "png": [{Name: "image.png", Ext: "png"}],
// }
```

---

#### 7. ChunkSlice
**Purpose**: Split a slice into fixed-size chunks

```go
// Function signature
func ChunkSlice[T any](slice []T, chunkSize int) [][]T

// Example: Batch process chunk handles
handles := []common.ChunkHandle{1, 2, 3, 4, 5, 6, 7, 8}
batches := ChunkSlice(handles, 3)
// Result: [[1, 2, 3], [4, 5, 6], [7, 8]]

// Use case: Batch RPC calls to avoid overwhelming servers
for _, batch := range batches {
    client.RPCBatchProcessChunks(batch)
}
```

---

#### 8. ZipSlices
**Purpose**: Combine two slices into pairs

```go
// Function signature
func ZipSlices[T, U any](slice1 []T, slice2 []U) [][2]any

// Example: Pair chunk handles with servers
handles := []common.ChunkHandle{100, 101, 102}
servers := []string{"server-a", "server-b", "server-c"}
pairs := ZipSlices(handles, servers)
// Result: [[100, "server-a"], [101, "server-b"], [102, "server-c"]]
```

**Limitation**: Returns `[][2]any` (loses type safety). Consider using structs for type-safe pairing.

---

### Map-Specific Utilities

#### 9. LoopOverMap / IterateOverMap
**Purpose**: Iterate over map key-value pairs

```go
// Function signature (old API)
func LoopOverMap[T comparable, V comparable](data map[T]V, fn func(k T, V V))

// Function signature (new API)
func IterateOverMap[K comparable, V any](m map[K]V, action func(K, V))

// Example: Log all chunk-to-server mappings
chunkLocations := map[common.ChunkHandle]string{
    100: "server-a",
    101: "server-b",
}
IterateOverMap(chunkLocations, func(handle common.ChunkHandle, server string) {
    log.Printf("Chunk %d → %s", handle, server)
})
```

---

#### 10. ExtractFromMap / FilterMapToNew
**Purpose**: Filter map entries into a new map

```go
// Function signature (old API - mutates result map)
func ExtractFromMap[K, V comparable](data, result map[K]V, fn func(value V) bool)

// Function signature (new API - returns new map)
func FilterMapToNew[K, V comparable](m map[K]V, predicate func(V) bool) map[K]V

// Example: Extract healthy servers
servers := map[string]Health{
    "server-a": {Status: "healthy"},
    "server-b": {Status: "degraded"},
    "server-c": {Status: "healthy"},
}

healthy := FilterMapToNew(servers, func(h Health) bool {
    return h.Status == "healthy"
})
// Result: map[string]Health{"server-a": {...}, "server-c": {...}}
```

**Design Note**: `ExtractFromMap` mutates the `result` parameter (error-prone), while `FilterMapToNew` returns a new map (safer).

---

## System Utilities

### 1. Sum
**Purpose**: Calculate total of numeric slice

```go
// Function signature
func Sum(slice []float64) float64

// Example: Total storage used
sizes := []float64{1024.5, 2048.0, 512.25}
total := Sum(sizes) // Result: 3584.75 MB
```

---

### 2. Sample
**Purpose**: Random sampling without replacement

```go
// Function signature
func Sample(n, k int) ([]int, error)

// Example: Select 3 random chunk servers from pool of 10
indices, err := Sample(10, 3)
if err != nil {
    log.Fatal(err)
}
// Result: [7, 2, 9] (random permutation)

// Use case: Load balancing across replica servers
servers := []string{"s1", "s2", "s3", "s4", "s5"}
indices, _ := Sample(len(servers), 2)
selectedServers := []string{servers[indices[0]], servers[indices[1]]}
```

**Error Case**: Returns error if `k > n` (insufficient population)

---

### 3. ComputeChecksum
**Purpose**: SHA-256 hash for data integrity

```go
// Function signature
func ComputeChecksum(content string) string

// Example: Verify chunk data integrity
chunkData := "file contents here..."
checksum := ComputeChecksum(chunkData)
// Result: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"

// Use case: Detect silent data corruption
storedChecksum := "abc123..."
if ComputeChecksum(chunkData) != storedChecksum {
    return errors.New("data corruption detected")
}
```

**Algorithm**: SHA-256 (256-bit cryptographic hash)

---

### 4. ValidateFilename
**Purpose**: Prevent reserved/invalid filenames

```go
// Function signature
func ValidateFilename(filename string, path common.Path) error

// Example: Create file validation
err := ValidateFilename("", "/home/user")
// Error: "invalid filename \"\" for path /home/user: reserved or empty name"

err := ValidateFilename("..", "/etc")
// Error: "invalid filename \"..\" for path /etc: reserved or empty name"

err := ValidateFilename("document.txt", "/docs")
// Result: nil (valid filename)
```

**Rejected Names**: `""` (empty), `"."` (current dir), `".."` (parent dir)

---

### 5. BToMb
**Purpose**: Convert bytes to megabytes with precision

```go
// Function signature
func BToMb(b uint64) (float64, error)

// Example: Memory reporting
memBytes := uint64(10485760) // 10 MB in bytes
memMB, err := BToMb(memBytes)
// Result: 10.0 MB

// Use case: System report RPC
func RPCSysReportHandler(args *SysReportInfoArg, reply *SysReportInfoReply) error {
    memMB, _ := BToMb(args.Memory)
    log.Printf("Server memory: %.2f MB", memMB)
    return nil
}
```

**Error Case**: Returns error if input > `math.MaxUint64 / 1024 / 1024` (unlikely with uint64)

---

## Design Rationale

### 1. Why Two Sets of Similar Functions?
**Observation**: Package has duplicate functions like `Map` vs `TransformSlice`, `Filter` vs `FilterSlice`

**Rationale**:
- **Evolution**: Original API (`Map`, `Filter`) → Refactored API (`TransformSlice`, `FilterSlice`)
- **Backward Compatibility**: Avoid breaking existing code using old names
- **Naming Clarity**: New names are more descriptive (`TransformSlice` vs `Map`)
- **Constraint Relaxation**: Old API uses `comparable` constraint, new API uses `any` (more flexible)

**Recommendation**: Deprecate old API in future major version

---

### 2. Why Deque Uses RWMutex Instead of Mutex?
**Decision**: `Deque[T]` uses `sync.RWMutex`, while `BQueue[T]` uses `sync.Mutex`

**Rationale**:
- **Deque**: Could benefit from concurrent reads (e.g., `Length()`, `Print()`)
- **Current Implementation**: All operations use write locks (`mu.Lock()`), not read locks
- **Unused Potential**: RWMutex capabilities not exploited

**Recommendation**: Either:
1. Change `Length()` to use `mu.RLock()` for read-only access, OR
2. Downgrade to `sync.Mutex` to simplify code

---

### 3. Why BQueue Requires `comparable` Constraint?
**Observation**: `BQueue[T comparable]` requires `T` to be comparable

**Current Code**:
```go
type BQueue[T comparable] struct { ... }
```

**Analysis**:
- **Actual Requirement**: No equality comparisons in code (no `==`, `!=`)
- **Over-Constraint**: Should be `BQueue[T any]` for maximum flexibility
- **Impact**: Cannot store non-comparable types (e.g., slices, maps)

**Recommendation**: Change to `BQueue[T any]` in next version

---

### 4. Why Return Zero Value Instead of Error on Empty Pop?
**Decision**: `Deque.PopFront()` and `Deque.PopBack()` return zero value when empty

```go
func (qs *Deque[T]) PopFront() T {
    if qs.tail == nil && qs.head == nil {
        var zeroVal T
        return zeroVal // No error!
    }
    // ...
}
```

**Rationale**:
- **Simplicity**: Callers don't need error handling
- **Idiomatic Go**: Similar to map access (`val, ok := m[key]`)
- **Trade-off**: Caller cannot distinguish "empty queue" from "stored zero value"

**Alternative Design**: Return `(T, error)` tuple
```go
func (qs *Deque[T]) PopFront() (T, error) {
    if qs.isEmpty() {
        var zero T
        return zero, errors.New("queue is empty")
    }
    // ...
}
```

**Recommendation**: Add `IsEmpty()` public method to allow safe checks before popping

---

### 5. Why Use Slice for BQueue Instead of Linked List?
**Decision**: `BQueue` uses `[]T` slice, while `Deque` uses linked list

**Rationale**:
- **BQueue**: Bounded capacity, FIFO pattern → slice is efficient
  - No node allocation overhead
  - Cache-friendly (contiguous memory)
  - Simple implementation
- **Deque**: Double-ended, unbounded → linked list is flexible
  - O(1) insertions at both ends (no reallocation)
  - No wasted capacity

**Trade-off**: BQueue slice reallocates on growth, but capacity is fixed (non-issue)

---

## Performance Characteristics

### Deque[T] Performance

| Operation   | Time      | Space     | Allocations | Notes                        |
|-------------|-----------|-----------|-------------|------------------------------|
| PushFront   | O(1)      | O(1)      | 1 node      | Constant time                |
| PushBack    | O(1)      | O(1)      | 1 node      | Constant time                |
| PopFront    | O(1)      | O(1)      | 0           | No allocation                |
| PopBack     | O(1)      | O(1)      | 0           | No allocation                |
| Length      | O(1)      | O(1)      | 0           | Simple field access          |
| PopAll      | O(n)      | O(n)      | 1 slice     | Drains queue to slice        |
| Print       | O(n)      | O(n)      | 1 buffer    | For debugging only           |

**Contention Analysis**:
- **Lock Granularity**: Coarse (entire deque)
- **Contention Point**: High under concurrent push/pop (single mutex)
- **Mitigation**: Use multiple queues (sharding) for high-throughput scenarios

---

### BQueue[T] Performance

| Operation | Time        | Space     | Allocations | Blocking Behavior            |
|-----------|-------------|-----------|-------------|------------------------------|
| Put       | O(1) avg    | O(1)      | 0           | Blocks if full               |
| Take      | O(1)        | O(1)      | 0           | Blocks if empty              |
| isFull    | O(1)        | O(1)      | 0           | Private helper               |
| isEmpty   | O(1)        | O(1)      | 0           | Private helper               |

**Slice Reallocation**:
- **Growth**: `q.data = q.data[1:]` creates new slice header (no copy)
- **Append**: `q.data = append(q.data, item)` may reallocate if cap exceeded
- **Mitigation**: Pre-allocate capacity in constructor (`make([]T, 0, capacity)`)

**Blocking Efficiency**:
- **Wait**: Uses `sync.Cond.Wait()` (no busy-waiting, low CPU)
- **Signal**: Wakes exactly one waiting goroutine (fair scheduling)

---

### Functional Utilities Performance

| Function         | Time      | Space     | Allocations | Notes                             |
|------------------|-----------|-----------|-------------|-----------------------------------|
| Map/Transform    | O(n)      | O(n)      | 1 slice     | Creates new slice                 |
| Filter           | O(n)      | O(k)      | 1 slice     | k = filtered elements             |
| Reduce           | O(n)      | O(1)      | 0           | Accumulates in-place              |
| Find             | O(n)      | O(1)      | 0           | Early exit on match               |
| GroupByKey       | O(n)      | O(n+g)    | 1 map + g   | g = number of groups              |
| ChunkSlice       | O(n)      | O(n)      | c slices    | c = number of chunks              |
| ZipSlices        | O(min)    | O(min)    | 1 slice     | min = min(len(s1), len(s2))       |

**Optimization Opportunity**: Pre-allocate slices with known capacity
```go
// Current (inefficient)
func Filter[T comparable](data []T, fn func(v T) bool) []T {
    result := []T{}  // capacity = 0, multiple reallocations
    // ...
}

// Optimized
func Filter[T comparable](data []T, fn func(v T) bool) []T {
    result := make([]T, 0, len(data))  // pre-allocate, single allocation
    // ...
}
```

---

## Concurrency Model

### Deque Synchronization

```go
// Fine-grained locking example (theoretical improvement)
type Deque[T any] struct {
    headMu sync.Mutex  // Lock for head operations
    tailMu sync.Mutex  // Lock for tail operations
    head   *Node[T]
    tail   *Node[T]
    length int64       // Requires atomic operations
}

// Current: Single lock (simpler, but lower concurrency)
type Deque[T any] struct {
    mu     sync.RWMutex  // All operations lock this
    // ...
}
```

**Current Design**: Coarse-grained locking (single `RWMutex`)
- **Pros**: Simple, no deadlock risk, correct
- **Cons**: Serialize all operations (low concurrency)

**Alternative Design**: Fine-grained locking (separate head/tail locks)
- **Pros**: Higher concurrency (PushFront + PushBack can run in parallel)
- **Cons**: Complex, risk of deadlock, requires atomic length updates

**Recommendation**: Keep current design unless profiling shows lock contention

---

### BQueue Synchronization

```go
// Producer-Consumer Pattern
Put(item):
    1. Acquire lock (mu.Lock())
    2. While queue is full:
          Wait on condition variable (c.Wait())  // Releases lock, blocks
    3. Add item to queue
    4. Signal waiting consumers (c.Signal())
    5. Release lock (defer mu.Unlock())

Take():
    1. Acquire lock (mu.Lock())
    2. While queue is empty:
          Wait on condition variable (c.Wait())  // Releases lock, blocks
    3. Remove item from queue
    4. Signal waiting producers (c.Signal())
    5. Release lock (defer mu.Unlock())
```

**Critical Invariant**: Lock must be held when calling `c.Wait()` / `c.Signal()`

**Spurious Wakeups**: Loop condition (`for q.isFull()` vs `if q.isFull()`) prevents incorrect behavior

---

## Usage Patterns

### Pattern 1: Task Scheduling with Deque

```go
// Use deque for priority task scheduling
type Task struct {
    ID       int
    Priority int
    Execute  func()
}

taskQueue := utils.Deque[Task]{}

// Add high-priority task to front
taskQueue.PushFront(Task{ID: 1, Priority: 10, Execute: func() { ... }})

// Add normal-priority task to back
taskQueue.PushBack(Task{ID: 2, Priority: 5, Execute: func() { ... }})

// Worker processes tasks
for taskQueue.Length() > 0 {
    task := taskQueue.PopFront()
    task.Execute()
}
```

---

### Pattern 2: Rate Limiting with BQueue

```go
// Create a token bucket for rate limiting
tokenBucket := utils.NewBlockingQueue[struct{}](100) // 100 requests/sec

// Token producer (refills at fixed rate)
go func() {
    ticker := time.NewTicker(10 * time.Millisecond) // 100 tokens/sec
    for range ticker.C {
        tokenBucket.Put(struct{}{})
    }
}()

// Request handler (consumes tokens)
func handleRequest(req *http.Request) {
    tokenBucket.Take() // Blocks if no tokens available (rate limiting)
    processRequest(req)
}
```

---

### Pattern 3: Batch Processing with ChunkSlice

```go
// Process large datasets in batches to avoid memory exhaustion
chunkHandles := make([]common.ChunkHandle, 10000) // 10k chunks

batches := utils.ChunkSlice(chunkHandles, 100) // 100 chunks per batch

for i, batch := range batches {
    log.Printf("Processing batch %d/%d", i+1, len(batches))
    
    // Send batch RPC (avoid overwhelming server)
    err := client.RPCBatchDelete(batch)
    if err != nil {
        log.Printf("Batch %d failed: %v", i, err)
    }
    
    time.Sleep(100 * time.Millisecond) // Throttle requests
}
```

---

### Pattern 4: Functional Pipeline

```go
// Chain functional utilities for data transformation
type File struct {
    Name string
    Size int64
}

files := []File{
    {Name: "log.txt", Size: 1024},
    {Name: "data.bin", Size: 2048},
    {Name: "config.yaml", Size: 512},
}

// Pipeline: Filter large files → Extract names → Calculate total size
largeFiles := utils.FilterSlice(files, func(f File) bool {
    return f.Size > 1000
})

names := utils.TransformSlice(largeFiles, func(f File) string {
    return f.Name
})

totalSize := utils.ReduceSlice(largeFiles, int64(0), func(acc int64, f File) int64 {
    return acc + f.Size
})

// Result: names = ["log.txt", "data.bin"], totalSize = 3072
```

---

## Testing Strategy

### Unit Tests

#### Deque Tests
- **FIFO Ordering** (`TestQueueInFIFOSequence`): Verify push-pop order preservation
  - Integer queue: Push [1,3,4,5] → Pop [1,3,4,5]
  - String queue: Push ["a","b","c"] → Pop ["a","b","c"]
  - Boolean queue: Push [true,false,true] → Pop [true,false,true]

- **Concurrent Access** (`TestQueueWithProducerAndConsumer`):
  - Producer: PushFront(1), PushBack(2,3,4), PushFront(5), PushBack(6)
  - Consumer: PopBack, PopFront, PopFront, PopBack, PopBack
  - Expected: [6,5,1,4,3], queue length = 1 (residual element)

#### BQueue Tests
- **Blocking Behavior** (`TestBlockingQueue`):
  - Capacity: 1
  - Producer: Put 3 items with 100ms delay (blocks on 2nd item until consumer takes)
  - Consumer: Take 3 items with 100ms delay
  - Verify: FIFO order preserved, no deadlock

---

### Test Coverage Gaps

| Component           | Missing Tests                                    | Severity |
|---------------------|--------------------------------------------------|----------|
| Deque               | Empty queue behavior (PopFront/PopBack)          | Medium   |
| Deque               | Concurrent PushFront + PopBack races             | High     |
| Deque               | Print() thread safety                            | Low      |
| BQueue              | Multi-producer, multi-consumer scenarios         | High     |
| BQueue              | Capacity = 0 edge case                           | Medium   |
| Functional Utils    | No unit tests at all                             | High     |
| System Helpers      | Sum, Sample, BToMb, ValidateFilename untested    | Medium   |

---

### Recommended Test Additions

#### 1. Deque Empty Queue Test
```go
func TestDequeEmptyPop(t *testing.T) {
    queue := Deque[int]{}
    
    val := queue.PopFront()
    if val != 0 {
        t.Errorf("Expected zero value, got %d", val)
    }
    
    if queue.Length() != 0 {
        t.Errorf("Expected length 0, got %d", queue.Length())
    }
}
```

#### 2. BQueue Multi-Consumer Test
```go
func TestBQueueMultiConsumer(t *testing.T) {
    queue := NewBlockingQueue[int](10)
    
    // Producer: Add 100 items
    go func() {
        for i := 0; i < 100; i++ {
            queue.Put(i)
        }
    }()
    
    // 5 consumers: Take 20 items each
    results := make([]int, 0, 100)
    var mu sync.Mutex
    var wg sync.WaitGroup
    
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 20; j++ {
                val := queue.Take()
                mu.Lock()
                results = append(results, val)
                mu.Unlock()
            }
        }()
    }
    
    wg.Wait()
    
    // Verify all items consumed
    if len(results) != 100 {
        t.Errorf("Expected 100 items, got %d", len(results))
    }
}
```

#### 3. Functional Utils Tests
```go
func TestTransformSlice(t *testing.T) {
    input := []int{1, 2, 3}
    output := TransformSlice(input, func(x int) int { return x * 2 })
    expected := []int{2, 4, 6}
    
    if !reflect.DeepEqual(output, expected) {
        t.Errorf("Expected %v, got %v", expected, output)
    }
}

func TestFilterSlice(t *testing.T) {
    input := []int{1, 2, 3, 4, 5}
    output := FilterSlice(input, func(x int) bool { return x > 2 })
    expected := []int{3, 4, 5}
    
    if !reflect.DeepEqual(output, expected) {
        t.Errorf("Expected %v, got %v", expected, output)
    }
}
```

---

## Future Enhancements

### 1. Generic Stack Implementation
**Motivation**: Many use cases need LIFO behavior (e.g., undo/redo, call stack simulation)

```go
type Stack[T any] struct {
    mu   sync.RWMutex
    data []T
}

func (s *Stack[T]) Push(item T) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data = append(s.data, item)
}

func (s *Stack[T]) Pop() (T, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    
    if len(s.data) == 0 {
        var zero T
        return zero, errors.New("stack is empty")
    }
    
    item := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return item, nil
}
```

---

### 2. Priority Queue
**Motivation**: Task scheduling, event processing require priority-based ordering

```go
type PriorityQueue[T any] struct {
    mu    sync.RWMutex
    items []priorityItem[T]
}

type priorityItem[T any] struct {
    value    T
    priority int
}

func (pq *PriorityQueue[T]) Push(value T, priority int) {
    // Heap insertion
}

func (pq *PriorityQueue[T]) Pop() (T, error) {
    // Heap extraction
}
```

**Implementation**: Use `container/heap` from standard library

---

### 3. Concurrent Map (sync.Map Wrapper)
**Motivation**: Type-safe wrapper around `sync.Map` with generics

```go
type ConcurrentMap[K comparable, V any] struct {
    m sync.Map
}

func (cm *ConcurrentMap[K, V]) Store(key K, value V) {
    cm.m.Store(key, value)
}

func (cm *ConcurrentMap[K, V]) Load(key K) (V, bool) {
    val, ok := cm.m.Load(key)
    if !ok {
        var zero V
        return zero, false
    }
    return val.(V), true
}
```

---

### 4. Immutable Collection Builders
**Motivation**: Prevent accidental mutations, enable concurrent reads without locking

```go
type ImmutableSlice[T any] struct {
    data []T
}

func NewImmutableSlice[T any](data []T) ImmutableSlice[T] {
    copied := make([]T, len(data))
    copy(copied, data)
    return ImmutableSlice[T]{data: copied}
}

func (is ImmutableSlice[T]) Get(index int) T {
    return is.data[index] // No locks needed (read-only)
}

func (is ImmutableSlice[T]) Map(fn func(T) T) ImmutableSlice[T] {
    result := make([]T, len(is.data))
    for i, v := range is.data {
        result[i] = fn(v)
    }
    return ImmutableSlice[T]{data: result}
}
```

---

### 5. Parallel Functional Utilities
**Motivation**: Leverage multi-core CPUs for large dataset processing

```go
func ParallelMap[T, V any](slice []T, transform func(T) V, workers int) []V {
    result := make([]V, len(slice))
    
    var wg sync.WaitGroup
    chunkSize := (len(slice) + workers - 1) / workers
    
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func(workerID int) {
            defer wg.Done()
            
            start := workerID * chunkSize
            end := min(start+chunkSize, len(slice))
            
            for j := start; j < end; j++ {
                result[j] = transform(slice[j])
            }
        }(i)
    }
    
    wg.Wait()
    return result
}

// Usage: Process 1M chunk handles across 8 CPU cores
handles := make([]common.ChunkHandle, 1_000_000)
checksums := ParallelMap(handles, computeChecksum, 8)
```

---

### 6. Stream API (Lazy Evaluation)
**Motivation**: Chain operations without intermediate allocations

```go
type Stream[T any] struct {
    source   []T
    pipeline []func(T) (T, bool)
}

func NewStream[T any](source []T) *Stream[T] {
    return &Stream[T]{source: source}
}

func (s *Stream[T]) Filter(predicate func(T) bool) *Stream[T] {
    s.pipeline = append(s.pipeline, func(v T) (T, bool) {
        return v, predicate(v)
    })
    return s
}

func (s *Stream[T]) Map(transform func(T) T) *Stream[T] {
    s.pipeline = append(s.pipeline, func(v T) (T, bool) {
        return transform(v), true
    })
    return s
}

func (s *Stream[T]) Collect() []T {
    result := []T{}
    for _, item := range s.source {
        current := item
        include := true
        
        for _, fn := range s.pipeline {
            current, include = fn(current)
            if !include {
                break
            }
        }
        
        if include {
            result = append(result, current)
        }
    }
    return result
}

// Usage: Lazy evaluation, single pass
files := NewStream(allFiles).
    Filter(func(f File) bool { return f.Size > 1024 }).
    Map(func(f File) File { f.Name = strings.ToUpper(f.Name); return f }).
    Collect()
```

---

### 7. Error-Safe Functional Utilities
**Motivation**: Handle errors in transformation pipelines

```go
func MapWithError[T, V any](slice []T, transform func(T) (V, error)) ([]V, error) {
    result := make([]V, 0, len(slice))
    for _, item := range slice {
        v, err := transform(item)
        if err != nil {
            return nil, err
        }
        result = append(result, v)
    }
    return result, nil
}

// Usage: Convert chunk handles to metadata (with RPC errors)
metadata, err := MapWithError(handles, func(h common.ChunkHandle) (ChunkMetadata, error) {
    return client.RPCGetChunkMetadata(h)
})
if err != nil {
    log.Fatalf("RPC failed: %v", err)
}
```

---

### 8. Benchmark Suite
**Motivation**: Measure performance, detect regressions

```go
func BenchmarkDequePushBack(b *testing.B) {
    queue := Deque[int]{}
    for i := 0; i < b.N; i++ {
        queue.PushBack(i)
    }
}

func BenchmarkBQueueThroughput(b *testing.B) {
    queue := NewBlockingQueue[int](1000)
    
    go func() {
        for i := 0; i < b.N; i++ {
            queue.Put(i)
        }
    }()
    
    for i := 0; i < b.N; i++ {
        queue.Take()
    }
}
```

---

## Summary

The `utils` package provides essential building blocks for the Hercules DFS:

- **Deque[T]**: Thread-safe double-ended queue for flexible task management
- **BQueue[T]**: Blocking queue for producer-consumer synchronization
- **Functional Utilities**: Map, Filter, Reduce, GroupBy for declarative data processing
- **System Helpers**: Checksum, validation, conversions for common operations

**Strengths**:
- Generic implementations for type safety
- Comprehensive functional programming toolbox
- Well-tested concurrent data structures

**Improvement Areas**:
- Add test coverage for functional utilities
- Optimize pre-allocation in collection transformations
- Deprecate duplicate APIs (Map vs TransformSlice)
- Relax `comparable` constraint on `BQueue[T]`

The package demonstrates solid engineering with room for polish and expansion.
