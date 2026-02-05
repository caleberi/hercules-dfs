# RPC Struct - Remote Procedure Call Definitions Design Document

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [RPC Contracts](#rpc-contracts)
5. [Master Server RPCs](#master-server-rpcs)
6. [Chunk Server RPCs](#chunk-server-rpcs)
7. [Data Flow Patterns](#data-flow-patterns)
8. [Design Rationale](#design-rationale)
9. [Error Handling](#error-handling)
10. [Performance Considerations](#performance-considerations)
11. [Versioning and Compatibility](#versioning-and-compatibility)
12. [Security Considerations](#security-considerations)
13. [Testing Strategy](#testing-strategy)
14. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

The **rpc_struct** package defines the Remote Procedure Call (RPC) interface contracts for the Hercules distributed file system. It serves as the **central API specification** for all communication between:

- **Client ↔ Gateway:** File operations (upload, download, delete, list)
- **Gateway ↔ Master Server:** Metadata operations (file creation, namespace queries, lease requests)
- **Gateway ↔ Chunk Servers:** Data operations (read, write, append)
- **Master Server ↔ Chunk Servers:** Coordination (heartbeats, version checks, garbage collection)
- **Chunk Server ↔ Chunk Server:** Replication (data forwarding, snapshot copying)

This package is **protocol-agnostic** (works with Go's net/rpc, gRPC, or HTTP-based RPC) and provides **type-safe contracts** for distributed system communication.

### Design Philosophy

1. **Strong Typing:** All RPC arguments and replies are strongly typed structs
2. **Explicit Contracts:** Each operation has dedicated Arg/Reply pairs
3. **Self-Documenting:** Struct field names clearly indicate purpose
4. **Extensibility:** New fields can be added without breaking existing code
5. **Separation of Concerns:** Struct definitions separate from handler implementations

### Key Features

- 📦 **27 RPC Contracts:** Covering all distributed operations
- 🔗 **Handler Constants:** Type-safe RPC method names
- 📊 **Structured Data:** Leverages common package types
- 🔄 **Bidirectional Communication:** Client-server and server-server RPCs
- ⚡ **Performance Optimized:** Minimal serialization overhead

---

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                    Hercules DFS Components                       │
│                                                                   │
│  ┌──────────┐        ┌──────────────┐        ┌──────────────┐  │
│  │ Client/  │ ────── │    Master    │ ────── │    Chunk     │  │
│  │ Gateway  │        │    Server    │        │   Servers    │  │
│  └──────────┘        └──────────────┘        └──────────────┘  │
│       │                      │                       │          │
│       │                      │                       │          │
│       └──────────────────────┼───────────────────────┘          │
│                              │                                  │
│                         ┌────▼─────┐                           │
│                         │   RPC    │                           │
│                         │  Struct  │                           │
│                         │ Package  │                           │
│                         └──────────┘                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
rpc_struct/
├── structs.go       # All RPC argument/reply structs
├── handlers.go      # RPC handler name constants
├── DESIGN.md        # This document
└── README.md        # User guide
```

### Communication Patterns

#### 1. Client → Master → Chunk Server Flow

```
Client Request
    ↓
Gateway (translates to Master RPC)
    ↓
Master Server (GetChunkHandle, GetPrimaryAndSecondaryServersInfo)
    ↓
Gateway receives chunk locations
    ↓
Gateway → Chunk Server (ForwardData, WriteChunk)
    ↓
Chunk Server → Replicas (ForwardData)
```

#### 2. Heartbeat Flow

```
Chunk Server (periodic timer)
    ↓
Master Server (HeartBeat RPC)
    ↓
Master Server Reply (lease extensions, garbage collection)
    ↓
Chunk Server processes reply
```

#### 3. Replication Flow

```
Primary Chunk Server
    ↓
RPCForwardData → Secondary 1
    ↓
Secondary 1 → RPCForwardData → Secondary 2
    ↓
Chain completes
    ↓
Primary → RPCApplyMutation (to all secondaries in parallel)
```

---

## Core Components

### 1. RPC Handler Constants

**Location:** `handlers.go`

**Purpose:** Type-safe string constants for RPC method registration and invocation.

```go
const (
    // Master Server Handlers
    MRPCGetChunkHandleHandler                    = "MasterServer.RPCGetChunkHandleHandler"
    MRPCGetPrimaryAndSecondaryServersInfoHandler = "MasterServer.RPCGetPrimaryAndSecondaryServersInfoHandler"
    MRPCListHandler                              = "MasterServer.RPCListHandler"
    // ... 13 total master handlers
    
    // Chunk Server Handlers
    CRPCReadChunkHandler         = "ChunkServer.RPCReadChunkHandler"
    CRPCForwardDataHandler       = "ChunkServer.RPCForwardDataHandler"
    CRPCWriteChunkHandler        = "ChunkServer.RPCWriteChunkHandler"
    // ... 11 total chunk server handlers
)
```

**Design Benefits:**
- **Compile-Time Safety:** Typos caught at compile time
- **Refactoring Support:** IDE can rename all references
- **Centralized Registry:** Single source of truth for RPC names
- **Convention Enforcement:** Consistent naming (MRPC = Master, CRPC = ChunkServer)

**Naming Convention:**
```
[M|C]RPC{Operation}Handler
│ │   └─ Describes what operation does
│ └──── "RPC" indicates this is an RPC method name
└────── "M" = Master Server, "C" = Chunk Server
```

---

### 2. RPC Struct Pairs

Each RPC operation has two structs:

**Pattern:**
```go
type {Operation}Args struct {
    // Input parameters
}

type {Operation}Reply struct {
    // Output results
    ErrorCode common.ErrorCode  // Present in most replies
}
```

**Example:**
```go
type ReadChunkArgs struct {
    Handle common.ChunkHandle  // Which chunk to read
    Offset common.Offset       // Starting position
    Length int64               // How many bytes
    Data   []byte              // Buffer to fill
    Lease  *common.Lease       // Authorization token
}

type ReadChunkReply struct {
    Data      []byte           // Actual data read
    Length    int64            // Bytes read (may be less than requested)
    ErrorCode common.ErrorCode // Success, EOF, or error
}
```

---

## RPC Contracts

### Master Server RPCs (13 Operations)

Master Server handles **metadata operations** and **coordination**.

#### 1. GetChunkHandle

**Purpose:** Retrieve the chunk handle for a specific chunk index in a file.

**RPC Name:** `MasterServer.RPCGetChunkHandleHandler`

**Arguments:**
```go
type GetChunkHandleArgs struct {
    Path  common.Path       // File path (e.g., "/home/user/file.txt")
    Index common.ChunkIndex // Chunk index (0-based)
}
```

**Reply:**
```go
type GetChunkHandleReply struct {
    Handle common.ChunkHandle // Unique chunk identifier (UUID-like)
}
```

**Usage Flow:**
```
1. Client wants to read bytes 64MB-128MB of "/data/video.mp4"
2. Gateway calculates chunk index: 64MB / 64MB = index 1
3. Gateway → Master: GetChunkHandle("/data/video.mp4", 1)
4. Master → Gateway: Handle = "chunk-abc123"
5. Gateway uses handle to contact chunk servers
```

**Design Rationale:**
- **Separation of Concerns:** Clients work with paths, servers with handles
- **Location Transparency:** Master decides chunk placement
- **Lazy Allocation:** Chunks created on-demand when requested

---

#### 2. GetPrimaryAndSecondaryServersInfo

**Purpose:** Get the primary and secondary chunk servers for a chunk (lease information).

**RPC Name:** `MasterServer.RPCGetPrimaryAndSecondaryServersInfoHandler`

**Arguments:**
```go
type PrimaryAndSecondaryServersInfoArg struct {
    Handle common.ChunkHandle
}
```

**Reply:**
```go
type PrimaryAndSecondaryServersInfoReply struct {
    Primary          common.ServerAddr   // Primary server address
    SecondaryServers []common.ServerAddr // Secondary servers (replicas)
    Expire           time.Time           // Lease expiration time
}
```

**Usage Flow:**
```
1. Gateway has chunk handle "chunk-abc123"
2. Gateway → Master: GetPrimaryAndSecondaryServersInfo("chunk-abc123")
3. Master assigns/renews lease:
   - Primary: "chunkserver1:8081"
   - Secondaries: ["chunkserver2:8081", "chunkserver3:8081"]
   - Expire: 60 seconds from now
4. Gateway contacts primary for write operations
```

**Design Rationale:**
- **Write Ordering:** Single primary ensures sequential consistency
- **Lease Mechanism:** Prevents split-brain (only one primary at a time)
- **Expiration:** Automatic lease revocation if primary fails

---

#### 3. List

**Purpose:** List all files and directories under a path.

**RPC Name:** `MasterServer.RPCListHandler`

**Arguments:**
```go
type GetPathInfoArgs struct {
    Path   common.Path       // Directory path
    Handle common.ChunkHandle // Unused (legacy field?)
}
```

**Reply:**
```go
type GetPathInfoReply struct {
    Entries []common.PathInfo // List of files/directories
}
```

**Usage Flow:**
```
Gateway → Master: List("/home/user")
Master → Gateway: [
    {Name: "file.txt", IsDir: false, Length: 1024},
    {Name: "photos", IsDir: true, Length: 0},
]
```

---

#### 4. Mkdir

**Purpose:** Create a directory.

**Arguments:**
```go
type MakeDirectoryArgs struct {
    Path common.Path
}

type MakeDirectoryReply struct{}
```

**Usage:** `Gateway → Master: Mkdir("/home/user/newdir")`

---

#### 5. CreateFile

**Purpose:** Create a file in the namespace (metadata only, no data allocation yet).

**Arguments:**
```go
type CreateFileArgs struct {
    Path common.Path
}

type CreateFileReply struct{}
```

**Usage:** `Gateway → Master: CreateFile("/home/user/document.txt")`

---

#### 6. DeleteFile

**Purpose:** Delete a file or directory from the namespace.

**Arguments:**
```go
type DeleteFileArgs struct {
    Path         common.Path
    DeleteHandle bool  // Whether to delete chunk handles immediately
}

type DeleteFileReply struct{}
```

**Design Note:** `DeleteHandle=false` enables soft delete (namespace only, chunks garbage collected later).

---

#### 7. Rename

**Purpose:** Move or rename a file/directory.

**Arguments:**
```go
type RenameFileArgs struct {
    Source common.Path
    Target common.Path
}

type RenameFileReply struct{}
```

---

#### 8. GetFileInfo

**Purpose:** Retrieve metadata for a file (size, chunk count, type).

**Arguments:**
```go
type GetFileInfoArgs struct {
    Path common.Path
}

type GetFileInfoReply struct {
    IsDir  bool
    Length int64 // Total file size in bytes
    Chunks int64 // Number of chunks
}
```

---

#### 9. GetReplicas

**Purpose:** Get all chunk server locations for a chunk handle.

**Arguments:**
```go
type RetrieveReplicasArgs struct {
    Handle common.ChunkHandle
}

type RetrieveReplicasReply struct {
    Locations []common.ServerAddr
}
```

**Usage:** Used by clients for **read operations** (can read from any replica, not just primary).

---

#### 10. HeartBeat

**Purpose:** Chunk servers send periodic heartbeats to report status and receive instructions.

**Arguments:**
```go
type HeartBeatArg struct {
    Address       common.ServerAddr
    PendingLeases []*common.Lease     // Leases needing extension
    MachineInfo   common.MachineInfo  // CPU, memory, disk stats
    ExtendLease   bool                // Request lease extensions
}
```

**Reply:**
```go
type HeartBeatReply struct {
    LastHeartBeat   time.Time
    LeaseExtensions []*common.Lease     // Renewed leases
    Garbage         []common.ChunkHandle // Chunks to delete
    NetworkData     detector.NetworkData // For failure prediction
}
```

**Design Rationale:**
- **Piggybacking:** Heartbeat doubles as lease renewal request
- **Garbage Collection:** Master tells chunk servers which chunks to delete
- **Failure Detection:** Network data used for ϕ Accrual failure detection

---

#### 11. UpdateFileMetadata

**Purpose:** Update file size and chunk count after write operations.

**Arguments:**
```go
type UpdateFileMetadataArgs struct {
    Path   common.Path
    Length int64  // New total file size
    Chunks int64  // New chunk count
}

type UpdateFileMetadataReply struct{}
```

**Usage:** Called by gateway after successful write/append to keep namespace in sync.

---

### Chunk Server RPCs (11 Operations)

Chunk Servers handle **data operations** and **replication**.

#### 1. ReadChunk

**Purpose:** Read data from a chunk at a specific offset.

**Arguments:**
```go
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Length int64
    Data   []byte         // Pre-allocated buffer
    Lease  *common.Lease  // Read lease (optional for reads)
}
```

**Reply:**
```go
type ReadChunkReply struct {
    Data      []byte
    Length    int64            // Actual bytes read
    ErrorCode common.ErrorCode // Success, EOF, or error
}
```

**Error Codes:**
- `Success`: Data read successfully
- `ReadEOF`: Reached end of chunk
- `ChunkNotFound`: Chunk doesn't exist
- `ChunkAbandoned`: Chunk marked as abandoned

---

#### 2. ForwardData

**Purpose:** Send data to chunk server's download buffer and propagate to replicas.

**Arguments:**
```go
type ForwardDataArgs struct {
    DownloadBufferId common.BufferId     // Unique ID for this data
    Data             []byte              // Actual data bytes
    Replicas         []common.ServerAddr // Chain of replicas
}
```

**Reply:**
```go
type ForwardDataReply struct {
    ErrorCode common.ErrorCode
}
```

**Design Pattern - Chain Replication:**
```
Client → Primary: ForwardData(data, [Secondary1, Secondary2])
    Primary stores in buffer
    Primary → Secondary1: ForwardData(data, [Secondary2])
        Secondary1 stores in buffer
        Secondary1 → Secondary2: ForwardData(data, [])
            Secondary2 stores in buffer
```

**Rationale:** Offloads network bandwidth from client. Client sends data once, servers relay.

---

#### 3. WriteChunk

**Purpose:** Commit buffered data to a chunk at a specific offset.

**Arguments:**
```go
type WriteChunkArgs struct {
    DownloadBufferId common.BufferId     // References data in buffer
    Offset           common.Offset       // Where to write
    Replicas         []common.ServerAddr // Secondaries to replicate to
}
```

**Reply:**
```go
type WriteChunkReply struct {
    Length    int              // Bytes written
    ErrorCode common.ErrorCode
}
```

**Two-Phase Protocol:**
```
Phase 1: ForwardData (send data to all replicas)
Phase 2: WriteChunk (commit data to disk on all replicas)
```

---

#### 4. AppendChunk

**Purpose:** Append data to the end of a chunk (atomic append).

**Arguments:**
```go
type AppendChunkArgs struct {
    DownloadBufferId common.BufferId
    Replicas         []common.ServerAddr
}
```

**Reply:**
```go
type AppendChunkReply struct {
    Offset    common.Offset    // Offset where data was appended
    ErrorCode common.ErrorCode
}
```

**Special Cases:**
- If append would exceed max chunk size (64MB), returns `AppendExceedChunkSize`
- Chunk is padded to max size, client must retry with new chunk

---

#### 5. ApplyMutation

**Purpose:** Apply a mutation (write or append) to a chunk.

**Arguments:**
```go
type ApplyMutationArgs struct {
    MutationType     common.MutationType // Write or Append
    DownloadBufferId common.BufferId
    Offset           common.Offset
}
```

**Reply:**
```go
type ApplyMutationReply struct {
    Length    int
    ErrorCode common.ErrorCode
}
```

**Used For:** Replication coordination (primary tells secondaries to apply mutation).

---

#### 6. CreateChunk

**Purpose:** Create a new chunk file on the chunk server.

**Arguments:**
```go
type CreateChunkArgs struct {
    Handle common.ChunkHandle
}

type CreateChunkReply struct {
    ErrorCode common.ErrorCode
}
```

**Usage:** Master instructs chunk servers to allocate storage for a new chunk.

---

#### 7. CheckChunkVersion

**Purpose:** Verify chunk version to detect stale replicas.

**Arguments:**
```go
type CheckChunkVersionArg struct {
    Handle  common.ChunkHandle
    Version common.ChunkVersion
}

type CheckChunkVersionReply struct {
    Stale bool  // true if chunk is outdated
}
```

**Version Update Logic:**
```
If chunk.version == args.Version - 1:
    chunk.version = args.Version  // Update to latest
    reply.Stale = false
Else:
    chunk.abandoned = true
    reply.Stale = true  // Chunk is stale, mark for deletion
```

---

#### 8. GetSnapshot

**Purpose:** Copy chunk data to another chunk server (for re-replication).

**Arguments:**
```go
type GetSnapshotArgs struct {
    Handle   common.ChunkHandle
    Replicas common.ServerAddr  // Target server to copy to
}

type GetSnapshotReply struct {
    ErrorCode common.ErrorCode
}
```

**Usage:** Master orchestrates re-replication after server failure:
```
Master → Survivor ChunkServer: GetSnapshot(chunk123, NewReplica)
Survivor → NewReplica: ForwardData (full chunk)
NewReplica → Survivor: ApplyCopy (acknowledge)
```

---

#### 9. ApplyCopy

**Purpose:** Write snapshot data to create a new replica.

**Arguments:**
```go
type ApplyCopyArgs struct {
    Handle  common.ChunkHandle
    Data    []byte
    Version common.ChunkVersion
}

type ApplyCopyReply struct {
    ErrorCode common.ErrorCode
}
```

---

#### 10. SysReport

**Purpose:** Retrieve system statistics and chunk metadata from chunk server.

**Arguments:**
```go
type SysReportInfoArg struct{}

type SysReportInfoReply struct {
    SysMem common.Memory                // Memory usage stats
    Chunks []common.PersistedChunkInfo  // List of all chunks on server
}
```

**Usage:** Master queries chunk servers for monitoring and load balancing.

---

#### 11. GrantLease

**Purpose:** Grant a lease to a chunk server (making it primary).

**Arguments:**
```go
type GrantLeaseInfoArgs struct {
    Handle      common.ChunkHandle
    Expire      time.Time
    InUse       bool
    Primary     common.ServerAddr
    Secondaries []common.ServerAddr
}

type GrantLeaseInfoReply struct{}
```

**Design:** Master pushes lease information to chunk server (rather than chunk server pulling).

---

## Data Flow Patterns

### Write Operation Complete Flow

```
1. Client → Gateway: "Write 1MB to /file.txt at offset 0"

2. Gateway → Master: GetChunkHandle("/file.txt", 0)
   Master → Gateway: Handle = "chunk-abc"

3. Gateway → Master: GetPrimaryAndSecondaryServersInfo("chunk-abc")
   Master → Gateway: Primary=CS1, Secondaries=[CS2, CS3]

4. Gateway → CS1: ForwardData(data, [CS2, CS3])
   CS1 → CS2: ForwardData(data, [CS3])
   CS2 → CS3: ForwardData(data, [])
   (Data now in all servers' download buffers)

5. Gateway → CS1: WriteChunk(bufferId, offset, [CS2, CS3])
   CS1 writes to disk
   CS1 → CS2: ApplyMutation(bufferId, offset)
   CS1 → CS3: ApplyMutation(bufferId, offset)
   CS2, CS3 write to disk
   CS1 → Gateway: WriteChunkReply(Success)

6. Gateway → Master: UpdateFileMetadata("/file.txt", 1MB, 1 chunk)
```

---

### Read Operation Flow

```
1. Client → Gateway: "Read 1MB from /file.txt at offset 0"

2. Gateway → Master: GetChunkHandle("/file.txt", 0)
   Master → Gateway: Handle = "chunk-abc"

3. Gateway → Master: GetReplicas("chunk-abc")
   Master → Gateway: [CS1, CS2, CS3]

4. Gateway → CS1: ReadChunk("chunk-abc", offset, length)
   CS1 → Gateway: ReadChunkReply(data, 1MB, Success)

5. Gateway → Client: Data
```

**Optimization:** Read from nearest replica for reduced latency.

---

### Heartbeat and Garbage Collection Flow

```
Every 1 minute:
1. ChunkServer → Master: HeartBeat(address, leases, machineInfo)

2. Master checks:
   - Server health (failure detection)
   - Lease expirations
   - Orphaned chunks (chunks with no file references)

3. Master → ChunkServer: HeartBeatReply(
       leaseExtensions = [renewed leases],
       garbage = [chunk123, chunk456],  // Delete these
   )

4. ChunkServer processes reply:
   - Update leases
   - Delete chunks in garbage list
```

---

## Design Rationale

### Why Separate Args/Reply Structs?

**Alternative (shared struct):**
```go
type ReadChunk struct {
    // Input
    Handle common.ChunkHandle
    Offset common.Offset
    
    // Output
    Data []byte
    Length int64
}
```

**Problems:**
- Unclear which fields are inputs vs outputs
- Impossible to have same field name for input/output
- Encourages in-place modification (bad for concurrency)

**Chosen Approach:**
```go
type ReadChunkArgs struct { ... }   // Immutable input
type ReadChunkReply struct { ... }  // Output only
```

**Benefits:**
- Clear separation of concerns
- Immutable inputs safe for concurrent handlers
- Can have overlapping field names (e.g., `Data` in both)

---

### Why ErrorCode in Reply Structs?

**Design Decision:** Include `ErrorCode common.ErrorCode` in most reply structs.

**Rationale:**

1. **RPC Error vs Application Error:**
   ```go
   err := rpc.Call("ChunkServer.RPCReadChunk", args, &reply)
   if err != nil {
       // Network error, server unreachable
   }
   if reply.ErrorCode != common.Success {
       // Application-level error (chunk not found, permission denied)
   }
   ```

2. **Structured Error Handling:**
   ```go
   switch reply.ErrorCode {
   case common.Success:
       // Process data
   case common.ReadEOF:
       // Handle end of file
   case common.ChunkNotFound:
       // Request different replica
   }
   ```

3. **Client Retry Logic:**
   ```go
   if reply.ErrorCode == common.LeaseExpired {
       renewLease()
       retry()
   }
   ```

---

### Why Include Lease in ReadChunkArgs?

**Question:** Why does `ReadChunkArgs` have a `Lease` field if reads can go to any replica?

**Answer:** Optional lease for **consistent reads**.

**Use Cases:**

1. **Dirty Reads (no lease):** Read from any replica, may see stale data
2. **Consistent Reads (with lease):** Read from primary with valid lease, guaranteed up-to-date

**Implementation:**
```go
if args.Lease != nil && args.Lease.IsValid() {
    // Check we're the primary, validate lease
}
// Perform read
```

---

### Why Chain Replication in ForwardData?

**Alternative (star topology):**
```
Client → Primary
Client → Secondary1
Client → Secondary2
```

**Problems:**
- Client network bandwidth bottleneck
- Client must wait for all replicas
- Client handles replica failures

**Chosen (chain topology):**
```
Client → Primary → Secondary1 → Secondary2
```

**Benefits:**
- Client sends data once (saves bandwidth)
- Servers relay data (parallel network utilization)
- Failures detected and handled by servers
- Pipelining: Secondary1 receives data while Primary still receiving

---

## Error Handling

### Error Code Taxonomy

Errors are categorized into:

#### 1. Success States

```go
common.Success          // Operation completed successfully
common.ReadEOF          // Read reached end of chunk (not an error)
```

#### 2. Client Errors (4xx equivalent)

```go
common.ChunkNotFound    // Chunk doesn't exist
common.LeaseExpired     // Lease is no longer valid
common.AppendExceedChunkSize  // Append would exceed 64MB limit
```

#### 3. Server Errors (5xx equivalent)

```go
common.ChunkAbandoned   // Chunk is corrupted or stale
common.UnknownError     // Unexpected server error
```

### Error Propagation Example

```go
// Handler implementation
func (cs *ChunkServer) RPCReadChunkHandler(args ReadChunkArgs, reply *ReadChunkReply) error {
    chunk, exists := cs.chunks[args.Handle]
    if !exists {
        reply.ErrorCode = common.ChunkNotFound
        return nil  // RPC succeeded, but app-level error
    }
    
    if chunk.abandoned {
        reply.ErrorCode = common.ChunkAbandoned
        return nil
    }
    
    n, err := readChunk(args.Handle, args.Offset, args.Data)
    if err == io.EOF {
        reply.ErrorCode = common.ReadEOF
        reply.Length = int64(n)
        return nil
    }
    if err != nil {
        reply.ErrorCode = common.UnknownError
        return fmt.Errorf("read failed: %w", err)  // RPC error
    }
    
    reply.Data = args.Data[:n]
    reply.Length = int64(n)
    reply.ErrorCode = common.Success
    return nil
}
```

**Client Handling:**
```go
err := rpc.Call("ChunkServer.RPCReadChunk", args, &reply)
if err != nil {
    // Network/RPC error - try different replica
    return tryDifferentReplica()
}

switch reply.ErrorCode {
case common.Success:
    return reply.Data
case common.ReadEOF:
    return reply.Data  // Partial data is valid
case common.ChunkNotFound:
    // Ask master for new replica locations
    return requestNewReplicas()
case common.ChunkAbandoned:
    // Report to master, try different replica
    return reportAndRetry()
}
```

---

## Performance Considerations

### Serialization Overhead

**Go RPC (gob encoding):**
- Efficient for Go-to-Go communication
- Overhead: ~50-100 bytes per RPC

**Example:**
```go
type ReadChunkArgs struct {
    Handle common.ChunkHandle  // 16 bytes (UUID)
    Offset common.Offset       // 8 bytes (int64)
    Length int64               // 8 bytes
    Data   []byte              // Allocated buffer (not serialized if empty)
    Lease  *common.Lease       // ~100 bytes (if present)
}
// Total serialized size: ~150 bytes overhead for 1MB read
```

---

### Large Data Transfers

**Challenge:** `ForwardDataArgs.Data` can be up to 64MB.

**Optimizations:**

1. **Streaming RPC (future):**
   ```go
   // Instead of:
   ForwardData(data []byte)
   
   // Use:
   stream := OpenStream()
   stream.Write(chunk1)
   stream.Write(chunk2)
   stream.Close()
   ```

2. **Zero-Copy (using io.Reader):**
   ```go
   type ForwardDataArgs struct {
       Reader io.Reader  // Stream data instead of buffering
   }
   ```

3. **Compression (current):**
   ```go
   // Compress data before ForwardData
   compressedData := compress(data)
   ForwardData(compressedData)
   ```

---

### Batch Operations

**Current Limitation:** Each file operation requires separate RPCs.

**Future Enhancement:**
```go
type BatchCreateArgs struct {
    Paths []common.Path
}

type BatchCreateReply struct {
    Results []common.ErrorCode  // One per path
}
```

---

## Versioning and Compatibility

### Backward Compatibility Strategy

**Adding Fields:**
```go
// Version 1
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Length int64
}

// Version 2 (backward compatible)
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Length int64
    
    // New optional field
    Checksum bool  // Verify checksum after read
}
```

✅ Old clients (don't set Checksum) work with new servers
✅ New clients work with old servers (field ignored)

**Removing Fields:**
```go
// Version 1
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Data   []byte  // Pre-allocated buffer
}

// Version 2 (BREAKING CHANGE)
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    // ❌ Removed Data field
}
```

❌ Old clients will send `Data` field, new servers ignore (works but inefficient)
❌ New clients won't send `Data`, old servers expect it (BREAKS)

**Mitigation:** Use API versioning:
```go
const (
    MRPCReadChunkV1 = "ChunkServer.RPCReadChunkV1"
    MRPCReadChunkV2 = "ChunkServer.RPCReadChunkV2"
)
```

---

### Protocol Evolution

**Current State:** All RPCs use Go's net/rpc with gob encoding.

**Future Migration Path:**

1. **gRPC (protobuf):**
   ```protobuf
   service ChunkServer {
       rpc ReadChunk(ReadChunkRequest) returns (ReadChunkResponse);
   }
   
   message ReadChunkRequest {
       bytes handle = 1;
       int64 offset = 2;
       int64 length = 3;
   }
   ```

2. **Translation Layer:**
   ```go
   func (s *ChunkServer) ReadChunk(ctx context.Context, req *pb.ReadChunkRequest) (*pb.ReadChunkResponse, error) {
       // Convert protobuf → rpc_struct
       args := rpc_struct.ReadChunkArgs{
           Handle: common.ChunkHandle(req.Handle),
           Offset: common.Offset(req.Offset),
           Length: req.Length,
       }
       
       // Call existing handler
       var reply rpc_struct.ReadChunkReply
       err := s.RPCReadChunkHandler(args, &reply)
       
       // Convert rpc_struct → protobuf
       return &pb.ReadChunkResponse{
           Data: reply.Data,
           Length: reply.Length,
           ErrorCode: int32(reply.ErrorCode),
       }, err
   }
   ```

---

## Security Considerations

### 1. Authentication

**Current:** No authentication in RPC structs.

**Future Enhancement:**
```go
type AuthToken struct {
    UserID    string
    Signature []byte
    Timestamp time.Time
}

type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Length int64
    Auth   AuthToken  // ← Add authentication
}
```

---

### 2. Authorization

**Current:** No access control.

**Future Enhancement:**
```go
// Master checks permissions before returning chunk handle
func (ms *MasterServer) RPCGetChunkHandle(args GetChunkHandleArgs, reply *GetChunkHandleReply) error {
    if !hasReadPermission(args.Auth, args.Path) {
        return errors.New("permission denied")
    }
    // ...
}
```

---

### 3. Data Integrity

**Current:** Checksum computed and stored, but not verified on read.

**Enhancement:**
```go
type ReadChunkReply struct {
    Data      []byte
    Length    int64
    Checksum  common.Checksum  // ← Return checksum
    ErrorCode common.ErrorCode
}

// Client verifies:
if !verifyChecksum(reply.Data, reply.Checksum) {
    // Data corrupted, try different replica
}
```

---

## Testing Strategy

### Unit Tests

Test struct serialization/deserialization:

```go
func TestReadChunkArgsSerialization(t *testing.T) {
    original := ReadChunkArgs{
        Handle: common.ChunkHandle("test-chunk"),
        Offset: 1024,
        Length: 4096,
    }
    
    // Serialize
    var buf bytes.Buffer
    enc := gob.NewEncoder(&buf)
    err := enc.Encode(original)
    assert.NoError(t, err)
    
    // Deserialize
    var decoded ReadChunkArgs
    dec := gob.NewDecoder(&buf)
    err = dec.Decode(&decoded)
    assert.NoError(t, err)
    
    // Verify
    assert.Equal(t, original, decoded)
}
```

---

### Integration Tests

Test RPC round-trip:

```go
func TestReadChunkRPC(t *testing.T) {
    // Start mock chunk server
    server := startMockChunkServer()
    defer server.Stop()
    
    // Create RPC client
    client, _ := rpc.Dial("tcp", server.Address)
    defer client.Close()
    
    // Make RPC call
    args := ReadChunkArgs{
        Handle: "test-chunk",
        Offset: 0,
        Length: 1024,
    }
    var reply ReadChunkReply
    
    err := client.Call(CRPCReadChunkHandler, args, &reply)
    assert.NoError(t, err)
    assert.Equal(t, common.Success, reply.ErrorCode)
    assert.Equal(t, 1024, len(reply.Data))
}
```

---

### Contract Tests

Ensure backward compatibility:

```go
func TestBackwardCompatibility_ReadChunk(t *testing.T) {
    // Old struct (missing new fields)
    type OldReadChunkArgs struct {
        Handle common.ChunkHandle
        Offset common.Offset
        Length int64
    }
    
    oldArgs := OldReadChunkArgs{
        Handle: "test",
        Offset: 0,
        Length: 100,
    }
    
    // Serialize with old struct
    var buf bytes.Buffer
    gob.NewEncoder(&buf).Encode(oldArgs)
    
    // Deserialize with new struct
    var newArgs ReadChunkArgs
    err := gob.NewDecoder(&buf).Decode(&newArgs)
    
    // Should work (new fields get zero values)
    assert.NoError(t, err)
    assert.Equal(t, oldArgs.Handle, newArgs.Handle)
}
```

---

## Future Enhancements

### 1. Streaming RPCs

For large data transfers:

```go
type StreamForwardDataArgs struct {
    DownloadBufferId common.BufferId
    Replicas         []common.ServerAddr
}

// Client sends:
stream := client.StreamForwardData(args)
stream.Send(chunk1)
stream.Send(chunk2)
stream.Send(chunk3)
stream.CloseAndRecv()  // Get reply
```

---

### 2. Batch Operations

Reduce RPC overhead:

```go
type BatchReadChunkArgs struct {
    Requests []ReadChunkArgs
}

type BatchReadChunkReply struct {
    Replies []ReadChunkReply
}
```

---

### 3. Compression Metadata

Track compression in RPC args:

```go
type ForwardDataArgs struct {
    DownloadBufferId common.BufferId
    Data             []byte
    Replicas         []common.ServerAddr
    Compressed       bool              // ← Data is compressed
    CompressionAlgo  string            // ← "gzip", "lz4", etc.
}
```

---

### 4. Request Tracing

Distributed tracing support:

```go
type TraceContext struct {
    TraceID  string
    SpanID   string
    ParentID string
}

// Add to all Args structs:
type ReadChunkArgs struct {
    // ... existing fields ...
    Trace TraceContext
}
```

---

### 5. Rate Limiting

```go
type RateLimitInfo struct {
    ClientID  string
    Priority  int
}

type ReadChunkArgs struct {
    // ... existing fields ...
    RateLimit RateLimitInfo
}
```

---

## Conclusion

The **rpc_struct** package provides a **clean, type-safe RPC contract** for the Hercules distributed file system. Its design prioritizes:

✅ **Strong Typing:** Compile-time safety for all RPC operations  
✅ **Extensibility:** Easy to add new fields without breaking compatibility  
✅ **Clarity:** Separate Args/Reply structs make intent explicit  
✅ **Performance:** Minimal serialization overhead  
✅ **Maintainability:** Centralized constants prevent typos  

**Key Strengths:**
- Comprehensive coverage of all distributed operations
- Well-structured error handling via ErrorCode
- Clear separation between network errors and application errors
- Support for complex data flows (chain replication, snapshots)

**Areas for Improvement:**
- Add authentication/authorization fields
- Implement streaming for large data transfers
- Add batch operation support
- Include tracing/monitoring metadata

This package forms the **foundation of all inter-component communication** in Hercules DFS, making it critical infrastructure that must remain stable while supporting gradual evolution.
