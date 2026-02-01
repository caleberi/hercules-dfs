# Master Server API Reference

The Master Server is responsible for all metadata operations in the Hercules distributed file system. It exposes an RPC interface for both clients and chunkservers.

## RPC Methods

### Metadata Operations

#### `GetFileInfo`
Retrieve metadata information about a file or directory.

**Arguments**: `GetFileInfoArg`
```go
type GetFileInfoArg struct {
    Path string  // Path to file or directory
}
```

**Reply**: `GetFileInfoReply`
```go
type GetFileInfoReply struct {
    IsDir       bool              // true if path is a directory
    Length      int64             // Total file length in bytes
    Chunks      int64             // Number of chunks
    FileInfo    *common.FileInfo  // Detailed file information
    ErrorCode   common.ErrorCode  // Success or error code
}
```

**Usage**: Client calls this to get file metadata before reading/writing.

---

#### `CreateFile`
Create a new file in the namespace.

**Arguments**: `CreateFileArg`
```go
type CreateFileArg struct {
    Path string  // Full path for new file
}
```

**Reply**: `CreateFileReply`
```go
type CreateFileReply struct {
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Creates parent directories if they don't exist
- Returns error if file already exists
- File created with zero chunks initially

---

#### `DeleteFile`
Delete a file from the namespace (marks for garbage collection).

**Arguments**: `DeleteFileArg`
```go
type DeleteFileArg struct {
    Path string  // Path to file to delete
}
```

**Reply**: `DeleteFileReply`
```go
type DeleteFileReply struct {
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Renames file with `___deleted__` prefix
- Actual chunk deletion happens during GC
- Returns error if file doesn't exist or is a directory

---

#### `MkDir`
Create a directory.

**Arguments**: `MkDirArg`
```go
type MkDirArg struct {
    Path string  // Directory path to create
}
```

**Reply**: `MkDirReply`
```go
type MkDirReply struct {
    ErrorCode common.ErrorCode
}
```

---

#### `ListFiles`
List contents of a directory.

**Arguments**: `ListFilesArg`
```go
type ListFilesArg struct {
    Path string  // Directory path
}
```

**Reply**: `ListFilesReply`
```go
type ListFilesReply struct {
    Files     []common.PathInfo  // File/directory information
    ErrorCode common.ErrorCode
}
```

**PathInfo Structure**:
```go
type PathInfo struct {
    Path   string  // Full path
    Name   string  // File/directory name
    IsDir  bool    // Is directory
    Length int64   // Size in bytes
    Chunk  int64   // Number of chunks
}
```

---

### Chunk Operations

#### `GetChunkHandle`
Get or create a chunk handle for a specific file chunk.

**Arguments**: `GetChunkHandleArg`
```go
type GetChunkHandleArg struct {
    Path       string           // File path
    ChunkIndex common.ChunkIndex // Chunk index (0-based)
}
```

**Reply**: `GetChunkHandleReply`
```go
type GetChunkHandleReply struct {
    Handle    common.ChunkHandle  // Unique chunk identifier
    ErrorCode common.ErrorCode
}
```

**Behavior**:
- Creates new handle if chunk doesn't exist
- Returns existing handle if chunk exists
- Used by clients before read/write operations

---

#### `GetChunkLocation`
Get locations (chunkservers) where a chunk is stored.

**Arguments**: `GetChunkLocationArg`
```go
type GetChunkLocationArg struct {
    Handle common.ChunkHandle  // Chunk handle
}
```

**Reply**: `GetChunkLocationReply`
```go
type GetChunkLocationReply struct {
    Locations []common.ServerAddr  // Chunkserver addresses
    ErrorCode common.ErrorCode
}
```

**Usage**: Client uses this to find which chunkservers to contact for data.

---

#### `GetReplicas`
Get replica locations and lease information for mutations.

**Arguments**: `GetReplicasArg`
```go
type GetReplicasArg struct {
    Handle common.ChunkHandle
}
```

**Reply**: `GetReplicasReply`
```go
type GetReplicasReply struct {
    Lease     *common.Lease     // Lease with primary and secondaries
    ErrorCode common.ErrorCode
}
```

**Lease Structure**:
```go
type Lease struct {
    Handle      ChunkHandle      // Chunk this lease is for
    Expire      time.Time        // Lease expiration time
    InUse       bool             // Is lease currently in use
    Primary     ServerAddr       // Primary replica (lease holder)
    Secondaries []ServerAddr     // Secondary replicas
}
```

**Usage**: 
- Client must call this before write/append operations
- Returns primary (lease holder) and secondaries
- Lease valid for 60 seconds by default

---

### Chunkserver Management

#### `HeartBeat`
Chunkserver reports its status to master.

**Arguments**: `HeartBeatArg`
```go
type HeartBeatArg struct {
    Address       common.ServerAddr        // Chunkserver address
    PendingLeases []*common.Lease          // Leases to extend
    MachineInfo   common.MachineInfo       // Server machine info
    ExtendLease   bool                     // Request lease extension
}
```

**Reply**: `HeartBeatReply`
```go
type HeartBeatReply struct {
    LastHeartBeat   time.Time                      // Last heartbeat time
    LeaseExtensions []*common.Lease                // Extended leases
    Garbage         []common.ChunkHandle           // Chunks to delete
    NetworkData     failuredetector.NetworkData    // Network metrics
}
```

**Behavior**:
- Called every 5 seconds by each chunkserver
- Master tracks last heartbeat time
- Master returns chunks to garbage collect
- Supports lease extension requests
- Provides network timing data for failure detection

---

#### `ReportChunks`
Chunkserver reports what chunks it has.

**Arguments**: `ReportChunksArg`
```go
type ReportChunksArg struct {
    Address common.ServerAddr           // Chunkserver address
    Chunks  []common.PersistedChunkInfo // Chunk information
}
```

**Reply**: `ReportChunksReply`
```go
type ReportChunksReply struct {
    ErrorCode common.ErrorCode
}
```

**PersistedChunkInfo**:
```go
type PersistedChunkInfo struct {
    Handle      ChunkHandle
    Version     ChunkVersion
    Length      Offset
    Checksum    Checksum
    Completed   bool
    Abandoned   bool
    ChunkSize   int64
    CreationTime time.Time
    LastModified time.Time
    AccessTime   time.Time
    Replication  int
}
```

**Usage**: 
- Called on chunkserver startup
- Helps master rebuild chunk location information
- Reports chunk versions for stale detection

---

## Error Codes

```go
const (
    Success = iota                  // Operation successful
    UnknownError                    // Unexpected error
    Timeout                         // Operation timed out
    AppendExceedChunkSize          // Append would exceed chunk size
    WriteExceedChunkSize           // Write would exceed chunk size
    ReadEOF                        // Read past end of file
    NotAvailableForCopy            // Chunk not available
    DownloadBufferMiss             // Data not in download buffer
)
```

## Constants

```go
// Chunk Configuration
ChunkMaxSizeInByte    = 64 << 20      // 64 MB
AppendMaxSizeInByte   = 16 << 20      // 16 MB
MinimumReplicationFactor = 3          // Default replicas

// Timeouts
LeaseTimeout          = 60 * time.Second
ServerHealthCheckInterval = 10 * time.Second
ServerHealthCheckTimeout  = 60 * time.Second

// Intervals
MasterPersistMetaInterval = 15 * time.Hour
```

## Usage Examples

### Example 1: Create and Write to File

```go
// 1. Create file
createArg := &CreateFileArg{Path: "/myfile.txt"}
createReply := &CreateFileReply{}
client.Call("MasterServer.CreateFile", createArg, createReply)

// 2. Get chunk handle for first chunk
handleArg := &GetChunkHandleArg{
    Path: "/myfile.txt",
    ChunkIndex: 0,
}
handleReply := &GetChunkHandleReply{}
client.Call("MasterServer.GetChunkHandle", handleArg, handleReply)

// 3. Get replicas and lease
replicasArg := &GetReplicasArg{Handle: handleReply.Handle}
replicasReply := &GetReplicasReply{}
client.Call("MasterServer.GetReplicas", replicasArg, replicasReply)

// 4. Now write to primary chunkserver (see Chunk Server API)
```

### Example 2: Read File

```go
// 1. Get file info
infoArg := &GetFileInfoArg{Path: "/myfile.txt"}
infoReply := &GetFileInfoReply{}
client.Call("MasterServer.GetFileInfo", infoArg, infoReply)

// 2. For each chunk index (0 to infoReply.Chunks-1)
for i := 0; i < int(infoReply.Chunks); i++ {
    // Get chunk handle
    handleArg := &GetChunkHandleArg{
        Path: "/myfile.txt",
        ChunkIndex: common.ChunkIndex(i),
    }
    handleReply := &GetChunkHandleReply{}
    client.Call("MasterServer.GetChunkHandle", handleArg, handleReply)
    
    // Get locations
    locArg := &GetChunkLocationArg{Handle: handleReply.Handle}
    locReply := &GetChunkLocationReply{}
    client.Call("MasterServer.GetChunkLocation", locArg, locReply)
    
    // Read from any chunkserver in locReply.Locations
}
```

## Notes

- All RPC calls are synchronous
- Master serializes all metadata operations
- Clients should cache chunk locations to reduce master load
- Lease timeout is 60 seconds; clients must respect this
- Master runs periodic tasks: GC, re-replication, persistence
