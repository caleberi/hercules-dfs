# ChunkServer Design Documentation

## Overview

The ChunkServer is a core component of the Hercules distributed file system, responsible for storing and managing data chunks. It implements the Google File System (GFS) architecture pattern, handling chunk operations, lease management, replication, failure detection, and data archiving.

## Architecture

### Design Patterns

#### 1. Master-Slave Architecture
The ChunkServer operates as a slave server in a master-slave architecture:

```
┌─────────────┐
│   Master    │
│   Server    │
└──────┬──────┘
       │
       │ Heartbeat, Metadata, Leases
       │
┌──────▼──────────────────────────┐
│      ChunkServer               │
├─────────────────────────────────┤
│ • Chunk Storage                │
│ • Lease Management             │
│ • Failure Detection            │
│ • Download Buffer              │
│ • Archive Manager              │
│ • Garbage Collection           │
└─────────────────────────────────┘
```

**Benefits:**
- Clear separation of metadata and data management
- Scalable horizontal architecture
- Simplified coordination through master

#### 2. RPC-Based Communication
All inter-server communication uses Go's net/rpc package:

```
Client → Master → ChunkServer (Primary)
                      │
                      ├─→ ChunkServer (Secondary 1)
                      ├─→ ChunkServer (Secondary 2)
                      └─→ ChunkServer (Secondary N)
```

**Benefits:**
- Simple remote procedure call interface
- Type-safe communication
- Built-in serialization

#### 3. Periodic Task Execution
Background tasks run on fixed intervals for system maintenance:

```
HeartBeat (every 100ms)
    ↓
PersistMetadata (every 30s)
    ↓
GarbageCollection (every 60s)
    ↓
ArchiveChunks (every 5m)
```

**Benefits:**
- Predictable system behavior
- Resource management
- Data integrity maintenance

## Component Design

### Core Components

#### ChunkServer
**Responsibilities:**
- Store and manage data chunks
- Handle RPC requests from master and clients
- Maintain chunk metadata and versioning
- Coordinate with replicas
- Perform background maintenance tasks

**Key Fields:**
```go
type ChunkServer struct {
    mu              sync.RWMutex              // Protects server state
    listener        net.Listener              // Network listener
    rootDir         *filesystem.FileSystem    // Chunk storage
    leases          utils.Deque[*common.Lease] // Active leases
    chunks          map[common.ChunkHandle]*chunkInfo // Chunk metadata
    garbage         utils.Deque[common.ChunkHandle]   // Chunks to delete
    archiver        *archivemanager.ArchiverManager   // Compression manager
    downloadBuffer  *downloadbuffer.DownloadBuffer    // Temporary data buffer
    failureDetector *failuredetector.FailureDetector  // Node health monitor
    ServerAddr      common.ServerAddr         // This server's address
    MasterAddr      common.ServerAddr         // Master server address
}
```

#### chunkInfo
**Responsibilities:**
- Track chunk metadata and state
- Manage mutations and versioning
- Monitor access patterns for archival

**Key Fields:**
```go
type chunkInfo struct {
    sync.RWMutex
    length       common.Offset              // Last known offset
    checksum     common.Checksum            // Data integrity check
    version      common.ChunkVersion        // Current version
    completed    bool                       // Mutation status
    abandoned    bool                       // Abandonment flag
    isCompressed bool                       // Compression state
    replication  int                        // Replica count
    mutations    map[common.ChunkVersion]common.Mutation // Pending mutations
    creationTime time.Time                  // Creation timestamp
    lastModified time.Time                  // Last modification
    accessTime   time.Time                  // Last access for archival
}
```

### Subsystems

#### 1. Lease Management
Controls write access to chunks through time-limited leases.

**Flow:**
```
Master grants lease → Primary holds lease → Coordinates writes → Lease expires
```

**Key Operations:**
- `RPCGrantLeaseHandler`: Accept lease from master
- Lease expiration tracking
- Automatic lease renewal

**Benefits:**
- Prevents conflicting writes
- Consistent ordering of mutations
- Automatic cleanup on failure

#### 2. Mutation System
Handles write operations with versioning and replication.

**Write Path:**
```
1. Client sends data to all replicas (ForwardData)
2. Client requests write to primary
3. Primary assigns version number
4. Primary writes locally
5. Primary forwards mutations to secondaries
6. Secondaries apply mutations
7. Secondaries acknowledge
8. Primary acknowledges to client
```

**Mutation Types:**
- `Write`: Write data at specific offset
- `Append`: Atomic record append
- `Pad`: Padding for alignment

**Key Features:**
- Version-based consistency
- Atomic operations
- Crash recovery through mutation log

#### 3. Download Buffer
Temporary storage for data before writes are committed.

**Purpose:**
- Decouple data transfer from write operations
- Support pipeline parallelism
- Enable efficient replication

**Lifecycle:**
```
ForwardData → Buffer (TTL: 1min) → WriteChunk → Buffer Clear
```

#### 4. Archive System
Compresses rarely-accessed chunks to save space.

**Strategy:**
- Chunks not accessed for > N days are compressed
- Automatic decompression on read
- Gzip compression

**Flow:**
```
Access Time Check → Compress Eligible Chunks → Update Metadata
                           ↓
                    Read Request → Decompress → Serve Data
```

#### 5. Failure Detection
Monitors master server health and handles failures.

**Mechanism:**
- Redis-based distributed heartbeat
- Suspicion level tracking
- Accrument threshold for failure detection

**Parameters:**
```go
SuspicionLevel{
    AccruementThreshold: 7,  // Failures before suspicion
    UpperBoundThreshold: 3,  // Suspicion before failure
}
```

#### 6. Garbage Collection
Removes orphaned and deleted chunks.

**Process:**
1. Master marks chunks for deletion
2. Chunks added to garbage queue
3. Periodic cleanup removes files
4. Metadata persisted

**Interval:** Every 60 seconds

### RPC Interface

#### Client-Facing Operations

##### RPCReadChunkHandler
**Purpose:** Read data from a chunk

**Flow:**
```
1. Validate chunk version
2. Check if compressed → decompress if needed
3. Read from file system
4. Calculate checksum
5. Return data
```

**Error Handling:**
- Version mismatch
- Chunk not found
- Corruption detected

##### RPCWriteChunkHandler
**Purpose:** Write data to chunk (primary only)

**Flow:**
```
1. Verify lease
2. Retrieve data from download buffer
3. Assign version number
4. Write locally
5. Forward mutations to secondaries
6. Wait for acknowledgments
7. Reply to client
```

**Consistency:**
- Serial execution per chunk
- Version-based ordering
- Majority acknowledgment required

##### RPCAppendChunkHandler
**Purpose:** Atomic record append

**Flow:**
```
1. Verify lease
2. Check if append fits in chunk
3. Pad if necessary
4. Assign version
5. Apply locally and to secondaries
6. Return offset
```

**Special Cases:**
- Chunk full → Return error, client retries next chunk
- Padding for alignment
- Atomic failure handling

##### RPCForwardDataHandler
**Purpose:** Receive data for later write

**Flow:**
```
1. Generate download buffer ID
2. Store in temporary buffer
3. Forward to next replica in chain
4. Set TTL (1 minute)
```

**Chain Replication:**
```
Primary → Secondary1 → Secondary2 → Secondary3
```

#### Master-Facing Operations

##### RPCGrantLeaseHandler
**Purpose:** Accept lease from master

**Details:**
- Stores lease with expiration
- Primary coordinates writes during lease
- Automatic expiration handling

##### RPCCreateChunkHandler
**Purpose:** Create new chunk file

**Flow:**
```
1. Create chunk file
2. Initialize metadata
3. Set version to 0
4. Reply with success
```

##### RPCCheckChunkVersionHandler
**Purpose:** Verify chunk version matches master

**Actions:**
- Return current version
- Mark stale chunks for garbage collection
- Enable version reconciliation

##### RPCGetSnapshotHandler
**Purpose:** Provide chunk copy for replication

**Flow:**
```
1. Read entire chunk
2. Return data + version + checksum
3. Used by master for re-replication
```

##### RPCApplyCopyHandler
**Purpose:** Accept chunk copy from another server

**Use Cases:**
- Re-replication after failure
- Load balancing
- New replica creation

#### Utility Operations

##### RPCSysReportHandler
**Purpose:** Report system status to master

**Includes:**
- Disk usage statistics
- Memory statistics
- CPU information
- Number of chunks
- Server health

## Data Flow

### Write Operation (Complete Flow)

```
┌──────┐                ┌────────┐              ┌─────────┐
│Client│                │ Master │              │ Primary │
└──┬───┘                └───┬────┘              └────┬────┘
   │                        │                        │
   │ GetPrimaryAndSecondaries                       │
   ├───────────────────────►│                        │
   │                        │                        │
   │      Primary + Secondaries                     │
   │◄───────────────────────┤                        │
   │                        │                        │
   │         ForwardData(data, secondaries)         │
   ├────────────────────────────────────────────────►│
   │                        │                        │
   │                        │           ForwardData │
   │                        │  ┌────────────────────►│ Secondary1
   │                        │  │                     │
   │                        │  │        ForwardData │
   │                        │  │  ┌─────────────────►│ Secondary2
   │                        │  │  │                  │
   │                        │  │  │         ACK      │
   │                        │  │  │◄─────────────────┤
   │                        │  │  │                  │
   │                        │  │         ACK         │
   │                        │  │◄────────────────────┤
   │                        │                        │
   │              ACK       │                        │
   │◄────────────────────────────────────────────────┤
   │                        │                        │
   │   WriteChunk(offset, bufferId)                 │
   ├────────────────────────────────────────────────►│
   │                        │                        │
   │                        │    ApplyMutation       │
   │                        │  ┌────────────────────►│ Secondary1
   │                        │  │                     │
   │                        │  │    ApplyMutation    │
   │                        │  │  ┌─────────────────►│ Secondary2
   │                        │  │  │                  │
   │                        │  │  │      ACK         │
   │                        │  │  │◄─────────────────┤
   │                        │  │  │                  │
   │                        │  │        ACK          │
   │                        │  │◄────────────────────┤
   │                        │                        │
   │            Success     │                        │
   │◄────────────────────────────────────────────────┤
   │                        │                        │
```

### Read Operation (Complete Flow)

```
┌──────┐                ┌────────┐              ┌──────────┐
│Client│                │ Master │              │ChunkServer│
└──┬───┘                └───┬────┘              └────┬─────┘
   │                        │                        │
   │ GetChunkHandle(path, index)                    │
   ├───────────────────────►│                        │
   │                        │                        │
   │  Handle + Locations    │                        │
   │◄───────────────────────┤                        │
   │                        │                        │
   │      ReadChunk(handle, version, offset, length)│
   ├────────────────────────────────────────────────►│
   │                        │                        │
   │                        │            [Compressed?]
   │                        │           Decompress   │
   │                        │                        │
   │                        │            Read File   │
   │                        │                        │
   │           Data + Checksum                       │
   │◄────────────────────────────────────────────────┤
   │                        │                        │
```

## Background Tasks

### 1. Heartbeat (100ms interval)

**Purpose:** Notify master of liveness and report status

**Data Sent:**
- Server address
- Lease information
- Chunk handles and versions
- Available disk space
- Memory usage
- CPU count

**Master Actions:**
- Update server health status
- Detect version mismatches
- Balance load
- Schedule re-replication

### 2. Persist Metadata (30s interval)

**Purpose:** Save chunk metadata to disk for crash recovery

**Data Saved:**
```go
PersistedMetaData {
    Handle, Version, Length
    ChunkSize, Mutations
    Completed, Abandoned
    Checksum, Replication
    Timestamps
}
```

**File Format:** GOB encoding
**Location:** `<rootDir>/.meta/<handle>.meta`

### 3. Garbage Collection (60s interval)

**Purpose:** Remove deleted chunks

**Process:**
1. Drain garbage queue
2. Delete chunk files
3. Remove metadata
4. Free memory structures

**Safety:** Only removes explicitly marked chunks

### 4. Archive Chunks (5min interval)

**Purpose:** Compress inactive chunks to save space

**Criteria:**
- Last access > N days (configurable)
- Not currently leased
- Not marked for deletion

**Process:**
1. Identify eligible chunks
2. Submit to archiver (worker pool)
3. Compress with gzip
4. Update metadata
5. Delete original file

**Decompression:** Automatic on next read

## Metadata Persistence

### Storage Format

**Directory Structure:**
```
<rootDir>/
├── chunk_<handle>              # Actual chunk data
├── chunk_<handle>.gz           # Compressed chunks
└── .meta/
    └── <handle>.meta           # Metadata files
```

### Metadata Contents

```go
type PersistedMetaData struct {
    Handle          common.ChunkHandle
    Version         common.ChunkVersion
    Length          common.Offset
    ChunkSize       int64
    Mutations       map[common.ChunkVersion]common.Mutation
    Completed       bool
    Abandoned       bool
    Checksum        common.Checksum
    Replication     int
    ServerStatus    int
    MetadataVersion int
    ServerIP        string
    StatusFlags     []string
    CreationTime    time.Time
    LastModified    time.Time
    AccessTime      time.Time
}
```

### Recovery Process

On startup, the ChunkServer:
1. Scans `.meta` directory
2. Loads all metadata files
3. Reconstructs in-memory state
4. Reports to master via heartbeat
5. Master reconciles versions

## Consistency Guarantees

### Write Consistency

**Model:** Relaxed consistency with defined semantics

**Guarantees:**
1. **Atomic Record Append:** All or nothing, no partial records
2. **Serial Write Ordering:** Primary orders all mutations
3. **Version Consistency:** All replicas have same version after write
4. **Lease-Based Coordination:** Only one primary per chunk at a time

**Potential Inconsistencies:**
- Replica may be slightly stale during mutation
- Failed writes may leave some replicas inconsistent (resolved by version check)

### Read Consistency

**Guarantees:**
1. Read sees data from specific version
2. Checksum verification detects corruption
3. Stale replicas detected and excluded

**Version Checking:**
- Client provides expected version
- ChunkServer validates before read
- Stale read rejected

## Failure Handling

### ChunkServer Failure

**Detection:**
- Master detects via missing heartbeats
- Failure detector tracks suspicion levels

**Recovery:**
1. Master marks server as down
2. Master schedules re-replication for under-replicated chunks
3. Other ChunkServers create new replicas
4. Version numbers ensure consistency

### Network Partition

**Lease Timeout:**
- Lease expires after fixed duration
- Master won't grant new lease until old expires
- Prevents split-brain

**Version Checking:**
- Stale servers detected via version mismatch
- Garbage collected on reconciliation

### Data Corruption

**Detection:**
- Checksum verification on read
- Regular integrity checks

**Recovery:**
1. Report corruption to master
2. Master marks replica as bad
3. Master schedules re-replication from good replica
4. Corrupted replica garbage collected

## Performance Optimizations

### 1. Pipeline Parallelism

**Data Transfer:**
- Forward data in chain while receiving
- Overlaps network delays
- Reduces latency

### 2. Download Buffer

**Benefits:**
- Decouple data push from write operation
- Client doesn't wait for all replicas
- TTL-based automatic cleanup

### 3. Batched Metadata Persistence

**Strategy:**
- Persist on fixed interval (30s)
- Amortize I/O cost
- Trade-off: some mutations may be lost on crash

### 4. Worker Pool for Archival

**Configuration:**
- 2 workers for compression
- 2 workers for decompression
- Parallel processing of multiple chunks

### 5. Lock Granularity

**Strategy:**
- Per-chunk locks for mutations
- Read lock for concurrent reads
- Server-level lock only for metadata operations

## Configuration Parameters

```go
// Intervals
HeartBeatInterval           = 100 * time.Millisecond
GarbageCollectionInterval   = 60 * time.Second
PersistMetaDataInterval     = 30 * time.Second
ArchiveChunkInterval        = 5 * time.Minute

// Timeouts
DownloadBufferTick          = 1 * time.Second
DownloadBufferItemExpire    = 1 * time.Minute
FailureDetectorKeyExipiryTime = 5 * time.Second

// Archival
ArchivalDaySpan             = 30 // days of inactivity

// Failure Detection
AccruementThreshold         = 7  // failures before suspicion
UpperBoundThreshold         = 3  // suspicions before failure
```

## Testing Strategy

### Unit Tests

**Coverage:**
- Chunk creation and deletion
- Read/write operations
- Version checking
- Lease management
- Metadata persistence

### Integration Tests

**Scenarios:**
- Multi-server coordination
- Primary-secondary replication
- Failure detection and recovery
- Archive/unarchive cycles

### Benchmark Tests

**Metrics:**
- Write throughput
- Read latency
- Concurrent operation handling
- Memory usage under load

## Error Handling

### Error Types

```go
// Chunk Errors
ChunkNotFound
ChunkVersionMismatch
ChunkCorrupted
ChunkAlreadyExists

// Lease Errors
LeaseExpired
LeaseNotHeld
LeaseRejected

// Replication Errors
ReplicaNotAvailable
ReplicationFailed
InsufficientReplicas

// System Errors
DiskFull
ServerShuttingDown
NetworkTimeout
```

### Recovery Strategies

1. **Transient Errors:** Retry with exponential backoff
2. **Version Conflicts:** Defer to master for resolution
3. **Disk Full:** Report to master, stop accepting writes
4. **Replica Failure:** Continue if majority available

## Future Enhancements

### 1. Erasure Coding
Replace replication with erasure codes for space efficiency

### 2. Tiered Storage
Move cold data to cheaper storage (S3, glacier)

### 3. Compression Algorithms
Support multiple algorithms (LZ4, Zstd, Brotli)

### 4. Smart Replica Placement
Consider network topology and rack awareness

### 5. Read Caching
Cache frequently accessed chunks in memory

### 6. Batch Operations
Support batch reads/writes for efficiency

## References

- [Google File System Paper](https://static.googleusercontent.com/media/research.google.com/en//archive/gfs-sosp2003.pdf)
- Distributed Systems: Principles and Paradigms (Tanenbaum & Van Steen)
- Go RPC Documentation
- GFS Design Patterns and Best Practices

## Appendix

### A. File Naming Convention

```
Chunk File:      chunk_<handle>
Compressed:      chunk_<handle>.gz
Metadata:        .meta/<handle>.meta
```

### B. RPC Handler Summary

| Handler | Purpose | Primary Only |
|---------|---------|--------------|
| RPCReadChunkHandler | Read data | No |
| RPCWriteChunkHandler | Write data | Yes |
| RPCAppendChunkHandler | Atomic append | Yes |
| RPCForwardDataHandler | Receive data | No |
| RPCCreateChunkHandler | Create chunk | No |
| RPCGrantLeaseHandler | Accept lease | Yes |
| RPCApplyMutationHandler | Apply write | No (secondary) |
| RPCGetSnapshotHandler | Copy chunk | No |
| RPCApplyCopyHandler | Receive copy | No |
| RPCCheckChunkVersionHandler | Version check | No |
| RPCSysReportHandler | System info | No |

### C. State Transitions

```
Chunk Lifecycle:
Created → Active → [Compressed] → Garbage → Deleted
           ↓
        Modified
           ↓
        Version++

Lease Lifecycle:
Granted → Active → [Renewed] → Expired
```
