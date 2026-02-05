# RPC Struct - Remote Procedure Call Definitions

## Overview

The **rpc_struct** package defines all Remote Procedure Call (RPC) contracts for the Hercules distributed file system. It provides strongly-typed argument and reply structures for communication between clients, gateway servers, master servers, and chunk servers.

**Key Features:**
- 📡 **27 RPC Contracts:** Complete API for distributed operations
- 🔒 **Type Safety:** Compile-time validation of RPC parameters
- 📝 **Self-Documenting:** Clear struct names and field descriptions
- 🔄 **Bidirectional:** Client-server and server-server communication
- ⚡ **Performance:** Minimal serialization overhead with Go's gob encoding

**Components:**
- Master Server RPCs (13): Metadata and coordination operations
- Chunk Server RPCs (11): Data storage and replication operations
- Handler Constants: Type-safe RPC method names

## Installation

This package is part of Hercules DFS:

```bash
# Clone repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# Install dependencies
go mod download

# Import in your code
import "github.com/caleberi/distributed-system/rpc_struct"
```

## Quick Start

### Making an RPC Call

```go
package main

import (
    "net/rpc"
    "github.com/caleberi/distributed-system/common"
    "github.com/caleberi/distributed-system/rpc_struct"
)

func main() {
    // Connect to master server
    client, err := rpc.Dial("tcp", "master-server:9000")
    if err != nil {
        panic(err)
    }
    defer client.Close()
    
    // Prepare RPC arguments
    args := rpc_struct.GetChunkHandleArgs{
        Path:  common.Path("/data/file.txt"),
        Index: 0,  // First chunk
    }
    
    // Make RPC call
    var reply rpc_struct.GetChunkHandleReply
    err = client.Call(rpc_struct.MRPCGetChunkHandleHandler, args, &reply)
    if err != nil {
        panic(err)
    }
    
    // Use result
    println("Chunk handle:", string(reply.Handle))
}
```

### Implementing an RPC Handler

```go
package main

import (
    "github.com/caleberi/distributed-system/rpc_struct"
    "github.com/caleberi/distributed-system/common"
)

type ChunkServer struct {
    chunks map[common.ChunkHandle][]byte
}

// Implement ReadChunk handler
func (cs *ChunkServer) RPCReadChunkHandler(
    args rpc_struct.ReadChunkArgs,
    reply *rpc_struct.ReadChunkReply,
) error {
    // Validate chunk exists
    data, exists := cs.chunks[args.Handle]
    if !exists {
        reply.ErrorCode = common.ChunkNotFound
        return nil
    }
    
    // Read data at offset
    end := args.Offset + common.Offset(args.Length)
    if end > common.Offset(len(data)) {
        end = common.Offset(len(data))
        reply.ErrorCode = common.ReadEOF
    } else {
        reply.ErrorCode = common.Success
    }
    
    // Copy data to reply
    reply.Data = data[args.Offset:end]
    reply.Length = int64(len(reply.Data))
    
    return nil
}

// Register handler
func main() {
    cs := &ChunkServer{chunks: make(map[common.ChunkHandle][]byte)}
    
    rpc.Register(cs)
    // Handler automatically available as "ChunkServer.RPCReadChunkHandler"
    
    // Start server...
}
```

## API Reference

### Master Server RPCs

The master server handles metadata operations and coordination.

#### GetChunkHandle

Get the chunk handle for a specific file chunk.

**Handler:** `MasterServer.RPCGetChunkHandleHandler`

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
    Handle common.ChunkHandle // Unique chunk identifier
}
```

**Example:**
```go
args := rpc_struct.GetChunkHandleArgs{
    Path:  common.Path("/videos/movie.mp4"),
    Index: 0,  // First 64MB chunk
}

var reply rpc_struct.GetChunkHandleReply
err := client.Call(rpc_struct.MRPCGetChunkHandleHandler, args, &reply)

// Use reply.Handle to access chunk servers
```

---

#### GetPrimaryAndSecondaryServersInfo

Get lease information (primary and secondary servers) for a chunk.

**Handler:** `MasterServer.RPCGetPrimaryAndSecondaryServersInfoHandler`

**Arguments:**
```go
type PrimaryAndSecondaryServersInfoArg struct {
    Handle common.ChunkHandle
}
```

**Reply:**
```go
type PrimaryAndSecondaryServersInfoReply struct {
    Primary          common.ServerAddr   // Primary server
    SecondaryServers []common.ServerAddr // Replica servers
    Expire           time.Time           // Lease expiration
}
```

**Example:**
```go
args := rpc_struct.PrimaryAndSecondaryServersInfoArg{
    Handle: chunkHandle,
}

var reply rpc_struct.PrimaryAndSecondaryServersInfoReply
err := client.Call(
    rpc_struct.MRPCGetPrimaryAndSecondaryServersInfoHandler,
    args,
    &reply,
)

// Write to reply.Primary
// Replicate to reply.SecondaryServers
```

---

#### List

List all files and directories under a path.

**Handler:** `MasterServer.RPCListHandler`

**Arguments:**
```go
type GetPathInfoArgs struct {
    Path   common.Path
    Handle common.ChunkHandle // Unused
}
```

**Reply:**
```go
type GetPathInfoReply struct {
    Entries []common.PathInfo
}
```

**Example:**
```go
args := rpc_struct.GetPathInfoArgs{
    Path: common.Path("/home/user"),
}

var reply rpc_struct.GetPathInfoReply
err := client.Call(rpc_struct.MRPCListHandler, args, &reply)

for _, entry := range reply.Entries {
    if entry.IsDir {
        fmt.Printf("DIR:  %s\n", entry.Name)
    } else {
        fmt.Printf("FILE: %s (%d bytes)\n", entry.Name, entry.Length)
    }
}
```

---

#### Mkdir

Create a directory.

**Handler:** `MasterServer.RPCMkdirHandler`

**Arguments:**
```go
type MakeDirectoryArgs struct {
    Path common.Path
}

type MakeDirectoryReply struct{}
```

**Example:**
```go
args := rpc_struct.MakeDirectoryArgs{
    Path: common.Path("/home/user/photos"),
}

var reply rpc_struct.MakeDirectoryReply
err := client.Call(rpc_struct.MRPCMkdirHandler, args, &reply)
```

---

#### CreateFile

Create a file entry in the namespace.

**Handler:** `MasterServer.RPCCreateFileHandler`

**Arguments:**
```go
type CreateFileArgs struct {
    Path common.Path
}

type CreateFileReply struct{}
```

---

#### DeleteFile

Delete a file or directory.

**Handler:** `MasterServer.RPCDeleteFileHandler`

**Arguments:**
```go
type DeleteFileArgs struct {
    Path         common.Path
    DeleteHandle bool  // Immediately delete chunk handles
}

type DeleteFileReply struct{}
```

**Example:**
```go
args := rpc_struct.DeleteFileArgs{
    Path:         common.Path("/temp/old-file.txt"),
    DeleteHandle: false,  // Soft delete (garbage collection later)
}

var reply rpc_struct.DeleteFileReply
err := client.Call(rpc_struct.MRPCDeleteFileHandler, args, &reply)
```

---

#### Rename

Move or rename a file/directory.

**Handler:** `MasterServer.RPCRenameHandler`

**Arguments:**
```go
type RenameFileArgs struct {
    Source common.Path
    Target common.Path
}

type RenameFileReply struct{}
```

---

#### GetFileInfo

Get metadata for a file.

**Handler:** `MasterServer.RPCGetFileInfoHandler`

**Arguments:**
```go
type GetFileInfoArgs struct {
    Path common.Path
}

type GetFileInfoReply struct {
    IsDir  bool
    Length int64  // Total file size
    Chunks int64  // Number of chunks
}
```

**Example:**
```go
args := rpc_struct.GetFileInfoArgs{
    Path: common.Path("/data/large-file.bin"),
}

var reply rpc_struct.GetFileInfoReply
err := client.Call(rpc_struct.MRPCGetFileInfoHandler, args, &reply)

fmt.Printf("File: %d bytes, %d chunks\n", reply.Length, reply.Chunks)
```

---

#### GetReplicas

Get all chunk server locations for a chunk.

**Handler:** `MasterServer.RPCGetReplicasHandler`

**Arguments:**
```go
type RetrieveReplicasArgs struct {
    Handle common.ChunkHandle
}

type RetrieveReplicasReply struct {
    Locations []common.ServerAddr
}
```

**Usage:** For **read operations** - can read from any replica.

---

#### HeartBeat

Chunk servers send periodic status updates.

**Handler:** `MasterServer.RPCHeartBeatHandler`

**Arguments:**
```go
type HeartBeatArg struct {
    Address       common.ServerAddr
    PendingLeases []*common.Lease
    MachineInfo   common.MachineInfo
    ExtendLease   bool
}
```

**Reply:**
```go
type HeartBeatReply struct {
    LastHeartBeat   time.Time
    LeaseExtensions []*common.Lease
    Garbage         []common.ChunkHandle  // Chunks to delete
    NetworkData     detector.NetworkData
}
```

---

#### UpdateFileMetadata

Update file size and chunk count after writes.

**Handler:** `MasterServer.RPCUpdateFileMetadataHandler`

**Arguments:**
```go
type UpdateFileMetadataArgs struct {
    Path   common.Path
    Length int64  // New total size
    Chunks int64  // New chunk count
}

type UpdateFileMetadataReply struct{}
```

---

### Chunk Server RPCs

Chunk servers handle data storage and replication.

#### ReadChunk

Read data from a chunk.

**Handler:** `ChunkServer.RPCReadChunkHandler`

**Arguments:**
```go
type ReadChunkArgs struct {
    Handle common.ChunkHandle
    Offset common.Offset
    Length int64
    Data   []byte         // Buffer to fill
    Lease  *common.Lease  // Optional for consistent reads
}
```

**Reply:**
```go
type ReadChunkReply struct {
    Data      []byte
    Length    int64
    ErrorCode common.ErrorCode
}
```

**Example:**
```go
// Prepare buffer
buffer := make([]byte, 4096)

args := rpc_struct.ReadChunkArgs{
    Handle: chunkHandle,
    Offset: 0,
    Length: 4096,
    Data:   buffer,
}

var reply rpc_struct.ReadChunkReply
err := client.Call(rpc_struct.CRPCReadChunkHandler, args, &reply)

if reply.ErrorCode == common.Success {
    // Process reply.Data
} else if reply.ErrorCode == common.ReadEOF {
    // Reached end of chunk
}
```

---

#### ForwardData

Send data to chunk server's buffer and propagate to replicas.

**Handler:** `ChunkServer.RPCForwardDataHandler`

**Arguments:**
```go
type ForwardDataArgs struct {
    DownloadBufferId common.BufferId
    Data             []byte
    Replicas         []common.ServerAddr  // Chain of replicas
}
```

**Reply:**
```go
type ForwardDataReply struct {
    ErrorCode common.ErrorCode
}
```

**Chain Replication Pattern:**
```go
// Client sends to primary with full replica chain
args := rpc_struct.ForwardDataArgs{
    DownloadBufferId: generateBufferID(),
    Data:             dataToWrite,
    Replicas:         []common.ServerAddr{secondary1, secondary2},
}

// Primary forwards to secondary1 with remaining chain
// Secondary1 forwards to secondary2
// Data now buffered on all servers
```

---

#### WriteChunk

Commit buffered data to chunk at offset.

**Handler:** `ChunkServer.RPCWriteChunkHandler`

**Arguments:**
```go
type WriteChunkArgs struct {
    DownloadBufferId common.BufferId
    Offset           common.Offset
    Replicas         []common.ServerAddr
}
```

**Reply:**
```go
type WriteChunkReply struct {
    Length    int
    ErrorCode common.ErrorCode
}
```

**Two-Phase Write:**
```go
// Phase 1: Forward data to all replicas
forwardArgs := rpc_struct.ForwardDataArgs{...}
client.Call(rpc_struct.CRPCForwardDataHandler, forwardArgs, &forwardReply)

// Phase 2: Commit write on all replicas
writeArgs := rpc_struct.WriteChunkArgs{
    DownloadBufferId: forwardArgs.DownloadBufferId,
    Offset:           0,
    Replicas:         secondaries,
}
client.Call(rpc_struct.CRPCWriteChunkHandler, writeArgs, &writeReply)
```

---

#### AppendChunk

Atomic append to end of chunk.

**Handler:** `ChunkServer.RPCAppendChunkHandler`

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
    Offset    common.Offset    // Where data was appended
    ErrorCode common.ErrorCode
}
```

**Example:**
```go
// First, forward data
forwardArgs := rpc_struct.ForwardDataArgs{
    DownloadBufferId: bufferID,
    Data:             appendData,
    Replicas:         replicas,
}
client.Call(rpc_struct.CRPCForwardDataHandler, forwardArgs, &forwardReply)

// Then, append
appendArgs := rpc_struct.AppendChunkArgs{
    DownloadBufferId: bufferID,
    Replicas:         replicas,
}

var appendReply rpc_struct.AppendChunkReply
err := client.Call(rpc_struct.CRPCAppendChunkHandler, appendArgs, &appendReply)

if appendReply.ErrorCode == common.AppendExceedChunkSize {
    // Chunk full, need to use new chunk
}
```

---

#### CreateChunk

Create a new chunk file.

**Handler:** `ChunkServer.RPCCreateChunkHandler`

**Arguments:**
```go
type CreateChunkArgs struct {
    Handle common.ChunkHandle
}

type CreateChunkReply struct {
    ErrorCode common.ErrorCode
}
```

---

#### CheckChunkVersion

Verify chunk version (detect stale replicas).

**Handler:** `ChunkServer.RPCCheckChunkVersionHandler`

**Arguments:**
```go
type CheckChunkVersionArg struct {
    Handle  common.ChunkHandle
    Version common.ChunkVersion
}

type CheckChunkVersionReply struct {
    Stale bool
}
```

---

#### ApplyMutation

Apply a mutation (write or append) to chunk.

**Handler:** `ChunkServer.RPCApplyMutationHandler`

**Arguments:**
```go
type ApplyMutationArgs struct {
    MutationType     common.MutationType
    DownloadBufferId common.BufferId
    Offset           common.Offset
}

type ApplyMutationReply struct {
    Length    int
    ErrorCode common.ErrorCode
}
```

---

#### GetSnapshot

Copy chunk data to another server (re-replication).

**Handler:** `ChunkServer.RPCGetSnapshotHandler`

**Arguments:**
```go
type GetSnapshotArgs struct {
    Handle   common.ChunkHandle
    Replicas common.ServerAddr
}

type GetSnapshotReply struct {
    ErrorCode common.ErrorCode
}
```

---

#### ApplyCopy

Write snapshot data (create new replica).

**Handler:** `ChunkServer.RPCApplyCopyHandler`

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

#### SysReport

Get system stats and chunk metadata.

**Handler:** `ChunkServer.RPCSysReportHandler`

**Arguments:**
```go
type SysReportInfoArg struct{}

type SysReportInfoReply struct {
    SysMem common.Memory
    Chunks []common.PersistedChunkInfo
}
```

---

#### GrantLease

Grant lease to chunk server (make it primary).

**Handler:** `ChunkServer.RPCGrantLeaseHandler`

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

---

## Usage Patterns

### Complete Write Operation

```go
func writeFile(client *rpc.Client, path string, data []byte) error {
    // 1. Get chunk handle
    chunkArgs := rpc_struct.GetChunkHandleArgs{
        Path:  common.Path(path),
        Index: 0,
    }
    var chunkReply rpc_struct.GetChunkHandleReply
    if err := client.Call(
        rpc_struct.MRPCGetChunkHandleHandler,
        chunkArgs,
        &chunkReply,
    ); err != nil {
        return err
    }
    
    // 2. Get lease (primary + secondaries)
    leaseArgs := rpc_struct.PrimaryAndSecondaryServersInfoArg{
        Handle: chunkReply.Handle,
    }
    var leaseReply rpc_struct.PrimaryAndSecondaryServersInfoReply
    if err := client.Call(
        rpc_struct.MRPCGetPrimaryAndSecondaryServersInfoHandler,
        leaseArgs,
        &leaseReply,
    ); err != nil {
        return err
    }
    
    // 3. Connect to primary
    primary, _ := rpc.Dial("tcp", string(leaseReply.Primary))
    defer primary.Close()
    
    // 4. Forward data (phase 1)
    bufferID := generateBufferID()
    forwardArgs := rpc_struct.ForwardDataArgs{
        DownloadBufferId: bufferID,
        Data:             data,
        Replicas:         leaseReply.SecondaryServers,
    }
    var forwardReply rpc_struct.ForwardDataReply
    if err := primary.Call(
        rpc_struct.CRPCForwardDataHandler,
        forwardArgs,
        &forwardReply,
    ); err != nil {
        return err
    }
    
    // 5. Write chunk (phase 2)
    writeArgs := rpc_struct.WriteChunkArgs{
        DownloadBufferId: bufferID,
        Offset:           0,
        Replicas:         leaseReply.SecondaryServers,
    }
    var writeReply rpc_struct.WriteChunkReply
    if err := primary.Call(
        rpc_struct.CRPCWriteChunkHandler,
        writeArgs,
        &writeReply,
    ); err != nil {
        return err
    }
    
    // 6. Update metadata
    updateArgs := rpc_struct.UpdateFileMetadataArgs{
        Path:   common.Path(path),
        Length: int64(len(data)),
        Chunks: 1,
    }
    var updateReply rpc_struct.UpdateFileMetadataReply
    return client.Call(
        rpc_struct.MRPCUpdateFileMetadataHandler,
        updateArgs,
        &updateReply,
    )
}
```

---

### Complete Read Operation

```go
func readFile(client *rpc.Client, path string) ([]byte, error) {
    // 1. Get chunk handle
    chunkArgs := rpc_struct.GetChunkHandleArgs{
        Path:  common.Path(path),
        Index: 0,
    }
    var chunkReply rpc_struct.GetChunkHandleReply
    if err := client.Call(
        rpc_struct.MRPCGetChunkHandleHandler,
        chunkArgs,
        &chunkReply,
    ); err != nil {
        return nil, err
    }
    
    // 2. Get replica locations
    replicaArgs := rpc_struct.RetrieveReplicasArgs{
        Handle: chunkReply.Handle,
    }
    var replicaReply rpc_struct.RetrieveReplicasReply
    if err := client.Call(
        rpc_struct.MRPCGetReplicasHandler,
        replicaArgs,
        &replicaReply,
    ); err != nil {
        return nil, err
    }
    
    // 3. Read from first available replica
    for _, addr := range replicaReply.Locations {
        replica, err := rpc.Dial("tcp", string(addr))
        if err != nil {
            continue  // Try next replica
        }
        defer replica.Close()
        
        buffer := make([]byte, 64*1024*1024)  // 64MB
        readArgs := rpc_struct.ReadChunkArgs{
            Handle: chunkReply.Handle,
            Offset: 0,
            Length: int64(len(buffer)),
            Data:   buffer,
        }
        
        var readReply rpc_struct.ReadChunkReply
        if err := replica.Call(
            rpc_struct.CRPCReadChunkHandler,
            readArgs,
            &readReply,
        ); err != nil {
            continue  // Try next replica
        }
        
        if readReply.ErrorCode == common.Success || 
           readReply.ErrorCode == common.ReadEOF {
            return readReply.Data[:readReply.Length], nil
        }
    }
    
    return nil, errors.New("failed to read from any replica")
}
```

---

## Error Handling

### Error Codes

All chunk server operations return `ErrorCode`:

```go
switch reply.ErrorCode {
case common.Success:
    // Operation successful
    
case common.ReadEOF:
    // Reached end of chunk (not an error for reads)
    
case common.ChunkNotFound:
    // Chunk doesn't exist - request new replica locations
    
case common.ChunkAbandoned:
    // Chunk is stale/corrupted - try different replica
    
case common.LeaseExpired:
    // Lease no longer valid - renew lease
    
case common.AppendExceedChunkSize:
    // Append would exceed 64MB - use new chunk
    
case common.UnknownError:
    // Unexpected server error - retry or report
}
```

### RPC Error vs Application Error

```go
err := client.Call(rpc_struct.CRPCReadChunkHandler, args, &reply)

if err != nil {
    // Network error or RPC failure
    // - Server unreachable
    // - Connection timeout
    // - Serialization error
    // Action: Try different server
}

if reply.ErrorCode != common.Success {
    // Application-level error
    // - Chunk not found
    // - Permission denied
    // - Data corruption
    // Action: Handle specific error code
}
```

---

## Best Practices

### 1. Always Check ErrorCode

```go
// ✓ Good
var reply rpc_struct.ReadChunkReply
err := client.Call(handler, args, &reply)
if err != nil {
    return err
}
if reply.ErrorCode != common.Success {
    return fmt.Errorf("read failed: %v", reply.ErrorCode)
}

// ✗ Bad
var reply rpc_struct.ReadChunkReply
client.Call(handler, args, &reply)
// Ignoring both err and ErrorCode!
```

---

### 2. Use Constants for Handler Names

```go
// ✓ Good
err := client.Call(rpc_struct.CRPCReadChunkHandler, args, &reply)

// ✗ Bad
err := client.Call("ChunkServer.RPCReadChunkHandler", args, &reply)
// Typo risk, no compile-time checking
```

---

### 3. Handle Timeouts

```go
// Set RPC timeout
client := &rpc.Client{...}
done := make(chan error, 1)

go func() {
    done <- client.Call(handler, args, &reply)
}()

select {
case err := <-done:
    // RPC completed
case <-time.After(5 * time.Second):
    // Timeout - try different server
}
```

---

### 4. Retry Logic

```go
func callWithRetry(client *rpc.Client, handler string, args, reply interface{}) error {
    maxRetries := 3
    
    for i := 0; i < maxRetries; i++ {
        err := client.Call(handler, args, reply)
        if err == nil {
            return nil
        }
        
        // Exponential backoff
        time.Sleep(time.Duration(1<<uint(i)) * time.Second)
    }
    
    return fmt.Errorf("failed after %d retries", maxRetries)
}
```

---

## Testing

### Mock RPC Server

```go
func TestReadChunk(t *testing.T) {
    // Setup mock server
    server := &MockChunkServer{
        chunks: map[common.ChunkHandle][]byte{
            "test-chunk": []byte("hello world"),
        },
    }
    
    rpc.Register(server)
    listener, _ := net.Listen("tcp", ":0")
    go http.Serve(listener, nil)
    defer listener.Close()
    
    // Connect client
    client, _ := rpc.Dial("tcp", listener.Addr().String())
    defer client.Close()
    
    // Test RPC
    args := rpc_struct.ReadChunkArgs{
        Handle: "test-chunk",
        Offset: 0,
        Length: 100,
    }
    var reply rpc_struct.ReadChunkReply
    
    err := client.Call(rpc_struct.CRPCReadChunkHandler, args, &reply)
    
    assert.NoError(t, err)
    assert.Equal(t, common.Success, reply.ErrorCode)
    assert.Equal(t, "hello world", string(reply.Data))
}
```

---

## FAQ

### Q: Why separate Args and Reply structs?

**A:** Clear separation of inputs and outputs. Prevents confusion about which fields are inputs vs outputs, and allows overlapping field names.

### Q: Can I add fields to existing structs?

**A:** Yes, adding new fields is backward compatible (old clients ignore new fields). Removing fields breaks compatibility.

### Q: Why include Lease in ReadChunkArgs?

**A:** Optional for **consistent reads**. If provided, ensures reading from primary with valid lease. If omitted, can read from any replica (may be stale).

### Q: What's the difference between WriteChunk and ApplyMutation?

**A:** 
- `WriteChunk`: Used by client/gateway to initiate write on primary
- `ApplyMutation`: Used by primary to propagate write to secondaries

### Q: How does chain replication work?

**A:** Client → Primary → Secondary1 → Secondary2. Each server forwards data to next in chain, saving client bandwidth.

### Q: Can I use this with gRPC instead of net/rpc?

**A:** Yes, but requires translation layer. Define protobuf messages matching these structs, then convert between formats.

---

## Related Components

- **common:** Type definitions (Path, ChunkHandle, ErrorCode, etc.)
- **master_server:** Implements master RPC handlers
- **chunkserver:** Implements chunk server RPC handlers
- **gateway:** RPC client for master and chunk servers

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## License

Part of the Hercules distributed file system project.

## Support

- GitHub Issues: https://github.com/caleberi/hercules-dfs/issues
- Documentation: [docs/](../docs/)
- Design Document: [DESIGN.md](DESIGN.md)
