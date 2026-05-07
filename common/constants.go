package common

import "time"

type Event string

type BranchInfo struct {
	Err   error
	Event Event
}

// Scheduled event types
const (
	HeartBeat         Event = "HeartBeat"
	GarbageCollection Event = "GarbageCollection"
	PersistMetaData   Event = "PersistMetaData"
	PersistOpsLog     Event = "PersistOpsLog"
	MasterHeartBeat   Event = "MasterHeartBeat"
	Archival          Event = "Archival"
	FailurePrediction Event = "FailurePrediction"
)

const (
	// namespace
	DeletedNamespaceFilePrefix string = "___deleted__"

	// archiving mechanism
	ArchivalDaySpan                    = 5
	ArchiveChunkInterval time.Duration = ArchivalDaySpan * 24 * time.Hour

	// failure detection
	FailureDetectorKeyExpiryTime time.Duration = 5 * time.Minute

	// chunk server
	HeartBeatInterval         time.Duration = 5 * time.Second
	GarbageCollectionInterval time.Duration = 5 * time.Minute
	PersistMetaDataInterval   time.Duration = 10 * time.Minute

	// chunk file
	ChunkMetaDataFileName = "chunk.server.meta"
	ChunkFileNameFormat   = "chunk-%v.chk"
	ChunkMaxSizeInMb      = 64
	ChunkMaxSizeInByte    = 64 << 20 // 1024 * 1024 * 64
	AppendMaxSizeInByte   = ChunkMaxSizeInByte / 4

	// download buffer
	DownloadBufferItemExpire time.Duration = 10 * time.Second
	DownloadBufferTick       time.Duration = 10 * time.Second

	// master server
	MasterMetaDataFileName                  = "master.server.meta"
	MasterPersistMetaInterval time.Duration = 15 * time.Hour
	ServerHealthCheckInterval time.Duration = 10 * time.Second
	ServerHealthCheckTimeout  time.Duration = 60 * time.Second
	FailurePredictionInterval time.Duration = 10 * time.Second

	// replication
	MinimumReplicationFactor = 3
	LeaseTimeout             = 120 * time.Second

	// filesystem
	FileMode = 0755
)

// Mutation flags
const (
	MutationAppend = (iota + 1) << 1
	MutationWrite
	MutationPad
)
