package common

import "time"

type MutationType int
type Offset int64
type ChunkVersion int64
type ChunkHandle int64
type ChunkIndex int64
type ServerAddr string
type Checksum string
type Event string
type Path string
type ErrorCode int

const (
	Success = iota
	UnknownError
	Timeout
	AppendExceedChunkSize
	WriteExceedChunkSize
	ReadEOF
	NotAvailableForCopy
	DownloadBufferMiss
	LeaseExpired
)

type Error struct {
	Code ErrorCode
	Err  string
}

func (e Error) Error() string {
	return e.Err
}

type PathInfo struct {
	Path   string
	Name   string
	IsDir  bool
	Length int64
	Chunk  int64
}

type BufferId struct {
	Handle    ChunkHandle
	Timestamp int64
}

type MachineInfo struct {
	RoundTripProximityTime float64
	Hostname               string
}

type Mutation struct {
	MutationType MutationType
	Data         []byte
	Offset       Offset
}

type PersistedChunkInfo struct {
	Handle               ChunkHandle
	Version              ChunkVersion
	Length               Offset
	Checksum             Checksum
	Mutations            map[ChunkVersion]Mutation
	Completed, Abandoned bool
	ChunkSize            int64
	CreationTime         time.Time
	LastModified         time.Time
	AccessTime           time.Time
	Replication          int
	ServerStatus         int
	MetadataVersion      int
	StatusFlags          []string
}
type Memory struct {
	Alloc, TotalAlloc, Sys, NumGC float64
}

type FileInfo struct {
	IsDir  bool
	Length int64
	Chunks int64
}

type Lease struct {
	Handle      ChunkHandle
	Expire      time.Time
	InUse       bool
	Primary     ServerAddr
	Secondaries []ServerAddr
}

func (ls *Lease) IsExpired(u time.Time) bool {
	return ls.Expire.Before(u)
}
