# Common Package Design Documentation

## Overview

The **Common** package serves as the **central type repository and configuration hub** for the Hercules distributed file system. It defines shared data structures, type aliases, error codes, and system-wide constants that establish contracts between all components (Master Server, ChunkServers, Gateway, and clients).

This package is critical because it:
- **Ensures Type Safety:** Strong typing prevents misuse of handles, versions, and addresses
- **Establishes Consistency:** Single source of truth for constants across distributed nodes
- **Enables Evolution:** Centralized types allow protocol versioning and upgrades
- **Documents Protocols:** Type definitions serve as interface documentation

**Design Philosophy:**
- Zero external dependencies (stdlib only)
- Immutable constants for predictable behavior
- Strongly typed aliases to prevent type confusion
- Rich metadata structures for debugging and monitoring

## Architecture

### Package Structure

```
common/
├── types.go       → Core type definitions and data structures
└── constants.go   → System-wide configuration constants
```

**Dependency Graph:**
```
┌─────────────────────────────────────────┐
│           Common Package                │
│  (Types + Constants)                    │
└─────────────────────────────────────────┘
              ↑         ↑         ↑
              │         │         │
     ┌────────┴─┐  ┌────┴─────┐  ┌┴──────────┐
     │ Master   │  │ Chunk    │  │ Gateway   │
     │ Server   │  │ Server   │  │           │
     └──────────┘  └──────────┘  └───────────┘
```

All components import `common`, but `common` imports only standard library.

### Type System Architecture

#### Type Categories

```
Common Types
│
├─ Primitive Aliases (Strong Typing)
│  ├─ ChunkHandle      → int64
│  ├─ ChunkVersion     → int64
│  ├─ ChunkIndex       → int64
│  ├─ Offset           → int64
│  ├─ ServerAddr       → string
│  ├─ Checksum         → string
│  ├─ Event            → string
│  ├─ Path             → string
│  ├─ ErrorCode        → int
│  └─ MutationType     → int
│
├─ Data Transfer Objects (Wire Format)
│  ├─ PathInfo         → File metadata
│  ├─ FileInfo         → File properties
│  ├─ BufferId         → Cache key
│  └─ MachineInfo      → Server metrics
│
├─ Persistence Objects (Disk Format)
│  ├─ PersistedChunkInfo → Chunk metadata
│  └─ Lease              → Chunk lease state
│
├─ Control Flow
│  ├─ Error            → Application errors
│  ├─ Mutation         → Write operations
│  └─ BranchInfo       → Event handling
│
└─ System Monitoring
   └─ Memory           → Resource tracking
```

## Type Definitions

### Primitive Type Aliases

#### Design Pattern: Strong Typing via Aliases

**Problem:** Using raw `int64` everywhere allows type confusion:
```go
// BAD: Easy to mix up
func ReadChunk(handle int64, version int64, offset int64) { }
ReadChunk(123, 456, 789)  // Which is which?
ReadChunk(offset, handle, version)  // Compiles but wrong!
```

**Solution:** Distinct types prevent misuse:
```go
// GOOD: Compiler enforces correctness
func ReadChunk(handle ChunkHandle, version ChunkVersion, offset Offset) { }
ReadChunk(ChunkHandle(123), ChunkVersion(456), Offset(789))  // Clear
ReadChunk(offset, handle, version)  // Compile error ✓
```

#### Type Semantics

##### ChunkHandle
```go
type ChunkHandle int64
```

**Purpose:** Globally unique identifier for a chunk (64MB data block)

**Semantics:**
- Master Server allocates sequentially (monotonically increasing)
- Immutable once assigned
- Used as primary key in chunk metadata storage
- Valid range: [1, 2^63 - 1] (0 reserved for invalid/null)

**Lifecycle:**
```
1. Client requests file write
2. Master allocates new ChunkHandle (e.g., 12345)
3. Master assigns chunk to ChunkServers
4. Handle persists for chunk lifetime
5. Handle reused only after garbage collection (optional)
```

**Example Values:**
- `ChunkHandle(0)`: Invalid/null handle
- `ChunkHandle(1)`: First chunk in system
- `ChunkHandle(9876543210)`: Valid handle after billions of allocations

##### ChunkVersion
```go
type ChunkVersion int64
```

**Purpose:** Tracks mutation history of a chunk for consistency

**Semantics:**
- Increments on each successful mutation
- Master maintains authoritative version
- ChunkServers report their version during heartbeat
- Detects stale replicas (version mismatch)

**Versioning Protocol:**
```
Initial:   ChunkVersion(0)
Write #1:  ChunkVersion(1)  ← Master increments
Write #2:  ChunkVersion(2)
...
```

**Stale Replica Detection:**
```
Master:      version = 5
ChunkServer: version = 3  ← Stale (missed 2 mutations)
             → Marked for re-replication
```

##### ChunkIndex
```go
type ChunkIndex int64
```

**Purpose:** Logical position of chunk within a file

**Semantics:**
- 0-based index
- `index * ChunkSize = byte offset` in file
- Independent of `ChunkHandle` (handle is global, index is per-file)

**Example:**
```
File: 200MB (requires 4 chunks at 64MB each)

Chunk 0: index=0, handle=1001, bytes [0, 67108864)
Chunk 1: index=1, handle=1002, bytes [67108864, 134217728)
Chunk 2: index=2, handle=1003, bytes [134217728, 201326592)
Chunk 3: index=3, handle=1004, bytes [201326592, 209715200)
```

**Calculation:**
```go
chunkIndex := ChunkIndex(fileOffset / ChunkMaxSizeInByte)
```

##### Offset
```go
type Offset int64
```

**Purpose:** Byte offset within a chunk or file

**Semantics:**
- 0-based byte position
- For chunks: [0, ChunkMaxSizeInByte)
- For files: [0, fileSize)

**Usage Contexts:**

1. **Chunk-relative offset:**
```go
type Mutation struct {
    Offset Offset  // Offset within this specific chunk
}
// Write "hello" at byte 100 of chunk
mutation := Mutation{Offset: 100, Data: []byte("hello")}
```

2. **File-relative offset:**
```go
// Read from byte 100MB in file
fileOffset := Offset(100 * 1024 * 1024)
chunkIndex := ChunkIndex(fileOffset / ChunkMaxSizeInByte)
chunkOffset := Offset(fileOffset % ChunkMaxSizeInByte)
```

##### ServerAddr
```go
type ServerAddr string
```

**Purpose:** Network address of a Hercules server

**Format:** `"host:port"` or `"ip:port"`

**Examples:**
- `ServerAddr("localhost:9001")`
- `ServerAddr("10.0.1.5:9001")`
- `ServerAddr("chunkserver-1.example.com:9001")`

**Validation (not enforced by type):**
```go
// Should match: host:port
// host: hostname, IPv4, or [IPv6]
// port: 1-65535
```

**Usage:**
```go
type Lease struct {
    Primary     ServerAddr
    Secondaries []ServerAddr
}
```

##### Checksum
```go
type Checksum string
```

**Purpose:** Data integrity verification

**Format:** Implementation-defined (likely hex-encoded hash)

**Typical Encoding:**
```go
// MD5 example
checksum := Checksum("5d41402abc4b2a76b9719d911017c592")

// SHA256 example  
checksum := Checksum("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
```

**Usage:**
```go
type PersistedChunkInfo struct {
    Checksum Checksum  // Verify chunk integrity
}
```

##### Event
```go
type Event string
```

**Purpose:** Identifies scheduled background tasks

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

**Event Semantics:**

| Event | Executor | Interval | Purpose |
|-------|----------|----------|---------|
| `HeartBeat` | ChunkServer | 5s | Report health to Master |
| `GarbageCollection` | ChunkServer | 5min | Delete orphaned chunks |
| `PersistMetaData` | ChunkServer | 10min | Flush metadata to disk |
| `PersistOpsLog` | Master | Varies | Persist operation log |
| `MasterHeartBeat` | Master | Varies | Check ChunkServer health |
| `Archival` | ChunkServer | 5 days | Archive old chunks |

##### Path
```go
type Path string
```

**Purpose:** File or directory path in namespace

**Format:** POSIX-style path

**Examples:**
```go
Path("/")                  // Root directory
Path("/data/file.txt")     // File path
Path("/data/photos/")      // Directory path
```

**Path Rules:**
- Always absolute (starts with `/`)
- Case-sensitive
- No trailing slash for files
- Trailing slash optional for directories

##### ErrorCode
```go
type ErrorCode int
```

**Purpose:** Application-level error classification

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

**Error Code Semantics:**

| Code | Category | Retry? | Client Action |
|------|----------|--------|---------------|
| `Success` | Success | N/A | Continue |
| `UnknownError` | System | Maybe | Log and retry |
| `Timeout` | Transient | Yes | Retry with backoff |
| `AppendExceedChunkSize` | Limit | No | Create new chunk |
| `WriteExceedChunkSize` | Limit | No | Split write |
| `ReadEOF` | Expected | No | Return partial data |
| `NotAvailableForCopy` | Transient | Yes | Wait and retry |
| `DownloadBufferMiss` | Cache | Yes | Re-pipeline write |

##### MutationType
```go
type MutationType int
```

**Purpose:** Classifies write operations

**Mutation Types:**
```go
const (
    MutationAppend = (iota + 1) << 1  // 2: Append to end
    MutationWrite                      // 4: Positional write
    MutationPad                        // 8: Pad with zeros
)
```

**Mutation Semantics:**

**MutationAppend (Atomic Append):**
```go
// Append data to chunk end (GFS atomic record append)
mutation := Mutation{
    MutationType: MutationAppend,
    Data:         []byte("log entry"),
    Offset:       -1,  // Offset determined by ChunkServer
}
// Guarantees: Atomicity, at-least-once semantics
// Offset chosen by primary, may have padding for alignment
```

**MutationWrite (Positional Write):**
```go
// Write data at specific offset
mutation := Mutation{
    MutationType: MutationWrite,
    Data:         []byte("update"),
    Offset:       1024,  // Explicit position
}
// Guarantees: Overwrites existing data, defined semantics on concurrent writes
```

**MutationPad (Zero Padding):**
```go
// Extend chunk with zeros (for alignment or sparse files)
mutation := Mutation{
    MutationType: MutationPad,
    Data:         nil,  // No data needed
    Offset:       2048,  // Pad up to this offset
}
```

### Composite Types

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

**Purpose:** Application-level error with structured code

**Design Pattern:** Implements `error` interface for Go error handling

**Usage:**
```go
// Create error
err := Error{
    Code: AppendExceedChunkSize,
    Err:  "append size 20MB exceeds chunk limit 64MB",
}

// Check error code
if err.Code == AppendExceedChunkSize {
    // Handle chunk size limit
}

// Use as standard error
return err  // Satisfies error interface
```

**Benefits:**
- Machine-readable error codes for programmatic handling
- Human-readable messages for logging
- Type assertion to recover error code:
```go
if hercErr, ok := err.(Error); ok {
    switch hercErr.Code {
    case Timeout:
        // Retry
    case AppendExceedChunkSize:
        // Create new chunk
    }
}
```

#### PathInfo
```go
type PathInfo struct {
    Path   string
    Name   string
    IsDir  bool
    Length int64
    Chunk  int64
}
```

**Purpose:** File/directory metadata for namespace operations

**Field Semantics:**

| Field | Type | Meaning | Example |
|-------|------|---------|---------|
| `Path` | `string` | Absolute path | `/data/file.txt` |
| `Name` | `string` | Base name | `file.txt` |
| `IsDir` | `bool` | Directory flag | `false` |
| `Length` | `int64` | File size in bytes | `134217728` (128MB) |
| `Chunk` | `int64` | Number of chunks | `2` (128MB / 64MB) |

**Usage Scenarios:**

1. **List Directory:**
```go
// Master returns directory contents
entries := []PathInfo{
    {Path: "/data/file1.txt", Name: "file1.txt", IsDir: false, Length: 1024, Chunk: 1},
    {Path: "/data/subdir", Name: "subdir", IsDir: true, Length: 0, Chunk: 0},
}
```

2. **File Stat:**
```go
// Client queries file info
info := PathInfo{
    Path:   "/data/large.bin",
    Name:   "large.bin",
    IsDir:  false,
    Length: 200000000,  // 200MB
    Chunk:  4,          // Requires 4 chunks (64MB * 3 + 8MB)
}
```

#### BufferId
```go
type BufferId struct {
    Handle    ChunkHandle
    Timestamp int64
}
```

**Purpose:** Unique key for download buffer cache entries

**Design Rationale:**
- `Handle` alone is insufficient (multiple clients may write same chunk)
- `Timestamp` provides temporal uniqueness
- Combined key prevents cache collisions during concurrent pipelined writes

**Example:**
```go
// Client 1 writes chunk 123 at time T1
bufferId1 := BufferId{Handle: 123, Timestamp: 1609459200}

// Client 2 writes chunk 123 at time T2 (different write)
bufferId2 := BufferId{Handle: 123, Timestamp: 1609459260}

// Different cache entries, no collision
```

**Cache Lookup:**
```go
// Retrieve cached data for specific write operation
data, exists := downloadBuffer.Get(BufferId{
    Handle:    chunkHandle,
    Timestamp: operationTime,
})
```

#### MachineInfo
```go
type MachineInfo struct {
    RoundTripProximityTime float64
    Hostname               string
}
```

**Purpose:** Server performance metrics for replica placement

**Fields:**

- **RoundTripProximityTime:** Network latency in seconds (used for selecting nearby replicas)
- **Hostname:** Server identifier for logging and debugging

**Usage in Replica Selection:**
```go
// Master ranks ChunkServers by proximity
servers := []MachineInfo{
    {RoundTripProximityTime: 0.002, Hostname: "cs-1"},  // 2ms (local rack)
    {RoundTripProximityTime: 0.050, Hostname: "cs-2"},  // 50ms (remote datacenter)
}
// Client prefers cs-1 for reads (lower latency)
```

**Proximity Tiers:**
```
0-10ms:   Same rack
10-50ms:  Same datacenter
50-100ms: Same region
>100ms:   Cross-region
```

#### Mutation
```go
type Mutation struct {
    MutationType MutationType
    Data         []byte
    Offset       Offset
}
```

**Purpose:** Encapsulates a write operation (append or positional write)

**Field Interactions:**

**For Append:**
```go
mutation := Mutation{
    MutationType: MutationAppend,
    Data:         []byte("log entry\n"),
    Offset:       -1,  // Ignored for append (ChunkServer chooses)
}
```

**For Write:**
```go
mutation := Mutation{
    MutationType: MutationWrite,
    Data:         []byte("update"),
    Offset:       4096,  // Write at byte 4096
}
```

**For Pad:**
```go
mutation := Mutation{
    MutationType: MutationPad,
    Data:         nil,     // No data for padding
    Offset:       8192,    // Pad from current length to 8192
}
```

**Validation Rules:**
- `len(Data)` must be ≤ `AppendMaxSizeInByte` for appends (16MB)
- `Offset + len(Data)` must be ≤ `ChunkMaxSizeInByte` for writes (64MB)
- `MutationPad`: `Data` should be `nil`

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

**Purpose:** Complete metadata for chunk persistence (written to disk)

**Field-by-Field Semantics:**

| Field | Type | Purpose | Persistence |
|-------|------|---------|-------------|
| `Handle` | `ChunkHandle` | Chunk identifier | Immutable |
| `Version` | `ChunkVersion` | Current version number | Updated on mutation |
| `Length` | `Offset` | Current data length in bytes | Updated on write |
| `Checksum` | `Checksum` | Data integrity hash | Recomputed on write |
| `Mutations` | `map[ChunkVersion]Mutation` | Pending mutations log | Cleared on commit |
| `Completed` | `bool` | Chunk fully written | Set once |
| `Abandoned` | `bool` | Chunk write abandoned | Set on failure |
| `ChunkSize` | `int64` | Max chunk size (64MB) | Immutable |
| `CreationTime` | `time.Time` | When chunk was created | Immutable |
| `LastModified` | `time.Time` | Last write timestamp | Updated on write |
| `AccessTime` | `time.Time` | Last read timestamp | Updated on read |
| `Replication` | `int` | Replication factor | Config value (3) |
| `ServerStatus` | `int` | ChunkServer state | Runtime status |
| `MetadataVersion` | `int` | Schema version | For upgrades |
| `StatusFlags` | `[]string` | Additional flags | Extensible |

**Persistence Format:**
```
File: chunk.server.meta
Format: JSON or GOB encoding
Contains: Array of PersistedChunkInfo
```

**Example:**
```go
info := PersistedChunkInfo{
    Handle:         ChunkHandle(12345),
    Version:        ChunkVersion(5),
    Length:         Offset(33554432),  // 32MB
    Checksum:       Checksum("a1b2c3..."),
    Mutations:      make(map[ChunkVersion]Mutation),
    Completed:      false,
    Abandoned:      false,
    ChunkSize:      ChunkMaxSizeInByte,
    CreationTime:   time.Now(),
    LastModified:   time.Now(),
    AccessTime:     time.Now(),
    Replication:    3,
    ServerStatus:   1,  // Active
    MetadataVersion: 1,
    StatusFlags:    []string{"replicated", "healthy"},
}
```

**State Transitions:**
```
Created → Writing → Completed
              ↓
          Abandoned (on error)
```

#### FileInfo
```go
type FileInfo struct {
    IsDir  bool
    Length int64
    Chunks int64
}
```

**Purpose:** Lightweight file metadata (no path information)

**Difference from PathInfo:**
- `PathInfo`: Includes path and name (for listings)
- `FileInfo`: Just properties (for stat operations)

**Usage:**
```go
// Return file properties
func GetFileInfo(path string) (FileInfo, error) {
    return FileInfo{
        IsDir:  false,
        Length: 134217728,  // 128MB
        Chunks: 2,          // 2 chunks
    }, nil
}
```

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

**Purpose:** Temporary write permission for chunk mutations

**Lease Protocol:**

```
1. Client requests write on chunk 123
2. Master grants 60-second lease:
   Lease{
       Handle:      123,
       Expire:      now + 60s,
       InUse:       true,
       Primary:     "cs-1:9001",
       Secondaries: ["cs-2:9001", "cs-3:9001"],
   }
3. Client sends mutations to Primary
4. Primary coordinates with Secondaries
5. Lease expires or is released
```

**Lease States:**

| InUse | Expired | State | Action |
|-------|---------|-------|--------|
| `false` | N/A | Available | Can grant |
| `true` | `false` | Active | Write allowed |
| `true` | `true` | Stale | Revoke and re-grant |

**Primary Selection:**
- Master chooses ChunkServer with lowest load
- Primary coordinates mutation order
- Secondaries replicate in same order (consistency)

**Lease Extension:**
```go
// Primary can request extension before expiry
if time.Until(lease.Expire) < 10*time.Second {
    lease.Expire = time.Now().Add(LeaseTimeout)
}
```

**Expiration Check:**
```go
if lease.IsExpired(time.Now()) {
    // Lease has expired, client must request new lease
    return errors.New("lease expired")
}
```

#### Memory
```go
type Memory struct {
    Alloc, TotalAlloc, Sys, NumGC float64
}
```

**Purpose:** Runtime memory statistics for monitoring

**Fields (from `runtime.MemStats`):**

- **Alloc:** Current heap allocation in MB
- **TotalAlloc:** Cumulative heap allocation in MB
- **Sys:** Total memory from OS in MB
- **NumGC:** Number of completed GC cycles

**Usage:**
```go
import "runtime"

func GetMemoryStats() Memory {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return Memory{
        Alloc:      float64(m.Alloc) / 1024 / 1024,
        TotalAlloc: float64(m.TotalAlloc) / 1024 / 1024,
        Sys:        float64(m.Sys) / 1024 / 1024,
        NumGC:      float64(m.NumGC),
    }
}
```

**Monitoring:**
```go
// Track memory growth over time
stats := GetMemoryStats()
log.Printf("Alloc: %.2f MB, Sys: %.2f MB, NumGC: %.0f", 
    stats.Alloc, stats.Sys, stats.NumGC)
```

#### BranchInfo
```go
type BranchInfo struct {
    Err   error
    Event string
}
```

**Purpose:** Event scheduling result (success or error)

**Usage in Event Loop:**
```go
// Schedule periodic event
result := <-eventChannel
branchInfo := result.(BranchInfo)

if branchInfo.Err != nil {
    log.Printf("Event %s failed: %v", branchInfo.Event, branchInfo.Err)
} else {
    log.Printf("Event %s completed successfully", branchInfo.Event)
}
```

**Event Result Patterns:**
```go
// Success
return BranchInfo{
    Err:   nil,
    Event: string(HeartBeat),
}

// Failure
return BranchInfo{
    Err:   errors.New("connection timeout"),
    Event: string(GarbageCollection),
}
```

## Constants Design

### Configuration Philosophy

**Principle:** Constants define system-wide behavior and should be:
1. **Conservative:** Default to safe values
2. **Tunable:** Document how to adjust for workload
3. **Coordinated:** Related constants should align (e.g., intervals)
4. **Versioned:** Changes require compatibility plan

### Time-Based Constants

#### Heartbeat and Health Monitoring

```go
HeartBeatInterval         = 5 * time.Second
ServerHealthCheckInterval = 10 * time.Second
ServerHealthCheckTimeout  = 60 * time.Second
```

**Design Rationale:**

```
Time-based Coordination:
    ChunkServer heartbeat: 5s
    Master health check:   10s (2x heartbeat)
    Timeout threshold:     60s (12x heartbeat, 6x health check)
    
Failure Detection Time:
    Best case: 10s (next health check)
    Worst case: 60s (timeout threshold)
    Expected:  ~30s (statistical average)
```

**Tuning Guidelines:**

| Workload | HeartBeat | HealthCheck | Timeout | Tradeoff |
|----------|-----------|-------------|---------|----------|
| Default | 5s | 10s | 60s | Balanced |
| Low latency | 1s | 2s | 10s | High network overhead |
| Stable cluster | 15s | 30s | 180s | Lower overhead, slower detection |

#### Lease Management

```go
LeaseTimeout = 60 * time.Second
```

**Design Rationale:**
- Long enough to amortize lease acquisition cost
- Short enough to limit impact of failed Primary
- Should be > network round-trip time

**Lease Timeline:**
```
T=0:  Lease granted (60s duration)
T=45: Client may request extension (15s buffer)
T=60: Lease expires, Primary loses authority
```

**Failure Scenario:**
```
T=0:  Lease granted to Primary cs-1
T=30: cs-1 crashes (lease still active for 30s)
T=60: Lease expires, Master grants to new Primary cs-2
```

**Why 60 seconds:**
- Typical write operation: 1-10 seconds
- Allows ~6-60 operations per lease
- Network partition detection: < 60s is acceptable
- GFS paper uses 60s (proven value)

#### Garbage Collection

```go
GarbageCollectionInterval = 5 * time.Minute
```

**Purpose:** Periodically delete orphaned chunks

**Orphaned Chunks:**
- File deleted but chunks still on disk
- Failed writes left partial data
- Re-replication created extra copies

**Interval Rationale:**
- Too frequent: Wastes CPU scanning chunks
- Too infrequent: Wastes disk space
- 5 minutes: Balance between resource usage and space reclamation

**GC Algorithm:**
```
Every 5 minutes:
    1. Enumerate all chunk handles on disk
    2. Query Master for valid handles
    3. Delete handles not recognized by Master
    4. Reclaim disk space
```

#### Metadata Persistence

```go
PersistMetaDataInterval   = 10 * time.Minute  // ChunkServer
MasterPersistMetaInterval = 15 * time.Hour    // Master
```

**ChunkServer Persistence (10 minutes):**
- Writes chunk metadata to disk
- Ensures metadata survives restarts
- 10 minutes: Limits data loss window on crash

**Master Persistence (15 hours):**
- Checkpoints namespace and chunk locations
- Much less frequent (Master state is authoritative)
- Relies on operation log for durability

**Recovery Scenarios:**

**ChunkServer crash:**
```
Last persist: T=0
Crash:        T=8min (lost 8 minutes of metadata updates)
Recovery:     Read metadata from disk, report to Master
              Master may have newer version info
```

**Master crash:**
```
Last checkpoint: T=0
Operation log:   T=0 to T=14 hours (all operations logged)
Crash:           T=14 hours
Recovery:        Load checkpoint + replay operation log = full state
```

#### Archival

```go
ArchivalDaySpan                    = 5
ArchiveChunkInterval time.Duration = ArchivalDaySpan * 24 * time.Hour
```

**Purpose:** Move infrequently accessed chunks to archival storage

**Archival Policy:**
- Chunks not accessed for 5 days are candidates
- Reduces cost by moving to cold storage
- ChunkServer checks every 5 days

**Archival Decision:**
```go
func shouldArchive(chunk PersistedChunkInfo) bool {
    timeSinceAccess := time.Since(chunk.AccessTime)
    return timeSinceAccess > ArchiveChunkInterval
}
```

#### Download Buffer

```go
DownloadBufferItemExpire = 10 * time.Second
DownloadBufferTick       = 10 * time.Second
```

**Purpose:** Cache pipelined write data temporarily

**Design:**
- Items expire after 10 seconds (no reads = wasted cache)
- Tick checks for expired items every 10 seconds
- Aligned intervals simplify logic

**Pipelined Write Flow:**
```
T=0:   Client sends data to replicas
       Primary stores in download buffer
T=0.5: All replicas acknowledge receipt
       Primary applies mutation
T=0.6: Primary responds to client
T=10:  Buffer item expires (no longer needed)
```

### Size-Based Constants

#### Chunk Size

```go
ChunkMaxSizeInMb   = 64
ChunkMaxSizeInByte = 64 << 20  // 67,108,864 bytes
```

**Design Choice: Why 64MB?**

**Advantages:**
- Amortizes metadata overhead (fewer chunks per file)
- Reduces Master memory usage (fewer chunk entries)
- Improves sequential read/write throughput
- Network efficiency (large transfers)

**Disadvantages:**
- Hot chunk problem (popular file = hot chunk)
- Larger replication cost on failure
- More internal fragmentation for small files

**Comparison:**

| Chunk Size | Master Metadata | Hot Chunks | Fragmentation | Network |
|------------|-----------------|------------|---------------|---------|
| 4 MB | 16x more | Less likely | Low | More overhead |
| 64 MB (GFS) | Baseline | More likely | Moderate | Efficient |
| 256 MB | 4x less | Very likely | High | Very efficient |

**GFS Insight:** 64MB works well for large files (100GB+), acceptable for small files

#### Append Limit

```go
AppendMaxSizeInByte = ChunkMaxSizeInByte / 4  // 16 MB
```

**Purpose:** Maximum size for atomic append operation

**Design Rationale:**
- Limit append size to prevent fragmenting chunk space
- 1/4 of chunk size ensures at least 4 appends per chunk
- Reduces internal fragmentation from padding

**Atomic Append Behavior:**
```
Chunk state: 50MB used, 14MB free

Append request: 20MB
Result: Would exceed chunk, append to NEW chunk
        (avoids fragmentation)

Append request: 10MB
Result: Append to current chunk at offset 50MB
        New length: 60MB
```

**Fragmentation Example:**
```
Without limit:
    Append 63MB → Uses whole chunk, 1MB wasted
    
With 16MB limit:
    Append 16MB → Chunk can fit ~4 appends
    Better space utilization
```

### File and Directory Constants

```go
DeletedNamespaceFilePrefix = "___deleted__"
ChunkMetaDataFileName      = "chunk.server.meta"
ChunkFileNameFormat        = "chunk-%v.chk"
MasterMetaDataFileName     = "master.server.meta"
FileMode                   = 0755
```

#### Deleted File Handling

**Pattern:** Soft delete with rename
```go
// Delete /data/file.txt
actualPath := "___deleted__/data/file.txt_timestamp"
```

**Benefits:**
- Fast deletion (rename vs truncate)
- Recovery window before permanent deletion
- Garbage collector handles cleanup

#### Chunk File Naming

**Format:** `chunk-{handle}.chk`

**Example:**
```
chunk-12345.chk  → Chunk with handle 12345
chunk-67890.chk  → Chunk with handle 67890
```

**Reasoning:**
- Handle in filename for easy identification
- `.chk` extension distinguishes from metadata
- Simple format for scripting and debugging

#### Metadata File Names

**ChunkServer:** `chunk.server.meta`
**Master:** `master.server.meta`

**Content:**
- JSON or GOB serialized metadata
- Single file per server simplifies backup
- Well-known name for disaster recovery

#### File Permissions

**0755:** `rwxr-xr-x`
- Owner: Read, Write, Execute
- Group: Read, Execute
- Others: Read, Execute

**Rationale:**
- Allows process owner to manage files
- Other users can read (for monitoring/debugging)
- No world-write (security)

### Replication

```go
MinimumReplicationFactor = 3
```

**Design Choice: Why 3 replicas?**

**Fault Tolerance:**
```
1 replica:  0 failures tolerated
2 replicas: 1 failure tolerated  (but no quorum for writes)
3 replicas: 2 failures tolerated (quorum = 2)
4 replicas: 3 failures tolerated (higher storage cost)
```

**Quorum Writes:**
```
With 3 replicas:
    Write succeeds if 2/3 acknowledge
    Read succeeds if 1/3 responds
    Can tolerate 1 failure during writes
```

**Cost Analysis:**
```
Storage overhead:
    1 replica: 1x (no redundancy)
    2 replicas: 2x
    3 replicas: 3x ← Industry standard
    5 replicas: 5x (expensive)
```

**Google's Choice:** 3 replicas balances availability and cost

### Failure Detector

```go
FailureDetectorKeyExipiryTime = 5 * time.Minute
```

**Purpose:** Redis key TTL for heartbeat tracking

**Design:**
- ChunkServer sends heartbeat every 5 seconds
- Redis key set with 5-minute TTL
- Key expiry = ChunkServer likely failed

**Detection Timeline:**
```
T=0:     Heartbeat received, Redis key TTL = 5min
T=5s:    Heartbeat received, Redis key TTL = 5min (refreshed)
...
T=60s:   ChunkServer crashes (no more heartbeats)
T=5min:  Redis key expires
         Failure detector marks server as failed
```

**Why 5 minutes:**
- Much longer than heartbeat (60x)
- Accounts for temporary network issues
- Prevents false positives from transient failures
- Aligns with lease timeout (60s)

## Design Patterns

### 1. Strong Typing via Type Aliases

**Pattern:**
```go
type ChunkHandle int64
type ChunkVersion int64
type ChunkIndex int64
```

**Benefits:**
- Compiler prevents type confusion
- Self-documenting code
- Refactoring safety (change underlying type without breaking callers)

**Example:**
```go
func UpdateChunk(handle ChunkHandle, version ChunkVersion) error {
    // Caller MUST provide correct types
    // UpdateChunk(version, handle) is a compile error
}
```

### 2. Sentinel Values

**Pattern:** Use zero/invalid values for special cases

**Examples:**
```go
ChunkHandle(0)   // Invalid handle
ChunkVersion(0)  // Uninitialized chunk
Offset(-1)       // For MutationAppend (offset determined by server)
```

### 3. Bit Flag Mutation Types

**Pattern:**
```go
const (
    MutationAppend = (iota + 1) << 1  // 2 (binary: 10)
    MutationWrite                      // 4 (binary: 100)
    MutationPad                        // 8 (binary: 1000)
)
```

**Benefits:**
- Can combine flags: `MutationWrite | MutationPad`
- Check flags: `if mutationType & MutationWrite != 0`
- Extensible (add new flags without breaking existing code)

### 4. Time-Based Coordination

**Pattern:** Align intervals for predictable behavior

**Example:**
```go
HeartBeatInterval:         5s
ServerHealthCheckInterval: 10s = 2 * HeartBeatInterval
ServerHealthCheckTimeout:  60s = 12 * HeartBeatInterval
```

**Benefits:**
- Predictable failure detection times
- Easy to reason about system behavior
- Coordinated tuning (change one, adjust others proportionally)

### 5. Error Code Hierarchy

**Pattern:** Classify errors by severity and retry-ability

**Example:**
```go
Success:                  No error (0)
Timeout:                  Transient (retry)
AppendExceedChunkSize:    Limit (don't retry, create new chunk)
UnknownError:             System (log and escalate)
```

## Evolution and Compatibility

### Adding New Fields

**Strategy:** Append-only for backward compatibility

**Example:**
```go
// Version 1
type PersistedChunkInfo struct {
    Handle  ChunkHandle
    Version ChunkVersion
}

// Version 2 (add fields, don't remove)
type PersistedChunkInfo struct {
    Handle          ChunkHandle
    Version         ChunkVersion
    MetadataVersion int  // New field
    StatusFlags     []string  // New field
}
```

**Deserialization:**
```go
// Old data missing new fields → Use zero values
// New data with extra fields → Forward compatible
```

### Changing Constants

**Risk:** Existing data may depend on old values

**Migration Strategy:**

1. **Chunk Size Change:**
```go
// OLD: ChunkMaxSizeInByte = 64 << 20
// NEW: ChunkMaxSizeInByte = 128 << 20

// Migration:
// - Keep old chunks at 64MB
// - New chunks use 128MB
// - Add ChunkSize field to PersistedChunkInfo
```

2. **Timeout Change:**
```go
// OLD: LeaseTimeout = 60s
// NEW: LeaseTimeout = 120s

// Migration:
// - Deploy new Master with 120s timeout
// - Existing leases expire naturally
// - New leases granted with 120s duration
```

## Performance Implications

### Type Alias Overhead

**Cost:** Zero runtime overhead (compile-time only)

**Proof:**
```go
type ChunkHandle int64

var h ChunkHandle = 123
var i int64 = 123

// Both compile to identical machine code
// Type safety is free!
```

### Map Overhead in PersistedChunkInfo

```go
Mutations map[ChunkVersion]Mutation
```

**Cost:** ~48 bytes overhead per map + ~32 bytes per entry

**Mitigation:**
- Clear map after mutations are committed
- Most chunks have 0-1 pending mutations
- Memory cost: ~100 bytes per chunk (negligible)

### Time-Based Constant Tradeoffs

**Heartbeat Frequency:**
```
1-second heartbeats:
    Pro: Faster failure detection (~5s)
    Con: 5x network traffic, 5x CPU

10-second heartbeats:
    Pro: Lower overhead
    Con: Slower detection (~60s)
```

**Recommendation:** Default values (5s heartbeat) work well for most deployments

## Testing Considerations

### Type Safety Tests

```go
func TestTypeConfusion(t *testing.T) {
    var handle ChunkHandle = 123
    var version ChunkVersion = 456
    
    // This should not compile:
    // UpdateChunk(version, handle)  // Compile error ✓
    
    UpdateChunk(handle, version)  // Correct ✓
}
```

### Constant Validation

```go
func TestConstantRelationships(t *testing.T) {
    // Verify time-based coordination
    assert.Equal(t, HeartBeatInterval*2, ServerHealthCheckInterval)
    
    // Verify size relationships
    assert.Equal(t, ChunkMaxSizeInByte/4, AppendMaxSizeInByte)
    
    // Verify replication minimum
    assert.GreaterOrEqual(t, MinimumReplicationFactor, 3)
}
```

### Error Code Coverage

```go
func TestErrorCodes(t *testing.T) {
    // Ensure all error codes handled
    for code := Success; code <= DownloadBufferMiss; code++ {
        switch code {
        case Success, UnknownError, Timeout, /* ... */:
            // All codes covered ✓
        default:
            t.Errorf("Unhandled error code: %d", code)
        }
    }
}
```

## Future Enhancements

### 1. Error Context Enhancement

Add stack trace and structured context:

```go
type Error struct {
    Code       ErrorCode
    Err        string
    StackTrace []string
    Context    map[string]interface{}
}
```

### 2. Configuration via Environment

Support runtime configuration:

```go
var (
    ChunkMaxSizeInByte = getEnvInt("HERC_CHUNK_SIZE", 64<<20)
    HeartBeatInterval  = getEnvDuration("HERC_HEARTBEAT", 5*time.Second)
)
```

### 3. Chunk Size Tiers

Support multiple chunk sizes:

```go
const (
    SmallChunkSize  = 16 << 20  // 16MB for small files
    MediumChunkSize = 64 << 20  // 64MB default
    LargeChunkSize  = 256 << 20 // 256MB for huge files
)
```

### 4. Metrics and Instrumentation

Add Prometheus-style metrics:

```go
type ChunkMetrics struct {
    TotalWrites       prometheus.Counter
    WriteLatency      prometheus.Histogram
    ReplicationLag    prometheus.Gauge
}
```

## References

- **Google File System (GFS) Paper:** Original design inspiration for chunk size, replication, and leases
- **Go Type System:** Strong typing via type aliases
- **Protocol Buffers:** Alternative serialization for PersistedChunkInfo
- **CAP Theorem:** Consistency vs Availability tradeoffs in distributed systems
- **Failure Detection:** Heartbeat-based health monitoring patterns
