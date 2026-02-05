# Utils Package - User Guide

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Data Structures](#data-structures)
4. [Functional Utilities](#functional-utilities)
5. [System Helpers](#system-helpers)
6. [Common Patterns](#common-patterns)
7. [Error Handling](#error-handling)
8. [Performance Tips](#performance-tips)
9. [Testing](#testing)
10. [FAQ](#faq)

---

## Overview

The `utils` package provides reusable data structures and utility functions for the Hercules Distributed File System. It offers:

- **Thread-safe queues** for concurrent programming
- **Functional utilities** for collection manipulation
- **System helpers** for checksums, validation, and conversions

### Installation

```bash
import "github.com/caleberi/distributed-system/utils"
```

### Package Contents

| Component           | Purpose                                  | Thread-Safe |
|---------------------|------------------------------------------|-------------|
| `Deque[T]`          | Double-ended queue (FIFO/LIFO)           | ✅          |
| `BQueue[T]`         | Blocking queue (producer-consumer)       | ✅          |
| Functional Utils    | Map, Filter, Reduce, GroupBy, etc.       | ❌          |
| System Helpers      | Checksum, Sum, Sample, BToMb, etc.       | ✅          |

---

## Quick Start

### Example 1: Basic Queue Usage

```go
package main

import (
    "fmt"
    "github.com/caleberi/distributed-system/utils"
)

func main() {
    // Create a deque for integers
    queue := utils.Deque[int]{}
    
    // Add elements
    queue.PushBack(10)
    queue.PushBack(20)
    queue.PushFront(5)  // Insert at front
    
    // Remove elements
    fmt.Println(queue.PopFront())  // Output: 5
    fmt.Println(queue.PopFront())  // Output: 10
    fmt.Println(queue.Length())    // Output: 1
}
```

---

### Example 2: Blocking Queue (Producer-Consumer)

```go
package main

import (
    "fmt"
    "time"
    "github.com/caleberi/distributed-system/utils"
)

func main() {
    // Create a bounded queue (capacity = 5)
    queue := utils.NewBlockingQueue[string](5)
    
    // Producer goroutine
    go func() {
        for i := 0; i < 10; i++ {
            msg := fmt.Sprintf("Message %d", i)
            queue.Put(msg)  // Blocks if queue is full
            fmt.Printf("Produced: %s\n", msg)
        }
    }()
    
    // Consumer goroutine
    go func() {
        for i := 0; i < 10; i++ {
            msg := queue.Take()  // Blocks if queue is empty
            fmt.Printf("Consumed: %s\n", msg)
            time.Sleep(200 * time.Millisecond)
        }
    }()
    
    time.Sleep(5 * time.Second)
}
```

---

### Example 3: Functional Programming

```go
package main

import (
    "fmt"
    "github.com/caleberi/distributed-system/utils"
)

func main() {
    // Sample data
    numbers := []int{1, 2, 3, 4, 5}
    
    // Transform: Square each number
    squares := utils.TransformSlice(numbers, func(n int) int {
        return n * n
    })
    // Result: [1, 4, 9, 16, 25]
    
    // Filter: Keep only even squares
    evens := utils.FilterSlice(squares, func(n int) bool {
        return n%2 == 0
    })
    // Result: [4, 16]
    
    // Reduce: Sum all values
    total := utils.ReduceSlice(evens, 0, func(acc, n int) int {
        return acc + n
    })
    // Result: 20
    
    fmt.Printf("Result: %d\n", total)
}
```

---

## Data Structures

### Deque[T] - Double-Ended Queue

A thread-safe deque supporting insertion/removal at both ends.

#### Creating a Deque

```go
// Create an empty deque
queue := utils.Deque[string]{}

// Type inference
var taskQueue utils.Deque[func()]
```

#### Operations

##### PushFront(v T)
Insert element at the front (head).

```go
queue := utils.Deque[int]{}
queue.PushFront(10)  // [10]
queue.PushFront(20)  // [20, 10]
```

---

##### PushBack(v T)
Insert element at the back (tail).

```go
queue := utils.Deque[int]{}
queue.PushBack(10)   // [10]
queue.PushBack(20)   // [10, 20]
```

---

##### PopFront() T
Remove and return element from front.

```go
queue := utils.Deque[int]{}
queue.PushBack(10)
queue.PushBack(20)

val := queue.PopFront()  // val = 10, queue = [20]
```

**Empty Queue Behavior**: Returns zero value of type `T`.

```go
queue := utils.Deque[int]{}
val := queue.PopFront()  // val = 0 (zero value)
```

---

##### PopBack() T
Remove and return element from back.

```go
queue := utils.Deque[int]{}
queue.PushBack(10)
queue.PushBack(20)

val := queue.PopBack()  // val = 20, queue = [10]
```

---

##### Length() int64
Get current size.

```go
queue := utils.Deque[int]{}
queue.PushBack(10)
queue.PushBack(20)

fmt.Println(queue.Length())  // Output: 2
```

---

##### PopAll() []T
Drain entire queue into a slice.

```go
queue := utils.Deque[int]{}
queue.PushBack(1)
queue.PushBack(2)
queue.PushBack(3)

items := queue.PopAll()  // items = [3, 2, 1], queue is empty
```

**Note**: Returns items in reverse order (pops from back).

---

##### Print(w io.Writer)
Print queue contents (for debugging).

```go
queue := utils.Deque[int]{}
queue.PushBack(1)
queue.PushBack(2)

queue.Print(os.Stdout)  // Output: 1 ->2 ->nil
```

**Warning**: Not thread-safe. Use only for debugging in single-threaded context.

---

#### Use Cases

| Pattern              | Operations                     | Example                          |
|----------------------|--------------------------------|----------------------------------|
| FIFO Queue           | PushBack + PopFront            | Task queue, message buffer       |
| LIFO Stack           | PushBack + PopBack             | Undo/redo, call stack            |
| Priority Queue (manual) | PushFront (high), PushBack (low) | Job scheduling               |

---

### BQueue[T] - Blocking Queue

A thread-safe bounded queue with blocking semantics.

#### Creating a Blocking Queue

```go
// Create a queue with capacity 10
queue := utils.NewBlockingQueue[string](10)
```

---

#### Operations

##### Put(item T)
Add item to queue. **Blocks if queue is full**.

```go
queue := utils.NewBlockingQueue[int](2)

queue.Put(10)  // Success
queue.Put(20)  // Success
queue.Put(30)  // BLOCKS until consumer takes an item
```

---

##### Take() T
Remove item from queue. **Blocks if queue is empty**.

```go
queue := utils.NewBlockingQueue[int](10)

// This will block forever (queue is empty)
val := queue.Take()
```

---

#### Producer-Consumer Example

```go
package main

import (
    "fmt"
    "sync"
    "github.com/caleberi/distributed-system/utils"
)

func main() {
    queue := utils.NewBlockingQueue[int](5)
    var wg sync.WaitGroup
    
    // Producer: Generate numbers
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 20; i++ {
            queue.Put(i)
            fmt.Printf("Produced: %d\n", i)
        }
    }()
    
    // Consumer: Process numbers
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 20; i++ {
            val := queue.Take()
            fmt.Printf("Consumed: %d\n", val)
        }
    }()
    
    wg.Wait()
}
```

---

#### Use Cases

| Pattern                 | Description                               | Example                          |
|-------------------------|-------------------------------------------|----------------------------------|
| Rate Limiting           | Bounded token bucket                      | API throttling                   |
| Buffering               | Smooth out burst traffic                  | Request buffering                |
| Work Pooling            | Distribute tasks to workers               | Thread pool                      |
| Backpressure            | Slow down fast producers                  | Prevent memory exhaustion        |

---

## Functional Utilities

### Map / Transform

#### TransformSlice[T, V any](slice []T, transform func(T) V) []V
Apply transformation to each element.

```go
// Convert strings to their lengths
words := []string{"hello", "world", "go"}
lengths := utils.TransformSlice(words, func(s string) int {
    return len(s)
})
// Result: [5, 5, 2]
```

**Legacy API**: `Map[T, V comparable](data []T, fn func(v T) V) []V`
- Same functionality, but requires `comparable` types
- Use `TransformSlice` for new code

---

### Filter

#### FilterSlice[T any](slice []T, predicate func(T) bool) []T
Select elements matching predicate.

```go
// Filter positive numbers
numbers := []int{-3, -1, 0, 2, 5, 7}
positives := utils.FilterSlice(numbers, func(n int) bool {
    return n > 0
})
// Result: [2, 5, 7]
```

**Legacy API**: `Filter[T comparable](data []T, fn func(v T) bool) []T`

---

### Reduce

#### ReduceSlice[T, V any](slice []T, initial V, accumulator func(V, T) V) V
Reduce slice to single value.

```go
// Sum all numbers
numbers := []int{1, 2, 3, 4, 5}
sum := utils.ReduceSlice(numbers, 0, func(acc, n int) int {
    return acc + n
})
// Result: 15
```

```go
// Concatenate strings
words := []string{"Hello", " ", "World"}
sentence := utils.ReduceSlice(words, "", func(acc, word string) string {
    return acc + word
})
// Result: "Hello World"
```

---

### Find

#### FindInSlice[T any](slice []T, predicate func(T) bool) (T, bool)
Find first element matching predicate.

```go
type User struct {
    ID   int
    Name string
}

users := []User{
    {ID: 1, Name: "Alice"},
    {ID: 2, Name: "Bob"},
    {ID: 3, Name: "Charlie"},
}

user, found := utils.FindInSlice(users, func(u User) bool {
    return u.ID == 2
})

if found {
    fmt.Printf("Found: %s\n", user.Name)  // Output: Found: Bob
} else {
    fmt.Println("Not found")
}
```

---

### ForEach

#### ForEachInSlice[T any](slice []T, action func(T))
Execute side effect for each element.

```go
// Log all server addresses
servers := []string{"10.0.0.1:8080", "10.0.0.2:8080"}

utils.ForEachInSlice(servers, func(addr string) {
    log.Printf("Server: %s\n", addr)
})
```

**Legacy API**: `ForEach[T any](data []T, fn func(v T))`

---

### GroupByKey

#### GroupByKey[T any, K comparable](slice []T, keyFunc func(T) K) map[K][]T
Group elements by derived key.

```go
type File struct {
    Name string
    Ext  string
}

files := []File{
    {Name: "doc.txt", Ext: "txt"},
    {Name: "image.png", Ext: "png"},
    {Name: "notes.txt", Ext: "txt"},
}

grouped := utils.GroupByKey(files, func(f File) string {
    return f.Ext
})

// Result:
// map[string][]File{
//     "txt": [{Name: "doc.txt", Ext: "txt"}, {Name: "notes.txt", Ext: "txt"}],
//     "png": [{Name: "image.png", Ext: "png"}],
// }
```

---

### ChunkSlice

#### ChunkSlice[T any](slice []T, chunkSize int) [][]T
Split slice into fixed-size chunks.

```go
// Split into batches of 3
numbers := []int{1, 2, 3, 4, 5, 6, 7, 8}
batches := utils.ChunkSlice(numbers, 3)

// Result: [[1, 2, 3], [4, 5, 6], [7, 8]]

for i, batch := range batches {
    fmt.Printf("Batch %d: %v\n", i, batch)
}
```

---

### ZipSlices

#### ZipSlices[T, U any](slice1 []T, slice2 []U) [][2]any
Combine two slices into pairs.

```go
names := []string{"Alice", "Bob", "Charlie"}
ages := []int{30, 25, 35}

pairs := utils.ZipSlices(names, ages)

// Result: [["Alice", 30], ["Bob", 25], ["Charlie", 35]]

for _, pair := range pairs {
    fmt.Printf("%s is %d years old\n", pair[0], pair[1])
}
```

**Limitation**: Returns `[][2]any` (loses type safety). Cast when accessing:

```go
name := pair[0].(string)
age := pair[1].(int)
```

---

### Map Utilities

#### IterateOverMap[K comparable, V any](m map[K]V, action func(K, V))
Execute action for each key-value pair.

```go
chunkLocations := map[int]string{
    100: "server-a",
    101: "server-b",
    102: "server-c",
}

utils.IterateOverMap(chunkLocations, func(id int, server string) {
    log.Printf("Chunk %d is on %s\n", id, server)
})
```

**Legacy API**: `LoopOverMap[T comparable, V comparable](data map[T]V, fn func(k T, V V))`

---

#### FilterMapToNew[K, V comparable](m map[K]V, predicate func(V) bool) map[K]V
Create new map with filtered values.

```go
type ServerStatus struct {
    Name   string
    Health string
}

servers := map[string]ServerStatus{
    "s1": {Name: "Server 1", Health: "healthy"},
    "s2": {Name: "Server 2", Health: "degraded"},
    "s3": {Name: "Server 3", Health: "healthy"},
}

healthy := utils.FilterMapToNew(servers, func(s ServerStatus) bool {
    return s.Health == "healthy"
})

// Result: map[string]ServerStatus{"s1": {...}, "s3": {...}}
```

**Legacy API**: `ExtractFromMap[K, V comparable](data, result map[K]V, fn func(value V) bool)`
- Mutates the `result` parameter (less safe)

---

## System Helpers

### Sum

#### Sum(slice []float64) float64
Calculate total of numeric slice.

```go
sizes := []float64{10.5, 20.3, 15.7}
total := utils.Sum(sizes)
// Result: 46.5
```

---

### Sample

#### Sample(n, k int) ([]int, error)
Random sampling without replacement.

```go
// Select 3 random indices from 0-9
indices, err := utils.Sample(10, 3)
if err != nil {
    log.Fatal(err)
}
// Result: [7, 2, 9] (random)

// Use case: Select random servers for replication
servers := []string{"s1", "s2", "s3", "s4", "s5"}
indices, _ := utils.Sample(len(servers), 2)
selected := []string{servers[indices[0]], servers[indices[1]]}
```

**Error Case**: Returns error if `k > n`.

```go
_, err := utils.Sample(5, 10)
// Error: "population is not enough for sampling (n = 5, k = 10)"
```

---

### ComputeChecksum

#### ComputeChecksum(content string) string
Compute SHA-256 hash of content.

```go
data := "Hello, World!"
checksum := utils.ComputeChecksum(data)
// Result: "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"

// Use case: Verify chunk integrity
storedChecksum := "abc123..."
actualChecksum := utils.ComputeChecksum(chunkData)

if actualChecksum != storedChecksum {
    return errors.New("data corruption detected")
}
```

---

### ValidateFilename

#### ValidateFilename(filename string, path common.Path) error
Validate filename against reserved names.

```go
// Valid filename
err := utils.ValidateFilename("document.txt", "/docs")
// Result: nil

// Invalid: Empty string
err := utils.ValidateFilename("", "/docs")
// Error: "invalid filename \"\" for path /docs: reserved or empty name"

// Invalid: Current directory
err := utils.ValidateFilename(".", "/docs")
// Error: "invalid filename \".\" for path /docs: reserved or empty name"

// Invalid: Parent directory
err := utils.ValidateFilename("..", "/docs")
// Error: "invalid filename \"..\" for path /docs: reserved or empty name"
```

---

### BToMb

#### BToMb(b uint64) (float64, error)
Convert bytes to megabytes.

```go
bytes := uint64(10485760)  // 10 MB
mb, err := utils.BToMb(bytes)
// Result: 10.0 MB

// Use case: Memory reporting
memBytes := uint64(1073741824)  // 1 GB
memMB, _ := utils.BToMb(memBytes)
fmt.Printf("Memory: %.2f MB\n", memMB)  // Output: Memory: 1024.00 MB
```

---

## Common Patterns

### Pattern 1: Task Queue with Priority

```go
type Task struct {
    ID       int
    Priority int
    Execute  func()
}

// Create task queue
taskQueue := utils.Deque[Task]{}

// Add high-priority task to front
taskQueue.PushFront(Task{
    ID:       1,
    Priority: 10,
    Execute:  func() { fmt.Println("Critical task") },
})

// Add normal-priority task to back
taskQueue.PushBack(Task{
    ID:       2,
    Priority: 5,
    Execute:  func() { fmt.Println("Regular task") },
})

// Worker processes tasks (high-priority first)
for taskQueue.Length() > 0 {
    task := taskQueue.PopFront()
    task.Execute()
}
```

---

### Pattern 2: Request Rate Limiting

```go
// Create token bucket (100 requests/second)
tokenBucket := utils.NewBlockingQueue[struct{}](100)

// Token producer (refills at fixed rate)
go func() {
    ticker := time.NewTicker(10 * time.Millisecond)  // 100 tokens/sec
    for range ticker.C {
        tokenBucket.Put(struct{}{})
    }
}()

// Request handler
func handleRequest(req *http.Request) {
    // Consume token (blocks if bucket empty = rate limit exceeded)
    tokenBucket.Take()
    
    // Process request
    processRequest(req)
}
```

---

### Pattern 3: Batch Processing

```go
// Large dataset
chunkHandles := make([]int, 10000)

// Process in batches of 100
batches := utils.ChunkSlice(chunkHandles, 100)

for i, batch := range batches {
    log.Printf("Processing batch %d/%d\n", i+1, len(batches))
    
    // Send batch RPC
    err := client.RPCBatchDelete(batch)
    if err != nil {
        log.Printf("Batch %d failed: %v\n", i, err)
        continue
    }
    
    // Throttle requests
    time.Sleep(100 * time.Millisecond)
}
```

---

### Pattern 4: Data Pipeline

```go
type File struct {
    Name string
    Size int64
}

files := []File{
    {Name: "log.txt", Size: 1024},
    {Name: "data.bin", Size: 2048},
    {Name: "config.yaml", Size: 512},
}

// Pipeline: Filter → Transform → Reduce
largeFiles := utils.FilterSlice(files, func(f File) bool {
    return f.Size > 1000
})

names := utils.TransformSlice(largeFiles, func(f File) string {
    return f.Name
})

totalSize := utils.ReduceSlice(largeFiles, int64(0), func(acc int64, f File) int64 {
    return acc + f.Size
})

fmt.Printf("Large files: %v\n", names)        // ["log.txt", "data.bin"]
fmt.Printf("Total size: %d bytes\n", totalSize)  // 3072
```

---

### Pattern 5: Parallel Workers with Blocking Queue

```go
package main

import (
    "fmt"
    "sync"
    "github.com/caleberi/distributed-system/utils"
)

func main() {
    jobs := utils.NewBlockingQueue[int](100)
    results := utils.NewBlockingQueue[int](100)
    
    var wg sync.WaitGroup
    
    // Start 5 workers
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func(workerID int) {
            defer wg.Done()
            for j := 0; j < 20; j++ {
                job := jobs.Take()
                result := job * 2  // Process job
                results.Put(result)
                fmt.Printf("Worker %d processed job %d\n", workerID, job)
            }
        }(i)
    }
    
    // Producer: Submit 100 jobs
    go func() {
        for i := 0; i < 100; i++ {
            jobs.Put(i)
        }
    }()
    
    // Consumer: Collect results
    go func() {
        for i := 0; i < 100; i++ {
            result := results.Take()
            fmt.Printf("Result: %d\n", result)
        }
    }()
    
    wg.Wait()
}
```

---

## Error Handling

### Deque Error Handling

**Empty Queue Behavior**: Returns zero value (no error).

```go
queue := utils.Deque[int]{}

val := queue.PopFront()  // val = 0 (zero value for int)

if val == 0 {
    // Cannot distinguish between:
    // 1. Queue was empty
    // 2. Queue contained actual zero value
}
```

**Safe Pattern**: Check length before popping.

```go
if queue.Length() > 0 {
    val := queue.PopFront()
    // Guaranteed non-zero value (unless actual zero was stored)
}
```

---

### BQueue Error Handling

**Blocking Behavior**: No errors, blocks instead.

```go
queue := utils.NewBlockingQueue[int](1)

// This blocks forever (queue empty)
val := queue.Take()
```

**Safe Pattern**: Use timeouts with context or channels.

```go
done := make(chan int)

go func() {
    val := queue.Take()
    done <- val
}()

select {
case val := <-done:
    fmt.Printf("Got value: %d\n", val)
case <-time.After(5 * time.Second):
    fmt.Println("Timeout waiting for value")
}
```

---

### Sample Error Handling

**Error Case**: Insufficient population (`k > n`).

```go
indices, err := utils.Sample(5, 10)
if err != nil {
    log.Fatalf("Sample failed: %v", err)
}
```

---

### BToMb Error Handling

**Error Case**: Overflow (extremely unlikely with uint64).

```go
mb, err := utils.BToMb(math.MaxUint64)
if err != nil {
    log.Printf("Conversion failed: %v", err)
}
```

---

## Performance Tips

### 1. Pre-allocate Slices

**Inefficient**:
```go
result := []int{}  // Capacity = 0, multiple reallocations
for _, v := range data {
    result = append(result, v*2)
}
```

**Optimized**:
```go
result := make([]int, 0, len(data))  // Pre-allocate capacity
for _, v := range data {
    result = append(result, v*2)
}
```

---

### 2. Use Deque for FIFO/LIFO Instead of Slices

**Inefficient (O(n) removal)**:
```go
queue := []int{1, 2, 3, 4, 5}
val := queue[0]
queue = queue[1:]  // O(n) copy
```

**Optimized (O(1) removal)**:
```go
queue := utils.Deque[int]{}
queue.PushBack(1)
queue.PushBack(2)
val := queue.PopFront()  // O(1) removal
```

---

### 3. Choose Right Queue Type

| Use Case                     | Recommended Queue  | Reason                          |
|------------------------------|--------------------|---------------------------------|
| Simple FIFO/LIFO             | `Deque[T]`         | Lower overhead                  |
| Producer-Consumer            | `BQueue[T]`        | Blocking synchronization        |
| Unbounded growth             | `Deque[T]`         | No capacity limit               |
| Bounded buffer               | `BQueue[T]`        | Hard capacity limit             |
| Multi-reader/writer          | `BQueue[T]`        | Better concurrency control      |

---

### 4. Avoid Unnecessary Transformations

**Inefficient**:
```go
// Multiple passes over data
filtered := utils.FilterSlice(data, predicate1)
transformed := utils.TransformSlice(filtered, transform1)
final := utils.FilterSlice(transformed, predicate2)
```

**Optimized**:
```go
// Single pass with combined logic
final := make([]ResultType, 0, len(data))
for _, item := range data {
    if predicate1(item) {
        transformed := transform1(item)
        if predicate2(transformed) {
            final = append(final, transformed)
        }
    }
}
```

---

## Testing

### Testing Deque

```go
func TestDequeOperations(t *testing.T) {
    queue := utils.Deque[int]{}
    
    // Test PushBack + PopFront (FIFO)
    queue.PushBack(1)
    queue.PushBack(2)
    queue.PushBack(3)
    
    if got := queue.PopFront(); got != 1 {
        t.Errorf("Expected 1, got %d", got)
    }
    
    // Test Length
    if queue.Length() != 2 {
        t.Errorf("Expected length 2, got %d", queue.Length())
    }
}
```

---

### Testing BQueue

```go
func TestBlockingQueue(t *testing.T) {
    queue := utils.NewBlockingQueue[string](2)
    
    // Test Put
    queue.Put("A")
    queue.Put("B")
    
    // Test Take (FIFO)
    if got := queue.Take(); got != "A" {
        t.Errorf("Expected A, got %s", got)
    }
}
```

---

### Testing Functional Utilities

```go
func TestTransformSlice(t *testing.T) {
    input := []int{1, 2, 3}
    expected := []int{2, 4, 6}
    
    got := utils.TransformSlice(input, func(n int) int {
        return n * 2
    })
    
    if !reflect.DeepEqual(got, expected) {
        t.Errorf("Expected %v, got %v", expected, got)
    }
}

func TestFilterSlice(t *testing.T) {
    input := []int{1, 2, 3, 4, 5}
    expected := []int{2, 4}
    
    got := utils.FilterSlice(input, func(n int) bool {
        return n%2 == 0
    })
    
    if !reflect.DeepEqual(got, expected) {
        t.Errorf("Expected %v, got %v", expected, got)
    }
}
```

---

## FAQ

### Q1: Is Deque thread-safe?
**A**: Yes, all operations use `sync.RWMutex` for synchronization. However, `Print()` is unsafe and should only be used for debugging.

---

### Q2: What happens if I pop from an empty Deque?
**A**: It returns the zero value of type `T`. Check `Length()` before popping to avoid confusion.

```go
if queue.Length() > 0 {
    val := queue.PopFront()
}
```

---

### Q3: Can BQueue deadlock?
**A**: Yes, if all goroutines are blocked waiting. Ensure you have both producers and consumers.

**Deadlock Example**:
```go
queue := utils.NewBlockingQueue[int](5)
// No producer goroutine
val := queue.Take()  // Blocks forever
```

---

### Q4: Why use TransformSlice instead of Map?
**A**: `TransformSlice` is the newer API with better naming. Both work identically, but `TransformSlice` is recommended for new code.

---

### Q5: How do I handle errors in transformation pipelines?
**A**: The functional utilities don't support error returns. Handle errors explicitly:

```go
type Result struct {
    Value int
    Err   error
}

results := utils.TransformSlice(data, func(item Item) Result {
    val, err := processItem(item)
    return Result{Value: val, Err: err}
})

// Check for errors
for _, r := range results {
    if r.Err != nil {
        log.Printf("Error: %v", r.Err)
    }
}
```

---

### Q6: Can I use BQueue with custom types?
**A**: Yes, but the type must be `comparable`. For non-comparable types, use pointers:

```go
// Won't compile (slice is not comparable)
queue := utils.NewBlockingQueue[[]int](10)

// Use pointer instead
queue := utils.NewBlockingQueue[*[]int](10)
```

**Note**: This is a bug. `BQueue` should accept `any`, not `comparable`.

---

### Q7: How do I stop a blocking Take/Put operation?
**A**: Use context or channels for timeout/cancellation:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

done := make(chan int)

go func() {
    val := queue.Take()
    done <- val
}()

select {
case val := <-done:
    fmt.Printf("Got: %d\n", val)
case <-ctx.Done():
    fmt.Println("Operation timed out")
}
```

---

### Q8: What's the difference between Map and TransformSlice?
**A**: Only naming and type constraints:

| Function         | Type Constraint     | Recommended |
|------------------|---------------------|-------------|
| `Map`            | `T, V comparable`   | ❌ (Legacy) |
| `TransformSlice` | `T, V any`          | ✅ (Modern) |

---

### Q9: How do I process large datasets without exhausting memory?
**A**: Use `ChunkSlice` to process in batches:

```go
data := make([]int, 1_000_000)
batches := utils.ChunkSlice(data, 1000)  // 1000 items per batch

for _, batch := range batches {
    processBatch(batch)
    // Only 1000 items in memory at a time
}
```

---

### Q10: Can I use Deque as a stack?
**A**: Yes, use `PushBack` + `PopBack`:

```go
stack := utils.Deque[string]{}
stack.PushBack("A")  // Push
stack.PushBack("B")
val := stack.PopBack()  // Pop (LIFO)
```

---

## Summary

The `utils` package provides:

- **Deque[T]**: Thread-safe double-ended queue for flexible data management
- **BQueue[T]**: Blocking queue for producer-consumer patterns
- **Functional Utilities**: Map, Filter, Reduce, GroupBy for declarative programming
- **System Helpers**: Checksum, validation, conversions for common tasks

**Key Takeaways**:
- Use `Deque` for general-purpose queues/stacks
- Use `BQueue` for producer-consumer synchronization
- Prefer new API (`TransformSlice`, `FilterSlice`) over legacy (`Map`, `Filter`)
- Pre-allocate slices for better performance
- Check `Length()` before popping from `Deque` to avoid zero-value confusion

For detailed implementation and design rationale, see [DESIGN.md](DESIGN.md).
