# Component Details

This document provides in-depth details about each component in the Hercules distributed file system.

## Master Server

### Responsibilities

The master server is the central coordinator that maintains all metadata about the file system.

#### 1. Namespace Management
- Maintains directory hierarchy as a tree structure
- Handles file/directory creation, deletion, and listing
- Manages path resolution and validation
- Supports soft deletion (files renamed with `___deleted__` prefix)

#### 2. Chunk Management
- Assigns unique chunk handles (incrementing integers)
- Tracks which files contain which chunks
- Maintains chunk-to-chunkserver mapping
- Manages chunk versions for consistency

#### 3. Lease Management
- Grants 60-second leases for mutations
- Designates primary replica (lease holder)
- Identifies secondary replicas
- Extends leases on request
- Revokes leases on timeout

#### 4. Replication Management
- Monitors chunk replica count (minimum 3)
- Triggers re-replication when count drops
- Balances chunk distribution across chunkservers
- Handles chunkserver failures

#### 5. Health Monitoring
- Receives heartbeats from chunkservers (every 5 seconds)
- Marks chunkservers dead after 60 seconds without heartbeat
- Tracks chunkserver load and capacity
- Provides garbage collection directives

### Data Structures

#### Namespace Tree
```go
type TreeNode struct {
    IsDir    bool
    Children map[string]*TreeNode
    Handles  []ChunkHandle  // For files
}
```

#### Chunk Info
```go
type chunkInfo struct {
    locations []ServerAddr    // Where chunk is stored
    primary   ServerAddr      // Current lease holder
    expire    time.Time       // Lease expiration
    version   ChunkVersion    // Current version
    checksum  Checksum        // For verification
    path      Path            // Owning file
}
```

#### Chunkserver Info
```go
type chunkServerInfo struct {
    lastHeartBeat time.Time
    chunks        map[ChunkHandle]bool  // Chunks on this server
    garbages      []ChunkHandle         // To be deleted
    serverInfo    MachineInfo           // Machine details
}
```

### Persistence

Master metadata is persisted to disk:
- **File**: `master.server.meta`
- **Format**: GOB encoding
- **Frequency**: Every 15 hours + on shutdown
- **Recovery**: Automatic on startup

### Scalability Considerations

- All metadata in memory for fast access
- Single-threaded metadata operations (simplified locking)
- Read-only replicas possible for increased read capacity
- Bottleneck at ~millions of files (memory constrained)

---

## Chunkserver

### Responsibilities

Chunkservers are storage nodes that hold the actual file data as fixed-size chunks.

#### 1. Chunk Storage
- Stores chunks as Linux files: `chunk-{handle}.chk`
- Maximum 64 MB per chunk
- Manages local filesystem hierarchy
- Handles disk I/O operations

#### 2. Data Serving
- Serves read requests directly to clients
- Processes write requests from lease holders
- Handles append operations atomically
- Manages data replication to other chunkservers

#### 3. Heartbeats
- Sends heartbeat to master every 5 seconds
- Reports current chunks and versions
- Requests lease extensions
- Receives garbage collection instructions

#### 4. Garbage Collection
- Runs every 5 minutes
- Deletes chunks marked by master
- Removes abandoned mutations
- Cleans up expired download buffer entries

#### 5. Checksumming
- Divides chunks into 64 KB blocks
- Maintains 32-bit checksum per block
- Verifies checksums on read
- Recalculates on write

#### 6. Re-replication
- Copies chunks from other chunkservers when instructed
- Serves as source for re-replication
- Balances load during copying

### Data Structures

#### Chunk Info
```go
type chunkInfo struct {
    length      Offset           // Current size
    checksum    Checksum         // Block checksums
    version     ChunkVersion     // Current version
    mutations   map[ChunkVersion]Mutation  // Pending mutations
    completed   bool             // Is chunk full
    abandoned   bool             // Should be deleted
    replication int              // Replica count
    creationTime time.Time
    lastModified time.Time
    accessTime   time.Time
}
```

#### Download Buffer
Temporary storage for data before writing to chunks:
```go
type BufferId struct {
    Handle    ChunkHandle
    Timestamp int64
}

// Maps BufferId to actual data
buffer map[BufferId][]byte
```

Expires after 10 seconds.

### Mutation Protocol

1. **Client pushes data** to all replicas (pipelined)
2. **Data stored in download buffer** (not yet written)
3. **Client sends mutation command** to primary
4. **Primary assigns serial order** and applies mutation
5. **Primary forwards** to secondaries
6. **Secondaries apply** in same order
7. **All reply** success/failure
8. **Primary replies** to client

### Failure Handling

- **Mutation failure**: Client retries with new lease
- **Checksum mismatch**: Report to master, trigger re-replication
- **Disk failure**: Chunkserver marked dead, chunks re-replicated
- **Network partition**: Lease timeout ensures safety

---

## Gateway Server

### Responsibilities

The gateway provides an HTTP/REST interface to the distributed file system.

#### 1. HTTP API
- Translates HTTP requests to RPC calls
- Manages HTTP sessions
- Handles multipart file uploads
- Supports file downloads with streaming

#### 2. Request Routing
- Routes to master for metadata operations
- Routes to chunkservers for data operations
- Caches chunk locations
- Load balances across replicas

#### 3. Error Handling
- Translates internal errors to HTTP status codes
- Provides JSON error responses
- Handles timeouts gracefully

### Architecture

```
HTTP Request
     ↓
  Gateway (Gin framework)
     ↓
  HerculesClient SDK
     ↓
  RPC calls → Master/Chunkservers
```

### Key Endpoints

- `POST /api/v1/files` - Create file
- `GET /api/v1/files` - Get file info
- `DELETE /api/v1/files` - Delete file
- `POST /api/v1/files/upload` - Upload file
- `GET /api/v1/files/download` - Download file
- `POST /api/v1/directories` - Create directory
- `GET /api/v1/directories` - List directory
- `GET /api/v1/system/status` - System status

---

## Failure Detector

### φ Accrual Algorithm

Uses the φ (phi) Accrual Failure Detection algorithm for probabilistic failure detection.

#### How It Works

1. **Collect Heartbeat Samples**
   - Track round-trip times for heartbeats
   - Store in sliding window (recent 1000 samples)
   - Persist to Redis for history

2. **Calculate Statistics**
   - Mean (μ) of inter-arrival times
   - Standard deviation (σ)
   - Assumes normal distribution

3. **Compute φ Value**
   ```
   φ(t) = -log₁₀(P(t))
   ```
   Where P(t) is probability that heartbeat arrives by time t

4. **Interpret φ**
   - φ < 1: System healthy
   - 1 ≤ φ < 3: Warning
   - φ ≥ 3: Likely failed (99.9% probability)

#### Advantages

- Adaptive to network conditions
- Probabilistic rather than binary
- Configurable suspicion levels
- Tolerates variable network latency

#### Redis Schema

```
Key: fd:{server_id}:history
Type: List
Value: [NetworkData entries...]
TTL: 5 minutes
```

### Network Data Collection

```go
type NetworkData struct {
    RoundTrip    time.Duration
    ForwardTrip  TripInfo
    BackwardTrip TripInfo
}

type TripInfo struct {
    SentAt     time.Time
    ReceivedAt time.Time
}
```

---

## Namespace Manager

### Responsibilities

Manages the hierarchical file and directory structure.

#### 1. Tree Operations
- Create/delete files and directories
- Rename operations
- Path resolution
- Tree traversal

#### 2. Locking
- Read/write locks per tree node
- Prevents concurrent modifications
- Supports concurrent reads

#### 3. Soft Deletion
- Renames deleted items with `___deleted__` prefix
- Actual deletion during garbage collection
- Allows undelete before GC

### Tree Structure

```
/ (root)
├── users/
│   ├── alice/
│   │   └── data.txt → [handle1, handle2]
│   └── bob/
│       └── logs.txt → [handle3]
└── tmp/
    └── temp.dat → [handle4]
```

Each file node stores array of chunk handles.

---

## Archive Manager

### Responsibilities

Manages snapshots and archival of the file system.

#### 1. Snapshots
- Create point-in-time snapshots
- Copy-on-write mechanism
- Minimal storage overhead

#### 2. Archival
- Archive old chunks (5+ days old)
- Compress archived data
- Store in separate archive storage

#### 3. Restoration
- Restore files from archives
- Rehydrate compressed data
- Rebuild chunk metadata

### Archive Frequency

- Triggered every 5 days
- Can be manually triggered
- Archives inactive chunks only

---

## Download Buffer

### Purpose

Temporary storage that decouples data transfer from control flow.

### How It Works

1. **Client pushes data** to all replicas
2. **Data stored** with unique BufferId
3. **Data expires** after 10 seconds
4. **Mutation command** references BufferId
5. **Data retrieved** and written to chunk

### Benefits

- Separates data flow from control flow
- Enables pipelined data transfer
- Reduces latency for mutations
- Simplifies error handling

---

## Client SDK (HerculesClient)

### Responsibilities

Provides programmatic interface to the file system.

### Key Methods

```go
// File operations
CreateFile(path string) error
DeleteFile(path string) error
List(path string) ([]PathInfo, error)
GetFileInfo(path string) (FileInfo, error)

// Read/Write
Read(path string, offset int64, length int64) ([]byte, error)
Write(path string, offset int64, data []byte) error
Append(path string, data []byte) (int64, error)

// Directory operations
MkDir(path string) error
```

### Smart Features

- **Caches chunk locations** to reduce master load
- **Retries on failure** with exponential backoff
- **Chooses nearest replica** for reads
- **Pipelines data transfer** for writes

---

## Summary

Each component is designed with specific responsibilities:

- **Master**: Metadata, coordination, namespace
- **Chunkserver**: Data storage, serving, replication
- **Gateway**: HTTP interface, API
- **Failure Detector**: Health monitoring
- **Namespace Manager**: File hierarchy
- **Archive Manager**: Snapshots, archival
- **Download Buffer**: Temporary data storage
- **Client SDK**: Programmatic access

Together, they form a complete, fault-tolerant distributed file system.
