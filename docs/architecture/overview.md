# Hercules Architecture Overview

## Introduction

Hercules is a distributed file system that follows the design principles of the Google File System (GFS). It consists of a single master server and multiple chunkservers, all accessed through a client library or HTTP gateway.

## High-Level Architecture

```
┌─────────────┐
│   Clients   │
│  (Gateway)  │
└──────┬──────┘
       │
       │ (1) Request metadata
       ▼
┌─────────────────┐
│  Master Server  │◄──────┐
│   (Metadata)    │       │ (Heartbeats)
└─────────────────┘       │
       │                  │
       │ (2) Return chunk │
       │     locations    │
       │                  │
       ▼                  │
┌─────────────────────────┴───────────────┐
│          Chunkserver Network            │
│  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ Chunk 1  │  │ Chunk 2  │  │ Chunk 3││
│  └──────────┘  └──────────┘  └────────┘│
└─────────────────────────────────────────┘
       │
       │ (3) Read/Write data
       ▼
    [Client]
```

## Core Components

### 1. Master Server
**Purpose**: Central metadata and coordination server

**Responsibilities**:
- Maintains all file system metadata
- Manages namespace (directory hierarchy)
- Controls chunk placement and replication
- Manages chunk leases for mutations
- Performs garbage collection
- Handles chunk migration and re-replication

**Key Data Structures**:
- File namespace tree (directories and files)
- File-to-chunk mappings
- Chunk location information
- Chunk version numbers
- Lease information

**Port**: Default 9090

### 2. Chunkservers
**Purpose**: Storage nodes that hold actual file data

**Responsibilities**:
- Store chunks as local Linux files
- Serve read/write requests from clients
- Send periodic heartbeats to master
- Report chunk information to master
- Perform local garbage collection
- Handle chunk replication
- Validate data integrity via checksums

**Ports**: Default 8081, 8082, 8083 (for 3 chunkservers)

### 3. Gateway Server
**Purpose**: HTTP API gateway for client access

**Responsibilities**:
- Provides RESTful HTTP interface
- Translates HTTP requests to internal RPC calls
- Manages client sessions
- Handles file uploads/downloads
- Provides monitoring endpoints

**Port**: Default 8089

### 4. Failure Detector
**Purpose**: Monitor health of chunkservers using φ Accrual algorithm

**Responsibilities**:
- Collect heartbeat data
- Calculate failure probability (φ value)
- Trigger alerts on potential failures
- Support master's re-replication decisions

**Backend**: Redis-based storage for historical data

### 5. Namespace Manager
**Purpose**: Manage file and directory hierarchy

**Responsibilities**:
- Maintain directory tree structure
- Handle path resolution
- Support file/directory operations (create, delete, rename)
- Enforce naming constraints
- Track deleted items

### 6. Archive Manager
**Purpose**: Snapshot and archival operations

**Responsibilities**:
- Create point-in-time snapshots
- Manage archival policies
- Handle chunk archiving
- Support restoration from archives

## Design Principles

### 1. Single Master Architecture
- Simplifies design and enables sophisticated chunk placement
- Master maintains all metadata in memory for fast access
- Potential bottleneck mitigated by minimal client-master interaction

### 2. Large Chunk Size
- Default 64MB chunks reduce metadata overhead
- Reduces client-master communication
- Enables efficient sequential reads/writes
- May cause internal fragmentation for small files

### 3. No POSIX Compatibility
- Relaxed consistency model
- No hard links or symbolic links
- Optimized for append operations
- Focus on large files and streaming access

### 4. Append-Oriented Workload
- Optimized for append operations (common in GFS workloads)
- Record append is atomic and guaranteed
- Multiple clients can append concurrently

### 5. Co-designed Applications
- Applications designed with file system semantics in mind
- Tolerate relaxed consistency
- Use atomic append for concurrent writes

## Data Flow

### Read Operation
1. Client asks master for chunk locations
2. Master returns chunk handle and server locations
3. Client caches this information
4. Client contacts nearest chunkserver directly
5. Chunkserver reads data and returns to client

### Write Operation
1. Client asks master for chunk locations and lease holder
2. Master grants lease to one replica (primary)
3. Master returns primary and secondary locations
4. Client pushes data to all replicas (pipelined)
5. Client sends write request to primary
6. Primary assigns serial number and applies mutation
7. Primary forwards request to secondaries
8. Secondaries apply mutation and acknowledge
9. Primary replies to client

### Append Operation
1. Similar to write, but offset is chosen by primary
2. Primary appends at current end-of-chunk
3. If append would exceed chunk boundary, pad and retry on next chunk
4. All replicas append at same offset (guaranteed atomic)

## Consistency Model

### Guarantees
- **Consistent**: All clients see the same data
- **Defined**: Consistent and clients see entire mutation
- **Undefined but consistent**: Concurrent mutations may interleave

### Write Semantics
- Serial successful mutations → defined
- Concurrent successful mutations → consistent but undefined
- Failed mutations → inconsistent

### Record Append Semantics
- At least once, atomically, at offset chosen by GFS
- Duplicates or padding may exist, but atomic

## Fault Tolerance

### Master Reliability
- Operation log replicated on multiple machines
- Checkpoints for fast recovery
- Shadow masters for read-only access

### Chunkserver Reliability
- Each chunk replicated (default 3x)
- Master detects failures via heartbeats
- Automatic re-replication when replica count drops
- Checksumming detects data corruption

### Data Integrity
- Chunks divided into 64KB blocks, each with 32-bit checksum
- Checksums verified on reads
- Idle chunkservers scan for corruption

## Scalability Considerations

### Master Scalability
- All metadata in memory
- Fast namespace operations
- Checkpoint and log replay for recovery
- Read-only replicas for increased read capacity

### Chunkserver Scalability
- Horizontally scalable
- Master load-balances new chunks
- Automatic re-balancing

### Network Efficiency
- Data flow separated from control flow
- Pipelined data transfer
- Direct client-to-chunkserver communication

## System Limitations

1. **Single Master**: Potential bottleneck for metadata operations
2. **Large Chunk Size**: Inefficient for small files
3. **No Random Writes**: Optimized for append/sequential access
4. **Relaxed Consistency**: Applications must handle eventual consistency
5. **No True POSIX**: Limited compatibility with standard file system tools

## Next Steps

- [Component Details](components.md) - Deep dive into each component
- [Data Flow](data-flow.md) - Detailed operation flows
- [Failure Detection](failure-detection.md) - φ Accrual algorithm details
- [Replication Strategy](replication.md) - How data is replicated and recovered
