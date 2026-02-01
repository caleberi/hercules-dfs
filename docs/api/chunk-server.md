# Chunk Server API Reference

Chunkservers store the actual file data as chunks. They expose an RPC interface for clients and other chunkservers to read, write, and manage chunk data.

## RPC Methods

### Chunk Creation

#### `CreateChunk`
Create a new chunk on this chunkserver.

**Arguments**: `CreateChunkArgs`
```go
type CreateChunkArgs struct {
    Handle common.ChunkHandle  // Unique chunk identifier
}
```

**Reply**: `CreateChunkReply`
```go
type CreateChunkReply struct {
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Creates new chunk file on disk
- Initializes chunk metadata
- Returns error if chunk already exists

---

### Read Operations

#### `ReadChunk`
Read data from a chunk.

**Arguments**: `ReadChunkArgs`
```go
type ReadChunkArgs struct {
    Handle common.ChunkHandle  // Chunk to read from
    Offset common.Offset       // Byte offset in chunk
    Length int64               // Number of bytes to read
}
```

**Reply**: `ReadChunkReply`
```go
type ReadChunkReply struct {
    Data      []byte            // Actual data read
    Length    int64             // Number of bytes read
    ErrorCode common.ErrorCode  // Success or error
}
```

**Behavior**:
- Reads from local chunk file
- Verifies checksum for integrity
- Returns `ReadEOF` if reading past end
- Returns actual data read (may be less than requested)

---

### Write Operations

#### `ForwardData`
Push data to this chunkserver (and forward to replicas).

**Arguments**: `ForwardDataArgs`
```go
type ForwardDataArgs struct {
    DownloadBufferId common.BufferId    // Unique ID for this data
    Data             []byte             // Data to store
    Replicas         []common.ServerAddr // Chunkservers to forward to
}
```

**Reply**: `ForwardDataReply`
```go
type ForwardDataReply struct {
    ErrorCode common.ErrorCode
}
```

**BufferId Structure**:
```go
type BufferId struct {
    Handle    ChunkHandle  // Chunk this data is for
    Timestamp int64        // Unique timestamp
}
```

**Behavior**:
- Stores data in temporary download buffer
- Forwards data to next replica in chain (pipelined)
- Data expires after 10 seconds if not used
- Does NOT write to chunk file yet

---

#### `WriteChunk`
Write data from download buffer to chunk at specific offset.

**Arguments**: `WriteChunkArgs`
```go
type WriteChunkArgs struct {
    DownloadBufferId common.BufferId     // Buffer containing data
    Offset           common.Offset       // Where to write in chunk
    Replicas         []common.ServerAddr // Replicas to forward to
}
```

**Reply**: `WriteChunkReply`
```go
type WriteChunkReply struct {
    Length    int             // Bytes written
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Retrieves data from download buffer
- Writes to chunk at specified offset
- Forwards write request to replicas
- Updates chunk version
- Calculates and stores checksum

---

#### `AppendChunk`
Atomically append data to end of chunk.

**Arguments**: `AppendChunkArgs`
```go
type AppendChunkArgs struct {
    DownloadBufferId common.BufferId     // Buffer containing data
    Replicas         []common.ServerAddr // Replicas to append to
}
```

**Reply**: `AppendChunkReply`
```go
type AppendChunkReply struct {
    Offset    common.Offset    // Offset where data was appended
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Primary chunkserver chooses append offset
- Appends at current end-of-chunk
- If data doesn't fit, pad to chunk boundary and fail (client retries on next chunk)
- All replicas append at same offset
- Atomically updates all replicas
- Returns actual offset used

**Max Append Size**: 16 MB (ChunkMaxSizeInByte / 4)

---

### Mutation Operations

#### `ApplyMutation`
Apply a mutation (write/append) operation.

**Arguments**: `ApplyMutationArgs`
```go
type ApplyMutationArgs struct {
    MutationType     common.MutationType  // Write, Append, or Pad
    DownloadBufferId common.BufferId      // Data buffer
    Offset           common.Offset        // For writes
}
```

**Reply**: `ApplyMutationReply`
```go
type ApplyMutationReply struct {
    Length    int
    ErrorCode common.ErrorCode
}
```

**Mutation Types**:
```go
const (
    MutationAppend = (iota + 1) << 1  // Append operation
    MutationWrite                      // Write operation
    MutationPad                        // Padding operation
)
```

---

### Replication Operations

#### `SendCopy`
Request this chunkserver to copy a chunk from another chunkserver.

**Arguments**: `SendCopyArg`
```go
type SendCopyArg struct {
    Handle  common.ChunkHandle  // Chunk to copy
    Address common.ServerAddr   // Source chunkserver
}
```

**Reply**: `SendCopyReply`
```go
type SendCopyReply struct {
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Connects to source chunkserver
- Downloads chunk data
- Creates local copy
- Used for re-replication

---

### Metadata Operations

#### `CheckChunkVersion`
Check if a chunk version is stale.

**Arguments**: `CheckChunkVersionArg`
```go
type CheckChunkVersionArg struct {
    Handle  common.ChunkHandle
    Version common.ChunkVersion
}
```

**Reply**: `CheckChunkVersionReply`
```go
type CheckChunkVersionReply struct {
    Stale bool  // true if local version is older
}
```

---

#### `SysReportInfo`
Get system information and chunk list from chunkserver.

**Arguments**: `SysReportInfoArg` (empty)

**Reply**: `SysReportInfoReply`
```go
type SysReportInfoReply struct {
    SysMem common.Memory                 // Memory statistics
    Chunks []common.PersistedChunkInfo   // All chunks on this server
}
```

**Memory Structure**:
```go
type Memory struct {
    Alloc      float64  // Allocated memory
    TotalAlloc float64  // Total allocated
    Sys        float64  // System memory
    NumGC      float64  // GC count
}
```

---

## Internal Mechanisms

### Download Buffer
- Temporary storage for data before writing to chunks
- Keyed by `BufferId` (handle + timestamp)
- Expires after 10 seconds
- Allows separation of data transfer from control flow

### Chunk Storage
- Chunks stored as files: `chunk-{handle}.chk`
- Metadata stored in: `chunk.server.meta`
- Chunks are 64MB max
- Each chunk has version number and checksum

### Checksumming
- Chunks divided into 64KB blocks
- Each block has 32-bit checksum
- Checksums verified on every read
- Checksums updated on every write

### Garbage Collection
- Runs every 5 minutes
- Deletes chunks marked by master in heartbeat
- Removes expired download buffer entries
- Removes abandoned chunks

### Heartbeat
- Sent to master every 5 seconds
- Reports server status
- Receives garbage collection list
- Extends leases

### Failure Detection
- Uses φ Accrual algorithm
- Tracks network latency via Redis
- Calculates failure probability
- Reported to master

## Data Flow Examples

### Write Flow (Client Perspective)

```go
// 1. Get lease from master
replicasReply := getMasterReplicas(handle)
primary := replicasReply.Lease.Primary
secondaries := replicasReply.Lease.Secondaries

// 2. Push data to all replicas (start with primary)
bufferId := BufferId{Handle: handle, Timestamp: time.Now().Unix()}
forwardData(primary, bufferId, data, secondaries)

// 3. Send write command to primary
writeChunk(primary, bufferId, offset, secondaries)

// Primary forwards to secondaries
// All replicas reply
// Primary replies to client
```

### Append Flow

```go
// 1. Get lease (same as write)
replicasReply := getMasterReplicas(handle)
primary := replicasReply.Lease.Primary
secondaries := replicasReply.Lease.Secondaries

// 2. Push data to all replicas
bufferId := BufferId{Handle: handle, Timestamp: time.Now().Unix()}
forwardData(primary, bufferId, data, secondaries)

// 3. Send append command to primary
appendReply := appendChunk(primary, bufferId, secondaries)

// Primary chooses offset and appends
// Primary ensures all secondaries append at same offset
// Returns actual offset to client
```

### Read Flow

```go
// 1. Get chunk locations from master
locations := getMasterLocations(handle)

// 2. Read from any chunkserver (prefer closest)
readReply := readChunk(locations[0], offset, length)

// Data returned directly
```

## Error Handling

### Common Errors

- `AppendExceedChunkSize`: Append would exceed 64MB limit
- `WriteExceedChunkSize`: Write would exceed 64MB limit  
- `DownloadBufferMiss`: Data not found in buffer (expired or never pushed)
- `NotAvailableForCopy`: Chunk not available for replication
- `ReadEOF`: Attempt to read past end of chunk

### Retry Logic

Clients should retry on:
- `Timeout`: Network issue
- `AppendExceedChunkSize`: Retry on next chunk
- `DownloadBufferMiss`: Re-push data and retry

## Constants

```go
// Chunk Configuration
ChunkMaxSizeInByte    = 64 << 20    // 64 MB
AppendMaxSizeInByte   = 16 << 20    // 16 MB (max per append)

// Intervals
HeartBeatInterval         = 5 * time.Second
GarbageCollectionInterval = 5 * time.Minute
PersistMetaDataInterval   = 10 * time.Minute

// Download Buffer
DownloadBufferItemExpire = 10 * time.Second
DownloadBufferTick       = 10 * time.Second

// Archive
ArchivalDaySpan          = 5
ArchiveChunkInterval     = 5 * 24 * time.Hour

// File Names
ChunkFileNameFormat   = "chunk-%v.chk"
ChunkMetaDataFileName = "chunk.server.meta"
```

## Performance Considerations

1. **Pipelined Data Transfer**: Data flows through replica chain, not star topology
2. **Read Optimization**: Clients can read from any replica (choose closest)
3. **Checksum Verification**: Only on reads, not writes (reduces write latency)
4. **Download Buffer**: Decouples data push from control flow
5. **Batch Garbage Collection**: Periodic rather than immediate

## Notes

- Chunkservers are stateless except for stored chunks
- Can restart and re-report chunks to master
- Master is source of truth for all metadata
- Chunks are immutable once completed (only appends allowed)
- Version numbers prevent stale data reads
