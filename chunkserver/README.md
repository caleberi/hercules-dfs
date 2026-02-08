# ChunkServer

A high-performance chunk storage server implementation for the Hercules distributed file system, based on the Google File System (GFS) architecture.

## Overview

The ChunkServer is responsible for storing fixed-size data chunks (typically 64MB), handling read/write operations, managing replicas, and coordinating with the master server for metadata operations. It implements lease-based write coordination, version-controlled mutations, and automatic data archiving.

## Features

### Core Capabilities

- **Chunk Storage:** Stores and manages fixed-size data chunks with versioning
- **Replication:** Coordinates with replica servers for data redundancy
- **Lease Management:** Implements primary-based write coordination
- **Version Control:** Tracks chunk versions for consistency
- **Data Integrity:** Checksum verification for corruption detection
- **Automatic Archiving:** Compresses infrequently accessed chunks
- **Failure Detection:** Monitors master server health via Redis-based heartbeat
- **Garbage Collection:** Automatic cleanup of deleted chunks
- **Metadata Persistence:** Periodic snapshots for crash recovery

### Advanced Features

- **Download Buffer:** Temporary storage for pipelined writes
- **Chain Replication:** Efficient data forwarding to replicas
- **Atomic Record Append:** Consistent append operations
- **Dynamic Re-replication:** Automatic replica creation on failures
- **System Monitoring:** Resource usage tracking and reporting

## Architecture

```
┌─────────────────────────────────────────────────┐
│              ChunkServer                        │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────┐  ┌──────────────┐            │
│  │  RPC Layer  │  │ File System  │            │
│  └──────┬──────┘  └──────┬───────┘            │
│         │                 │                     │
│  ┌──────▼─────────────────▼──────┐             │
│  │     Chunk Manager              │             │
│  │  • Read/Write/Append           │             │
│  │  • Version Control             │             │
│  │  • Lease Management            │             │
│  └──────┬─────────────────────────┘             │
│         │                                        │
│  ┌──────▼──────────┐  ┌────────────────┐       │
│  │ Download Buffer │  │ Archive Manager│       │
│  └─────────────────┘  └────────────────┘       │
│                                                 │
│  ┌──────────────────┐  ┌────────────────┐      │
│  │Failure Detector  │  │Garbage Collector│     │
│  └──────────────────┘  └────────────────┘      │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Go 1.21 or higher
- Redis server (for failure detection)
- Network connectivity to master server

### Dependencies

```bash
go get github.com/redis/go-redis/v9
go get github.com/rs/zerolog
go get github.com/olekukonko/tablewriter
go get github.com/stretchr/testify
go get github.com/jaswdr/faker/v2
```

## Usage

### Basic Setup

```go
import (
    "github.com/caleberi/distributed-system/chunkserver"
    "github.com/caleberi/distributed-system/common"
)

// Create a new ChunkServer instance
server, err := chunkserver.NewChunkServer(
    common.ServerAddr("localhost:9000"),  // ChunkServer address
    common.ServerAddr("localhost:8000"),  // Master server address
    common.ServerAddr("localhost:6379"),  // Redis address
    "/data/chunks",                       // Root directory for chunks
)
if err != nil {
    log.Fatal(err)
}

// Server runs background tasks automatically
// Shutdown when done
defer server.Shutdown()
```

### Configuration

Key parameters are defined in `common/constants.go`:

```go
// Timing intervals
HeartBeatInterval           = 100 * time.Millisecond
GarbageCollectionInterval   = 60 * time.Second
PersistMetaDataInterval     = 30 * time.Second
ArchiveChunkInterval        = 5 * time.Minute

// Buffer settings
DownloadBufferItemExpire    = 1 * time.Minute

// Archival settings
ArchivalDaySpan             = 30 // days
```

## API

### RPC Interface

#### Client Operations

##### Read Chunk
```go
args := rpc_struct.ReadChunkArgs{
    Handle:  chunkHandle,
    Version: expectedVersion,
    Offset:  0,
    Length:  1024,
}
reply := &rpc_struct.ReadChunkReply{}
client.Call("ChunkServer.RPCReadChunkHandler", args, reply)
```

##### Write Chunk (via Primary)
```go
// Step 1: Forward data to all replicas
args := rpc_struct.ForwardDataArgs{
    DownloadBufferId: bufferId,
    Data:            data,
    Replicas:        secondaryServers,
}
reply := &rpc_struct.ForwardDataReply{}
client.Call("ChunkServer.RPCForwardDataHandler", args, reply)

// Step 2: Request write from primary
writeArgs := rpc_struct.WriteChunkArgs{
    DownloadBufferId: bufferId,
    Offset:          offset,
    Replicas:        secondaryServers,
}
writeReply := &rpc_struct.WriteChunkReply{}
client.Call("ChunkServer.RPCWriteChunkHandler", writeArgs, writeReply)
```

##### Atomic Append
```go
args := rpc_struct.AppendChunkArgs{
    DownloadBufferId: bufferId,
    Replicas:        secondaryServers,
}
reply := &rpc_struct.AppendChunkReply{}
client.Call("ChunkServer.RPCAppendChunkHandler", args, reply)
// reply.Offset contains the offset where data was written
```

#### Master Operations

##### Create Chunk
```go
args := rpc_struct.CreateChunkArgs{
    Handle: newChunkHandle,
}
reply := &rpc_struct.CreateChunkReply{}
client.Call("ChunkServer.RPCCreateChunkHandler", args, reply)
```

##### Grant Lease
```go
args := rpc_struct.GrantLeaseInfoArgs{
    Handle:     chunkHandle,
    Lease:      leaseInfo,
    IsPrimary:  true,
}
reply := &rpc_struct.GrantLeaseInfoReply{}
client.Call("ChunkServer.RPCGrantLeaseHandler", args, reply)
```

##### Check Version
```go
args := rpc_struct.CheckChunkVersionArgs{
    Handle:  chunkHandle,
    Version: expectedVersion,
}
reply := &rpc_struct.CheckChunkVersionReply{}
client.Call("ChunkServer.RPCCheckChunkVersionHandler", args, reply)
```

## Background Tasks

The ChunkServer runs four main background tasks:

### 1. Heartbeat (100ms)
Reports liveness and status to the master server:
- Server address and machine info
- Active leases
- Chunk handles and versions
- Disk space and memory usage

### 2. Metadata Persistence (30s)
Saves chunk metadata to disk for recovery:
- Chunk versions and checksums
- Pending mutations
- Status flags and timestamps

### 3. Garbage Collection (60s)
Removes deleted chunks:
- Processes garbage queue
- Deletes chunk files
- Cleans up metadata

### 4. Archive Chunks (5min)
Compresses inactive chunks:
- Identifies chunks not accessed in 30+ days
- Compresses with gzip
- Automatically decompresses on read

## Data Organization

### Directory Structure

```
/data/chunks/
├── chunk_1                    # Active chunk
├── chunk_2.gz                 # Compressed chunk
├── chunk_3                    # Active chunk
└── .meta/
    ├── 1.meta                 # Metadata for chunk_1
    ├── 2.meta                 # Metadata for chunk_2
    └── 3.meta                 # Metadata for chunk_3
```

### Metadata Format

Each chunk has associated metadata stored in GOB format:

```go
PersistedMetaData {
    Handle          // Unique chunk identifier
    Version         // Current version number
    Length          // Data length in bytes
    Checksum        // Data integrity checksum
    Mutations       // Pending mutations
    CreationTime    // When chunk was created
    LastModified    // Last write timestamp
    AccessTime      // Last read timestamp
}
```

## Write Protocol

### Standard Write Flow

1. **Client gets primary and secondaries from master**
2. **Client forwards data to all replicas** (pipelined)
   - Primary receives from client
   - Primary forwards to Secondary1
   - Secondary1 forwards to Secondary2, etc.
3. **Client requests write from primary**
4. **Primary assigns version number and serial order**
5. **Primary writes locally**
6. **Primary forwards mutations to secondaries**
7. **Secondaries apply mutations and ACK**
8. **Primary replies to client**

### Atomic Append Flow

1. **Client forwards data to all replicas**
2. **Client requests append from primary**
3. **Primary checks if record fits in chunk**
4. **If fits:**
   - Append at current end offset
   - Apply to all replicas
   - Return offset to client
5. **If doesn't fit:**
   - Pad chunk to max size
   - Tell client to retry with next chunk

## Failure Handling

### ChunkServer Failure
- Master detects via missing heartbeats
- Master schedules re-replication
- Other servers create new replicas

### Network Partition
- Lease timeout prevents split-brain
- Version checking detects stale servers

### Data Corruption
- Checksum verification on every read
- Corrupted replicas reported to master
- Master schedules re-replication from good replica

### Crash Recovery
- Load metadata from `.meta` directory
- Reconstruct in-memory state
- Report to master via heartbeat
- Master reconciles versions

## Performance Considerations

### Optimizations

1. **Pipeline Parallelism:** Data forwarding overlaps with network transfer
2. **Download Buffer:** Decouples data push from write commit
3. **Batched Persistence:** Amortizes disk I/O cost
4. **Per-Chunk Locking:** Allows concurrent operations on different chunks
5. **Worker Pool Archival:** Parallel compression/decompression

### Bottlenecks

- **Disk I/O:** Primary bottleneck for write throughput
- **Network Bandwidth:** Limits replication speed
- **Lease Coordination:** Serializes writes to same chunk
- **Metadata Size:** Memory usage grows with chunk count

## Monitoring

### System Reports

The ChunkServer provides detailed system information via `RPCSysReportHandler`:

```go
// Disk usage
DiskUsage {
    Total, Free, Used, UsedPercent
    InodesTotal, InodesUsed, InodesFree
}

// Memory stats
MemoryUsage {
    Total, Available, Used, UsedPercent
    SwapTotal, SwapFree
}

// CPU info
NumCPU, NumChunks, ServerAddr
```

### Logging

Uses `zerolog` for structured logging:

```go
log.Info().Msg("ChunkServer started")
log.Error().Err(err).Msg("Failed to write chunk")
log.Debug().Int64("handle", handle).Msg("Chunk created")
```

## Testing

### Run Tests

```bash
# Run all tests
go test -v

# Run specific test
go test -v -run TestChunkServerCreation

# Run with race detection
go test -race -v

# Run benchmarks
go test -bench=. -benchmem
```

### Test Coverage

```bash
go test -cover
go test -coverprofile=coverage.out
go tool cover -html=coverage.out
```

## Troubleshooting

### Common Issues

#### "Connection refused" to master
- Ensure master server is running
- Check master address configuration
- Verify network connectivity

#### "Chunk version mismatch"
- Normal after failures
- ChunkServer will sync with master via heartbeat
- Stale chunks will be garbage collected

#### "Disk full" errors
- Monitor disk usage
- Adjust archival settings to compress more aggressively
- Consider adding more ChunkServers

#### "Redis connection failed"
- Ensure Redis server is running
- Check Redis address configuration
- Verify Redis is accessible

### Debug Mode

Enable verbose logging:

```go
log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
zerolog.SetGlobalLevel(zerolog.DebugLevel)
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.

## Architecture Documentation

For detailed design information, see [DESIGN.md](./DESIGN.md).

## License

Part of the Hercules distributed file system project.

## References

- [Google File System Paper](https://static.googleusercontent.com/media/research.google.com/en//archive/gfs-sosp2003.pdf)
- [GFS Design Patterns](../docs/architecture/overview.md)
- [Hercules Documentation](../docs/README.md)
