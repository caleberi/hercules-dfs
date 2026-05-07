package rpc_struct

import (
	"time"

	"github.com/caleberi/distributed-system/common"
	detector "github.com/caleberi/distributed-system/detector"
)

type HeartBeatArgs struct {
	NetworkData   detector.NetworkData
	Address       common.ServerAddr
	PendingLeases []*common.Lease
	MachineInfo   common.MachineInfo
	ExtendLease   bool
}
type HeartBeatReply struct {
	NetworkData     detector.NetworkData
	LastHeartBeat   time.Time
	LeaseExtensions []*common.Lease
	Garbage         []common.ChunkHandle
}

type ChunkServerHeartBeatArgs struct {
	NetworkData detector.NetworkData
}

type ChunkServerHeartBeatReply struct {
	NetworkData detector.NetworkData
}

type SysReportInfoArgs struct{}
type SysReportInfoReply struct {
	Chunks []common.PersistedChunkInfo
	SysMem common.Memory
}

type CheckChunkVersionArgs struct {
	Handle  common.ChunkHandle
	Version common.ChunkVersion
}
type CheckChunkVersionReply struct {
	Stale bool
}

type ReadChunkArgs struct {
	Lease  *common.Lease
	Data   []byte
	Offset common.Offset
	Length int64
	Handle common.ChunkHandle
}

type ReadChunkReply struct {
	Data      []byte
	Length    int64
	ErrorCode common.ErrorCode
}

type CreateChunkArgs struct {
	Handle common.ChunkHandle
}

type CreateChunkReply struct {
	ErrorCode common.ErrorCode
}

type ForwardDataArgs struct {
	Data             []byte
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
}

type ForwardDataReply struct {
	ErrorCode common.ErrorCode
}

type WriteChunkArgs struct {
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
	Offset           common.Offset
}

type WriteChunkReply struct {
	Length    int
	ErrorCode common.ErrorCode
}

type ApplyMutationArgs struct {
	MutationType     common.MutationType
	DownloadBufferId common.BufferId
	Offset           common.Offset
}

type ApplyMutationReply struct {
	Length    int
	ErrorCode common.ErrorCode
}

type AppendChunkArgs struct {
	Replicas         []common.ServerAddr
	DownloadBufferId common.BufferId
}

type AppendChunkReply struct {
	Offset    common.Offset
	ErrorCode common.ErrorCode
}

type GetSnapshotArgs struct {
	Replicas common.ServerAddr
	Handle   common.ChunkHandle
}

type GetSnapshotReply struct {
	ErrorCode common.ErrorCode
}

type ApplyCopyArgs struct {
	Data    []byte
	Handle  common.ChunkHandle
	Version common.ChunkVersion
}
type ApplyCopyReply struct {
	ErrorCode common.ErrorCode
}

type PrimaryAndSecondaryServersInfoReply struct {
	Expire           time.Time
	Primary          common.ServerAddr
	SecondaryServers []common.ServerAddr
}

type PrimaryAndSecondaryServersInfoArg struct {
	Handle common.ChunkHandle
}

type GetChunkHandleReply struct {
	Handle common.ChunkHandle
}

type GetChunkHandleArgs struct {
	Path  common.Path
	Index common.ChunkIndex
}

type GetPathInfoArgs struct {
	Path   common.Path
	Handle common.ChunkHandle
}

type GetPathInfoReply struct {
	Entries []common.PathInfo
}

type MakeDirectoryArgs struct {
	Path common.Path
}

type MakeDirectoryReply struct {
	ErrorCode common.ErrorCode
}

type RenameFileArgs struct {
	Source common.Path
	Target common.Path
}

type RenameFileReply struct {
	ErrorCode common.ErrorCode
}

type CreateFileArgs struct {
	Path common.Path
}
type CreateFileReply struct {
	ErrorCode common.ErrorCode
}

type DeleteFileArgs struct {
	Path         common.Path
	DeleteHandle bool
}

type DeleteFileReply struct {
	ErrorCode common.ErrorCode
}

type RemoveDirArgs struct {
	Path common.Path
}

type RemoveDirReply struct {
	ErrorCode common.ErrorCode
}

type GetFileInfoArgs struct {
	Path common.Path
}

type GetFileInfoReply struct {
	IsDir  bool
	Length int64
	Chunks int64
}

type RetrieveReplicasArgs struct {
	Handle common.ChunkHandle
}
type RetrieveReplicasReply struct {
	Locations []common.ServerAddr
}

type GrantLeaseInfoArgs struct {
	Expire      time.Time
	Primary     common.ServerAddr
	Secondaries []common.ServerAddr
	Handle      common.ChunkHandle
	InUse       bool
}

type GrantLeaseInfoReply struct {
	ErrorCode common.ErrorCode
}

type UpdateFileMetadataArgs struct {
	Path   common.Path
	Length int64
	Chunks int64
}

type UpdateFileMetadataReply struct {
	ErrorCode common.ErrorCode
}
