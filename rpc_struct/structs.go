package rpc_struct

import (
	"time"

	"github.com/caleberi/distributed-system/common"
	detector "github.com/caleberi/distributed-system/detector"
)

// HeartBeatArgs is sent from a chunkserver to the master as part of the regular
// heartbeat protocol. It reports health/telemetry and optionally requests lease
// extensions.
type HeartBeatArgs struct {
	// Address identifies the chunkserver sending this heartbeat.
	Address common.ServerAddr
	// MachineInfo reports resource utilization (CPU/mem/disk).
	MachineInfo common.MachineInfo
	// NetworkData carries timing information used for failure prediction.
	NetworkData detector.NetworkData
	// PendingLeases is the set of leases the chunkserver wants extended.
	PendingLeases []*common.Lease
	// ExtendLease indicates the server is requesting lease extension processing.
	ExtendLease bool
}

// HeartBeatReply is returned by the master to a chunkserver. It can carry lease
// extensions and garbage-collection instructions.
type HeartBeatReply struct {
	// LastHeartBeat is the master's timestamp for the heartbeat processing.
	LastHeartBeat time.Time
	// NetworkData is echoed back to complete round-trip measurement.
	NetworkData detector.NetworkData
	// LeaseExtensions are renewed leases granted by the master.
	LeaseExtensions []*common.Lease
	// Garbage lists chunk handles that should be deleted on the chunkserver.
	Garbage []common.ChunkHandle
}

// ChunkServerHeartBeatArgs is used by the master to probe a chunkserver and
// collect network timing data (independent from the regular chunk→master heartbeat).
type ChunkServerHeartBeatArgs struct {
	NetworkData detector.NetworkData
}

// ChunkServerHeartBeatReply is returned by the chunkserver to the master and
// echoes the network timing data.
type ChunkServerHeartBeatReply struct {
	NetworkData detector.NetworkData
}

// SysReportInfoArgs requests a system/chunk inventory report from a chunkserver.
type SysReportInfoArgs struct{}

// SysReportInfoReply returns a chunkserver's inventory and basic memory stats.
type SysReportInfoReply struct {
	Chunks []common.PersistedChunkInfo
	SysMem common.Memory
}

// CheckChunkVersionArgs carries the master's authoritative chunk Version for handle.
// The callee compares its local version: equal is OK; exactly one less triggers catch-up; else stale.
type CheckChunkVersionArgs struct {
	Handle  common.ChunkHandle
	Version common.ChunkVersion
}

// CheckChunkVersionReply: Stale means the replica does not match authoritative Version for quorum;
// implementations should avoid destructive local actions solely on this signal.
type CheckChunkVersionReply struct {
	Stale bool
}

// ReadChunkArgs requests a read from a chunk at Offset for Length bytes.
// Data may be provided as a preallocated buffer; implementations may ignore it.
type ReadChunkArgs struct {
	// Lease is optional and may be used to require "read-from-primary" semantics.
	Lease  *common.Lease
	Data   []byte
	Handle common.ChunkHandle
	Offset common.Offset
	Length int64
}

// ReadChunkReply returns the read payload (possibly shorter than requested) and
// an application-level status code.
type ReadChunkReply struct {
	Data      []byte
	Length    int64
	ErrorCode common.ErrorCode
}

// CreateChunkArgs requests that a chunkserver create storage for Handle.
type CreateChunkArgs struct {
	Handle common.ChunkHandle
}

// CreateChunkReply indicates the result of CreateChunk.
type CreateChunkReply struct {
	ErrorCode common.ErrorCode
}

// ForwardDataArgs is the first phase of write/append: stage Data into the
// server's download buffer and (optionally) forward it along a replica chain.
type ForwardDataArgs struct {
	Data             []byte
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
}

// ForwardDataReply indicates whether staging/forwarding succeeded.
type ForwardDataReply struct {
	ErrorCode common.ErrorCode
}

// WriteChunkArgs commits previously forwarded data (DownloadBufferId) into a
// chunk at Offset and replicates the mutation to Replicas.
type WriteChunkArgs struct {
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
	Offset           common.Offset
}

// WriteChunkReply returns the number of bytes written and an application-level
// status code.
type WriteChunkReply struct {
	Length    int
	ErrorCode common.ErrorCode
}

// ApplyMutationArgs asks a replica to apply a mutation that was previously
// staged via ForwardData.
type ApplyMutationArgs struct {
	MutationType     common.MutationType
	DownloadBufferId common.BufferId
	Offset           common.Offset
}

// ApplyMutationReply returns the mutation result on the replica.
type ApplyMutationReply struct {
	Length    int
	ErrorCode common.ErrorCode
}

// AppendChunkArgs commits previously forwarded data (DownloadBufferId) as an
// atomic append and replicates it to Replicas.
type AppendChunkArgs struct {
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
}

// AppendChunkReply returns the offset at which the append occurred and an
// application-level status code.
type AppendChunkReply struct {
	Offset    common.Offset
	ErrorCode common.ErrorCode
}

// GetSnapshotArgs requests that a chunkserver send a snapshot (full chunk
// contents) to Replicas (a single target address).
type GetSnapshotArgs struct {
	Replicas common.ServerAddr
	Handle   common.ChunkHandle
}

// GetSnapshotReply indicates whether snapshot transmission succeeded.
type GetSnapshotReply struct {
	ErrorCode common.ErrorCode
}

// ApplyCopyArgs asks a target chunkserver to install snapshot Data for Handle
// at Version.
type ApplyCopyArgs struct {
	Data    []byte
	Handle  common.ChunkHandle
	Version common.ChunkVersion
}

// ApplyCopyReply indicates whether snapshot installation succeeded.
type ApplyCopyReply struct {
	ErrorCode common.ErrorCode
}

// PrimaryAndSecondaryServersInfoReply returns the lease holder (primary) and
// the replica set for a chunk handle.
type PrimaryAndSecondaryServersInfoReply struct {
	Expire           time.Time
	Primary          common.ServerAddr
	SecondaryServers []common.ServerAddr
}

// PrimaryAndSecondaryServersInfoArg requests primary/secondary information for
// a chunk handle.
type PrimaryAndSecondaryServersInfoArg struct {
	Handle common.ChunkHandle
}

// GetChunkHandleReply returns the chunk handle for a given file path/index.
type GetChunkHandleReply struct {
	Handle common.ChunkHandle
}

// GetChunkHandleArgs requests the chunk handle for Path at Index.
type GetChunkHandleArgs struct {
	Path  common.Path
	Index common.ChunkIndex
}

// GetPathInfoArgs requests a recursive listing under Path.
// Handle is currently unused by the master implementation (legacy/placeholder).
type GetPathInfoArgs struct {
	Path   common.Path
	Handle common.ChunkHandle
}

// GetPathInfoReply returns namespace entries under the requested path.
type GetPathInfoReply struct {
	Entries []common.PathInfo
}

// MakeDirectoryArgs requests directory creation at Path.
type MakeDirectoryArgs struct {
	Path common.Path
}

// MakeDirectoryReply returns the result of the Mkdir operation.
type MakeDirectoryReply struct {
	ErrorCode common.ErrorCode
}

// RenameFileArgs requests renaming/moving Source to Target.
type RenameFileArgs struct {
	Source common.Path
	Target common.Path
}

// RenameFileReply returns the result of Rename.
type RenameFileReply struct {
	ErrorCode common.ErrorCode
}

// CreateFileArgs requests namespace creation of an empty file at Path.
type CreateFileArgs struct {
	Path common.Path
}

// CreateFileReply returns the result of CreateFile.
type CreateFileReply struct {
	ErrorCode common.ErrorCode
}

// DeleteFileArgs requests deletion of Path. If DeleteHandle is true, the master
// may additionally schedule associated chunk handles for garbage collection.
type DeleteFileArgs struct {
	Path         common.Path
	DeleteHandle bool
}

// DeleteFileReply returns the result of DeleteFile.
type DeleteFileReply struct {
	ErrorCode common.ErrorCode
}

// RemoveDirArgs requests directory removal at Path.
type RemoveDirArgs struct {
	Path common.Path
}

// RemoveDirReply returns the result of RemoveDir.
type RemoveDirReply struct {
	ErrorCode common.ErrorCode
}

// GetFileInfoArgs requests metadata for the node at Path.
type GetFileInfoArgs struct {
	Path common.Path
}

// GetFileInfoReply returns basic metadata for a namespace node.
type GetFileInfoReply struct {
	IsDir  bool
	Length int64
	Chunks int64
}

// RetrieveReplicasArgs requests locations of all replicas for Handle.
type RetrieveReplicasArgs struct {
	Handle common.ChunkHandle
}

// RetrieveReplicasReply returns replica locations for a chunk handle.
type RetrieveReplicasReply struct {
	Locations []common.ServerAddr
}

// GrantLeaseInfoArgs is pushed from master to a chunkserver to grant/refresh a lease.
type GrantLeaseInfoArgs struct {
	Expire      time.Time
	Primary     common.ServerAddr
	Secondaries []common.ServerAddr
	Handle      common.ChunkHandle
	InUse       bool
}

// GrantLeaseInfoReply returns the result of GrantLease.
type GrantLeaseInfoReply struct {
	ErrorCode common.ErrorCode
}

// UpdateFileMetadataArgs updates master-side namespace metadata after writes.
type UpdateFileMetadataArgs struct {
	Path   common.Path
	Length int64
	Chunks int64
}

// UpdateFileMetadataReply returns the result of UpdateFileMetadata.
type UpdateFileMetadataReply struct {
	ErrorCode common.ErrorCode
}
