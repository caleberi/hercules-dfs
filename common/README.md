# Common Package - Shared Types and Constants

## Overview

The **Common** package provides the foundational type definitions and system-wide constants for the Hercules distributed file system. It serves as a contract between all components (Master Server, ChunkServers, Gateway, and clients), ensuring type safety, consistency, and clear semantics across the distributed system.

**Key Features:**
- 🔒 **Strong Typing:** Type aliases prevent parameter confusion and catch bugs at compile time
- 📋 **Shared Contracts:** Single source of truth for data structures across all components
- ⚙️ **System Configuration:** Centralized constants for timeouts, limits, and intervals
- 📊 **Rich Metadata:** Comprehensive structures for monitoring and debugging
- 🚀 **Zero Dependencies:** Pure Go stdlib, no external dependencies

**Package Contents:**
- `types.go`: Core type definitions and data structures
- `constants.go`: System-wide configuration constants and events

## Installation

The Common package is part of the Hercules distributed file system:

```bash
# Clone repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# The common package is automatically available to all components
import "github.com/caleberi/hercules-dfs/common"
```

## Quick Start

### Basic Type Usage

```go
package main

import (
    "fmt"
    "github.com/caleberi/hercules-dfs/common"
)

func main() {
    // Strong typed identifiers
    handle := common.ChunkHandle(12345)
    version := common.ChunkVersion(1)
    offset := common.Offset(1024)
    
    // Type safety prevents mistakes
    processChunk(handle, version, offset)  // ✓ Correct
    // processChunk(version, handle, offset)  // ✗ Compile error
    
    // Error handling
    err := common.Error{
        Code: common.AppendExceedChunkSize,
        Err:  "append size exceeds chunk limit",
    }
    
    if err.Code == common.AppendExceedChunkSize {
        fmt.Println("Need to create new chunk")
    }
}

func processChunk(h common.ChunkHandle, v common.ChunkVersion, o common.Offset) {
    fmt.Printf("Processing chunk %d, version %d at offset %d\n", h, v, o)
}
```

### Using Constants

```go
package main

import (
    "fmt"
    "time"
    "github.com/caleberi/hercules-dfs/common"
)

func main() {
    // Chunk size limits
    maxChunkSize := common.ChunkMaxSizeInByte  // 67,108,864 bytes (64MB)
    maxAppendSize := common.AppendMaxSizeInByte  // 16,777,216 bytes (16MB)
    
    fmt.Printf("Chunk size: %d bytes\n", maxChunkSize)
    fmt.Printf("Max append: %d bytes\n", maxAppendSize)
    
    // Time intervals
    heartbeat := common.HeartBeatInterval  // 5 seconds
    timeout := common.LeaseTimeout  // 60 seconds
    
    fmt.Printf("Heartbeat every %v\n", heartbeat)
    fmt.Printf("Lease timeout: %v\n", timeout)
    
    // Event types
    event := common.HeartBeat
    fmt.Printf("Scheduling event: %s\n", event)
}
```

## API Reference

### Type Aliases

Strong type aliases that provide compile-time safety while maintaining zero runtime overhead.

#### ChunkHandle

```go
type ChunkHandle int64
```

Globally unique identifier for a chunk (64MB data block).

**Example:**
```go
handle := common.ChunkHandle(12345)
fmt.Printf("Chunk handle: %d\n", handle)
```

**Semantics:**
- Allocated sequentially by Master Server
- Immutable once assigned
- Valid range: [1, 2^63-1] (0 = invalid)

**Usage:**
```go
// Master allocates new handle
nextHandle := common.ChunkHandle(currentHandle + 1)

// Store in metadata
chunkInfo := common.PersistedChunkInfo{
    Handle: nextHandle,
    // ...
}
```

---

#### ChunkVersion

```go
type ChunkVersion int64
```

Tracks mutation history for consistency and stale replica detection.

**Example:**
```go
version := common.ChunkVersion(5)
fmt.Printf("Chunk version: %d\n", version)
```

**Versioning:**
- Starts at 0 (newly created chunk)
- Increments on each successful mutation
- Used to detect stale replicas

**Usage:**
```go
// Increment version after write
currentVersion := common.ChunkVersion(3)
newVersion := currentVersion + 1  // ChunkVersion(4)

// Detect stale replica
if replicaVersion < masterVersion {
    // Replica is stale, needs re-replication
}
```

---

#### ChunkIndex

```go
type ChunkIndex int64
```

Logical position of a chunk within a file (0-based).

**Example:**
```go
index := common.ChunkIndex(2)  // Third chunk in file
fmt.Printf("Chunk index: %d\n", index)
```

**Calculation:**
```go
fileOffset := int64(150 * 1024 * 1024)  // 150MB into file
chunkIndex := common.ChunkIndex(fileOffset / common.ChunkMaxSizeInByte)
// Result: ChunkIndex(2) - third chunk (chunks 0, 1, 2)
```

**Example File Layout:**
```
File: 200MB
├─ Chunk 0 (index=0, handle=1001): bytes [0, 64MB)
├─ Chunk 1 (index=1, handle=1002): bytes [64MB, 128MB)
├─ Chunk 2 (index=2, handle=1003): bytes [128MB, 192MB)
└─ Chunk 3 (index=3, handle=1004): bytes [192MB, 200MB)
```

---

#### Offset

```go
type Offset int64
```

Byte offset within a chunk or file.

**Example:**
```go
offset := common.Offset(4096)  // Byte 4096
fmt.Printf("Offset: %d bytes\n", offset)
```

**Usage Contexts:**

**Chunk-relative offset:**
```go
mutation := common.Mutation{
    MutationType: common.MutationWrite,
    Data:         []byte("hello"),
    Offset:       common.Offset(1024),  // Write at byte 1024 of chunk
}
```

**File-relative offset:**
```go
fileOffset := common.Offset(100 * 1024 * 1024)  // 100MB into file
chunkIndex := common.ChunkIndex(int64(fileOffset) / common.ChunkMaxSizeInByte)
chunkOffset := common.Offset(int64(fileOffset) % common.ChunkMaxSizeInByte)
```

---

#### ServerAddr

```go
type ServerAddr string
```

Network address of a Hercules server.

**Format:** `"host:port"`

**Examples:**
```go
addr1 := common.ServerAddr("localhost:9001")
addr2 := common.ServerAddr("10.0.1.5:9001")
addr3 := common.ServerAddr("chunkserver-1.example.com:9001")
```

**Usage:**
```go
lease := common.Lease{
    Primary:     common.ServerAddr("cs-1:9001"),
    Secondaries: []common.ServerAddr{
        common.ServerAddr("cs-2:9001"),
        common.ServerAddr("cs-3:9001"),
    },
}
```

---

#### ErrorCode

```go
type ErrorCode int
```

Application-level error classification.

**Error Codes:**
```go
const (
    Success = iota              // 0: Operation succeeded
    UnknownError                // 1: Unspecified error
    Timeout                     // 2: Operation timed out
    AppendExceedChunkSize       // 3: Append would exceed chunk size
    WriteExceedChunkSize        // 4: Write would exceed chunk size
    ReadEOF                     // 5: Read beyond end of file
    NotAvailableForCopy         // 6: Chunk not available for replication
    DownloadBufferMiss          // 7: Data not in download buffer
)
```

**Usage:**
```go
if err.Code == common.Timeout {
    // Retry with backoff
    time.Sleep(retryDelay)
    return retry()
} else if err.Code == common.AppendExceedChunkSize {
    // Create new chunk
    return createNewChunk()
}
```

---

#### Event

```go
type Event string
```

Identifies scheduled background tasks.

**Predefined Events:**
```go
const (
    HeartBeat         Event = "HeartBeat"
    GarbageCollection Event = "GarbageCollection"
    PersistMetaData   Event = "PersistMetaData"
    PersistOpsLog     Event = "PersistOpsLog"
    MasterHeartBeat   Event = "MasterHeartBeat"
    Archival          Event = "Archival"
)
```

**Usage:**
```go
// Schedule periodic event
event := common.HeartBeat
ticker := time.NewTicker(common.HeartBeatInterval)

for range ticker.C {
    executeEvent(event)
}
```

---

### Data Structures

#### Error

```go
type Error struct {
    Code ErrorCode
    Err  string
}

func (e Error) Error() string {
    return e.Err
}
```

Application error with structured error code.

**Creating Errors:**
```go
err := common.Error{
    Code: common.AppendExceedChunkSize,
    Err:  "append size 20MB exceeds limit 16MB",
}
```

**Checking Error Codes:**
```go
func handleError(err error) {
    if hercErr, ok := err.(common.Error); ok {
        switch hercErr.Code {
        case common.Timeout:
            // Retry
        case common.AppendExceedChunkSize:
            // Create new chunk
        default:
            // Log error
        }
    }
}
```

---

#### PathInfo

```go
type PathInfo struct {
    Path   string
    Name   string
    IsDir  bool
    Length int64
    Chunks int64
}
```

File or directory metadata for namespace operations.

**Example:**
```go
fileInfo := common.PathInfo{
    Path:   "/data/large-file.bin",
    Name:   "large-file.bin",
    IsDir:  false,
    Length: 134217728,  // 128MB
    Chunks: 2,          // 2 chunks (64MB each)
}

dirInfo := common.PathInfo{
    Path:   "/data/photos",
    Name:   "photos",
    IsDir:  true,
    Length: 0,
    Chunks: 0,
}
```

**Calculating Chunks:**
```go
func calculateChunks(fileSize int64) int64 {
    chunks := fileSize / common.ChunkMaxSizeInByte
    if fileSize%common.ChunkMaxSizeInByte != 0 {
        chunks++
    }
    return chunks
}
```

---

#### BufferId

```go
type BufferId struct {
    Handle    ChunkHandle
    Timestamp int64
}
```

Unique identifier for download buffer cache entries.

**Purpose:** Prevents cache collisions during concurrent writes to the same chunk.

**Example:**
```go
// Client 1 writes chunk 123 at time T1
bufferId1 := common.BufferId{
    Handle:    common.ChunkHandle(123),
    Timestamp: time.Now().Unix(),
}

// Client 2 writes chunk 123 at time T2
bufferId2 := common.BufferId{
    Handle:    common.ChunkHandle(123),
    Timestamp: time.Now().Unix(),
}

// Different cache entries, no collision
```

---

#### Mutation

```go
type Mutation struct {
    MutationType MutationType
    Data         []byte
    Offset       Offset
}
```

Encapsulates a write operation.

**Mutation Types:**
```go
const (
    MutationAppend = (iota + 1) << 1  // 2: Atomic append
    MutationWrite                      // 4: Positional write
    MutationPad                        // 8: Zero padding
)
```

**Examples:**

**Atomic Append:**
```go
mutation := common.Mutation{
    MutationType: common.MutationAppend,
    Data:         []byte("log entry\n"),
    Offset:       -1,  // Offset determined by ChunkServer
}
```

**Positional Write:**
```go
mutation := common.Mutation{
    MutationType: common.MutationWrite,
    Data:         []byte("update"),
    Offset:       common.Offset(4096),  // Write at byte 4096
}
```

**Zero Padding:**
```go
mutation := common.Mutation{
    MutationType: common.MutationPad,
    Data:         nil,
    Offset:       common.Offset(8192),  // Pad to byte 8192
}
```

---

#### PersistedChunkInfo

```go
type PersistedChunkInfo struct {
    Handle               ChunkHandle
    Version              ChunkVersion
    Length               Offset
    Checksum             Checksum
    Mutations            map[ChunkVersion]Mutation
    Completed, Abandoned bool
    ChunkSize            int64
    CreationTime         time.Time
    LastModified         time.Time
    AccessTime           time.Time
    Replication          int
    ServerStatus         int
    MetadataVersion      int
    StatusFlags          []string
}
```

Complete metadata for chunk persistence (written to disk).

**Example:**
```go
chunkInfo := common.PersistedChunkInfo{
    Handle:          common.ChunkHandle(12345),
    Version:         common.ChunkVersion(3),
    Length:          common.Offset(33554432),  // 32MB
    Checksum:        common.Checksum("a1b2c3d4..."),
    Mutations:       make(map[common.ChunkVersion]common.Mutation),
    Completed:       false,
    Abandoned:       false,
    ChunkSize:       common.ChunkMaxSizeInByte,
    CreationTime:    time.Now(),
    LastModified:    time.Now(),
    AccessTime:      time.Now(),
    Replication:     common.MinimumReplicationFactor,
    ServerStatus:    1,  // Active
    MetadataVersion: 1,
    StatusFlags:     []string{"healthy", "replicated"},
}
```

**Saving to Disk:**
```go
// Serialize and write to chunk.server.meta
data, _ := json.Marshal(chunkInfo)
os.WriteFile(common.ChunkMetaDataFileName, data, 0644)
```

---

#### Lease

```go
type Lease struct {
    Handle      ChunkHandle
    Expire      time.Time
    InUse       bool
    Primary     ServerAddr
    Secondaries []ServerAddr
}

func (ls *Lease) IsExpired(u time.Time) bool {
    return ls.Expire.Before(u)
}
```

Temporary write permission for chunk mutations.

**Example:**
```go
lease := common.Lease{
    Handle:  common.ChunkHandle(123),
    Expire:  time.Now().Add(common.LeaseTimeout),
    InUse:   true,
    Primary: common.ServerAddr("cs-1:9001"),
    Secondaries: []common.ServerAddr{
        common.ServerAddr("cs-2:9001"),
        common.ServerAddr("cs-3:9001"),
    },
}

// Check if lease is still valid
if lease.IsExpired(time.Now()) {
    // Request new lease
}
```

**Lease Protocol:**
```go
// Master grants lease
func grantLease(handle common.ChunkHandle) common.Lease {
    return common.Lease{
        Handle:      handle,
        Expire:      time.Now().Add(common.LeaseTimeout),
        InUse:       true,
        Primary:     selectPrimary(),
        Secondaries: selectSecondaries(),
    }
}

// Client writes using lease
func writeWithLease(lease common.Lease, data []byte) error {
    if lease.IsExpired(time.Now()) {
        return common.Error{
            Code: common.Timeout,
            Err:  "lease expired",
        }
    }
    
    // Send mutation to Primary
    return sendToPrimary(lease.Primary, data)
}
```

---

#### FileInfo

```go
type FileInfo struct {
    IsDir  bool
    Length int64
    Chunks int64
}
```

Lightweight file metadata (no path information).

**Example:**
```go
info := common.FileInfo{
    IsDir:  false,
    Length: 134217728,  // 128MB
    Chunks: 2,          // 2 chunks
}

if info.IsDir {
    fmt.Println("This is a directory")
} else {
    fmt.Printf("File size: %d bytes in %d chunks\n", info.Length, info.Chunks)
}
```

---

#### Memory

```go
type Memory struct {
    Alloc, TotalAlloc, Sys, NumGC float64
}
```

Runtime memory statistics for monitoring.

**Example:**
```go
import "runtime"

func getMemoryStats() common.Memory {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    
    return common.Memory{
        Alloc:      float64(m.Alloc) / 1024 / 1024,      // MB
        TotalAlloc: float64(m.TotalAlloc) / 1024 / 1024, // MB
        Sys:        float64(m.Sys) / 1024 / 1024,        // MB
        NumGC:      float64(m.NumGC),
    }
}

// Monitor memory
stats := getMemoryStats()
fmt.Printf("Alloc: %.2f MB, Sys: %.2f MB, GC cycles: %.0f\n",
    stats.Alloc, stats.Sys, stats.NumGC)
```

---

### Constants

#### Chunk Size

```go
const (
    ChunkMaxSizeInMb   = 64
    ChunkMaxSizeInByte = 64 << 20  // 67,108,864 bytes
    AppendMaxSizeInByte = ChunkMaxSizeInByte / 4  // 16,777,216 bytes
)
```

**Usage:**
```go
// Check if write exceeds chunk size
if writeSize > common.ChunkMaxSizeInByte {
    return common.Error{
        Code: common.WriteExceedChunkSize,
        Err:  "write too large",
    }
}

// Check if append exceeds limit
if appendSize > common.AppendMaxSizeInByte {
    return common.Error{
        Code: common.AppendExceedChunkSize,
        Err:  "append too large",
    }
}
```

---

#### Time Intervals

```go
const (
    // ChunkServer intervals
    HeartBeatInterval         = 5 * time.Second
    GarbageCollectionInterval = 5 * time.Minute
    PersistMetaDataInterval   = 10 * time.Minute
    
    // Master Server intervals
    ServerHealthCheckInterval = 10 * time.Second
    ServerHealthCheckTimeout  = 60 * time.Second
    MasterPersistMetaInterval = 15 * time.Hour
    
    // Lease
    LeaseTimeout = 60 * time.Second
    
    // Download Buffer
    DownloadBufferItemExpire = 10 * time.Second
    DownloadBufferTick       = 10 * time.Second
    
    // Archival
    ArchivalDaySpan          = 5
    ArchiveChunkInterval     = ArchivalDaySpan * 24 * time.Hour
    
    // Failure Detection
    FailureDetectorKeyExipiryTime = 5 * time.Minute
)
```

**Usage:**
```go
// ChunkServer heartbeat
ticker := time.NewTicker(common.HeartBeatInterval)
for range ticker.C {
    sendHeartbeat()
}

// Lease expiration check
if time.Since(lease.Expire) > common.LeaseTimeout {
    // Lease expired
}

// Garbage collection
gcTicker := time.NewTicker(common.GarbageCollectionInterval)
for range gcTicker.C {
    collectGarbage()
}
```

---

#### Replication

```go
const MinimumReplicationFactor = 3
```

**Usage:**
```go
// Ensure minimum replication
if len(replicas) < common.MinimumReplicationFactor {
    // Need more replicas
    createNewReplicas()
}
```

---

#### File Names and Formats

```go
const (
    DeletedNamespaceFilePrefix = "___deleted__"
    ChunkMetaDataFileName      = "chunk.server.meta"
    ChunkFileNameFormat        = "chunk-%v.chk"
    MasterMetaDataFileName     = "master.server.meta"
    FileMode                   = 0755
)
```

**Usage:**
```go
// Generate chunk file name
chunkFile := fmt.Sprintf(common.ChunkFileNameFormat, handle)
// Result: "chunk-12345.chk"

// Check if file is deleted
if strings.HasPrefix(path, common.DeletedNamespaceFilePrefix) {
    // This is a deleted file
}

// Create file with standard permissions
os.OpenFile(filename, os.O_CREATE, common.FileMode)
```

---

## Usage Patterns

### Type-Safe Function Parameters

```go
// Good: Compiler enforces correct types
func updateChunk(handle common.ChunkHandle, version common.ChunkVersion, offset common.Offset) error {
    fmt.Printf("Updating chunk %d v%d at offset %d\n", handle, version, offset)
    return nil
}

// Call site
handle := common.ChunkHandle(123)
version := common.ChunkVersion(5)
offset := common.Offset(1024)

updateChunk(handle, version, offset)  // ✓ Correct
// updateChunk(version, handle, offset)  // ✗ Compile error
```

### Error Handling Pattern

```go
func performOperation() error {
    err := someOperation()
    if err != nil {
        return common.Error{
            Code: common.UnknownError,
            Err:  fmt.Sprintf("operation failed: %v", err),
        }
    }
    return nil
}

func main() {
    err := performOperation()
    if err != nil {
        if hercErr, ok := err.(common.Error); ok {
            switch hercErr.Code {
            case common.Success:
                // Success
            case common.Timeout:
                // Retry
            case common.AppendExceedChunkSize:
                // Handle limit
            default:
                // Log error
            }
        }
    }
}
```

### Lease Management Pattern

```go
type LeaseManager struct {
    leases map[common.ChunkHandle]*common.Lease
}

func (lm *LeaseManager) grantLease(handle common.ChunkHandle) *common.Lease {
    lease := &common.Lease{
        Handle:      handle,
        Expire:      time.Now().Add(common.LeaseTimeout),
        InUse:       true,
        Primary:     lm.selectPrimary(),
        Secondaries: lm.selectSecondaries(),
    }
    
    lm.leases[handle] = lease
    return lease
}

func (lm *LeaseManager) checkLease(handle common.ChunkHandle) bool {
    lease, exists := lm.leases[handle]
    if !exists {
        return false
    }
    
    return !lease.IsExpired(time.Now())
}
```

### Mutation Processing Pattern

```go
func processMutation(mutation common.Mutation) error {
    switch mutation.MutationType {
    case common.MutationAppend:
        return handleAppend(mutation.Data)
        
    case common.MutationWrite:
        return handleWrite(mutation.Data, mutation.Offset)
        
    case common.MutationPad:
        return handlePad(mutation.Offset)
        
    default:
        return common.Error{
            Code: common.UnknownError,
            Err:  "unknown mutation type",
        }
    }
}
```

### Chunk Metadata Persistence

```go
func saveChunkMetadata(info common.PersistedChunkInfo) error {
    data, err := json.Marshal(info)
    if err != nil {
        return err
    }
    
    return os.WriteFile(common.ChunkMetaDataFileName, data, common.FileMode)
}

func loadChunkMetadata() (common.PersistedChunkInfo, error) {
    data, err := os.ReadFile(common.ChunkMetaDataFileName)
    if err != nil {
        return common.PersistedChunkInfo{}, err
    }
    
    var info common.PersistedChunkInfo
    err = json.Unmarshal(data, &info)
    return info, err
}
```

---

## Best Practices

### 1. Always Use Type Aliases

```go
// ✓ Good: Type safe
func readChunk(handle common.ChunkHandle) error { }

// ✗ Bad: No type safety
func readChunk(handle int64) error { }
```

### 2. Check Error Codes

```go
// ✓ Good: Handle specific errors
if err != nil {
    if hercErr, ok := err.(common.Error); ok {
        switch hercErr.Code {
        case common.Timeout:
            return retry()
        }
    }
}

// ✗ Bad: Ignore error codes
if err != nil {
    return err
}
```

### 3. Validate Sizes

```go
// ✓ Good: Check limits
if len(data) > common.AppendMaxSizeInByte {
    return common.Error{
        Code: common.AppendExceedChunkSize,
        Err:  "data too large",
    }
}

// ✗ Bad: No validation
appendData(data)
```

### 4. Use Constants for Configuration

```go
// ✓ Good: Use defined constants
ticker := time.NewTicker(common.HeartBeatInterval)

// ✗ Bad: Magic numbers
ticker := time.NewTicker(5 * time.Second)
```

### 5. Check Lease Expiration

```go
// ✓ Good: Always check
if lease.IsExpired(time.Now()) {
    return requestNewLease()
}

// ✗ Bad: Assume valid
sendMutation(lease.Primary, data)
```

---

## FAQ

### Q: Why use type aliases instead of just int64?

**A:** Type aliases provide compile-time safety. The compiler prevents you from accidentally passing a `ChunkVersion` where a `ChunkHandle` is expected, catching bugs before runtime.

### Q: Are type aliases slower than primitive types?

**A:** No. Type aliases have zero runtime overhead - they compile to the exact same machine code as their underlying type.

### Q: Can I convert between type aliases?

**A:** Yes, with explicit casts:
```go
handle := common.ChunkHandle(123)
version := common.ChunkVersion(handle)  // Explicit conversion
```

### Q: How do I add new error codes?

**A:** Add to the `const` block and update error handling logic:
```go
const (
    Success = iota
    // ... existing codes ...
    NewErrorCode  // Add here
)
```

### Q: Can I change constants at runtime?

**A:** No, constants are compile-time values. For runtime configuration, use variables initialized from environment or config files.

### Q: What's the difference between PathInfo and FileInfo?

**A:** `PathInfo` includes path and name (for directory listings), while `FileInfo` only has properties (for stat operations).

### Q: How are chunks numbered?

**A:** `ChunkHandle` is a global identifier (unique across system), while `ChunkIndex` is file-relative (position within that file).

### Q: Why 64MB chunk size?

**A:** Balances metadata overhead (fewer chunks) with flexibility (smaller replication units). Proven value from Google File System.

---

## Related Components

- **Master Server:** Uses types for namespace and lease management
- **ChunkServer:** Uses types for chunk storage and replication
- **Gateway:** Uses types for client communication
- **Failure Detector:** Uses Event types and time constants

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

Part of the Hercules distributed file system project.

## Support

- GitHub Issues: https://github.com/caleberi/hercules-dfs/issues
- Documentation: [docs/](../docs/)
- Design Document: [DESIGN.md](DESIGN.md)
