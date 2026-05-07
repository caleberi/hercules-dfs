// Package common defines shared types, constants, and utilities used across
// all components of the distributed file system (master, chunk server, client).
package common

import "time"

// -----------------------------------------------------------------------------
// Primitive type aliases
// -----------------------------------------------------------------------------

// MutationType distinguishes the kind of write operation applied to a chunk.
type MutationType int

// Offset is a byte position within a chunk.
type Offset int64

// ChunkVersion is a monotonically increasing counter that tracks mutations on a chunk.
// It is used to detect stale replicas during replication and recovery.
type ChunkVersion int64

// ChunkHandle is a globally unique identifier assigned to a chunk by the master.
type ChunkHandle int64

// ChunkIndex is the zero-based position of a chunk within a file.
type ChunkIndex int64

// ServerAddr is the network address of a chunk server, e.g. "host:port".
type ServerAddr string

// Checksum is the integrity hash of a chunk's contents.
type Checksum string

// Path is an absolute path in the distributed file system namespace.
type Path string

// -----------------------------------------------------------------------------
// Error handling
// -----------------------------------------------------------------------------

// ErrorCode is a numeric code that categorises a known operation failure.
type ErrorCode int

const (
	Success               ErrorCode = iota // operation completed without error
	UnknownError                           // an unclassified or unexpected error occurred
	Timeout                                // the operation exceeded its deadline
	AppendExceedChunkSize                  // append data would overflow the chunk size limit
	WriteExceedChunkSize                   // write data would overflow the chunk size limit
	ReadEOF                                // read reached the end of the file
	NotAvailableForCopy                    // the chunk is not in a state that allows copying
	DownloadBufferMiss                     // the requested buffer ID was not found or has expired
	LeaseExpired                           // the chunk lease has passed its expiry time
)

// Error is a structured error that pairs a machine-readable ErrorCode with a
// human-readable description. It implements the built-in error interface.
//
// Memory layout (24 bytes, no padding):
//
//	Err  string    [16]  ← larger field first
//	Code ErrorCode  [8]
type Error struct {
	Err  string    // human-readable description of the error
	Code ErrorCode // machine-readable classification
}

// Error returns the human-readable error message, satisfying the error interface.
func (e Error) Error() string {
	return e.Err
}

// -----------------------------------------------------------------------------
// File system metadata
// -----------------------------------------------------------------------------

// PathInfo describes a single entry in the file system namespace, which may be
// either a regular file or a directory.
//
// Memory layout (56 bytes, 7-byte tail pad):
//
//	Path   string  [16]
//	Name   string  [16]
//	Length int64    [8]
//	Chunk  int64    [8]
//	IsDir  bool     [1]  ← bool moved to tail to avoid a 7-byte interior hole
//	_              [7]  (tail padding)
type PathInfo struct {
	Path   string // absolute path to the entry
	Name   string // base name of the entry
	Length int64  // total byte size (files only; 0 for directories)
	Chunk  int64  // number of chunks that compose the file
	IsDir  bool   // true if the entry is a directory
}

// FileInfo is a lightweight summary of a file or directory, used in directory
// listings and stat responses.
//
// Memory layout (24 bytes, 7-byte tail pad):
//
//	Length int64  [8]
//	Chunks int64  [8]
//	IsDir  bool   [1]  ← bool moved to tail to avoid a 7-byte interior hole
//	_             [7]  (tail padding)
type FileInfo struct {
	Length int64 // total byte size of the file
	Chunks int64 // number of chunks that compose the file
	IsDir  bool  // true if the entry is a directory
}

// -----------------------------------------------------------------------------
// Chunk metadata
// -----------------------------------------------------------------------------

// BufferId uniquely identifies a temporary download buffer entry by combining
// the chunk handle with the creation timestamp.
//
// Memory layout (16 bytes, no padding):
//
//	Handle    ChunkHandle (int64)  [8]
//	Timestamp int64                [8]
type BufferId struct {
	Handle    ChunkHandle // globally unique chunk identifier
	Timestamp int64       // Unix nanoseconds at buffer creation time
}

// Mutation records a single pending write operation that has been received but
// not yet committed to stable storage.
//
// Memory layout (40 bytes, no padding):
//
//	Data         []byte       [24]  ← slice header is largest
//	Offset       Offset        [8]
//	MutationType MutationType  [8]
type Mutation struct {
	Data         []byte       // the raw bytes to be written
	Offset       Offset       // the byte offset within the chunk where the write begins
	MutationType MutationType // the kind of write (append, write, pad)
}

// PersistedChunkInfo is the complete on-disk representation of a chunk replica.
// It is written to the chunk server's metadata file on each persist cycle.
//
// Memory layout (184 bytes, 6-byte tail pad):
//
//	24-byte fields (time.Time × 3, []string × 1)   [96]
//	16-byte fields (Checksum string)                [16]
//	 8-byte fields (int64 × 5, int × 3, map × 1)  [64]
//	 1-byte fields (bool × 2)                       [2]
//	_                                               [6]  (tail padding)
type PersistedChunkInfo struct {
	// Timestamps — 24 bytes each, placed first to avoid interior padding.
	CreationTime time.Time // wall-clock time when the chunk was first created
	LastModified time.Time // wall-clock time of the most recent mutation
	AccessTime   time.Time // wall-clock time of the most recent read

	Mutations map[ChunkVersion]Mutation // in-flight mutations not yet flushed to disk

	// Checksum — string header is 16 bytes.
	Checksum Checksum // integrity hash of the chunk data

	// In-flight mutations that have been applied but not yet flushed.
	// Stored as a slice of 24 bytes, grouped with the other 24-byte fields.
	StatusFlags []string // arbitrary diagnostic labels attached by the master

	// 8-byte scalar fields.
	Handle          ChunkHandle  // globally unique chunk identifier
	Version         ChunkVersion // current version; incremented on every mutation
	Length          Offset       // number of valid bytes stored in the chunk
	ChunkSize       int64        // physical size of the chunk file in bytes
	Replication     int          // current number of live replicas
	ServerStatus    int          // health status code of the owning chunk server
	MetadataVersion int          // version of the metadata schema used to encode this record

	// 1-byte fields last; the compiler adds 6 bytes of tail padding to align
	// the struct size to the next multiple of 8 for use in arrays/slices.
	Completed bool // true when the chunk has been sealed and is immutable
	Abandoned bool // true when the chunk has been marked for deletion
}

// -----------------------------------------------------------------------------
// Lease management
// -----------------------------------------------------------------------------

// Lease grants a primary chunk server the right to coordinate writes for a
// specific chunk for a bounded time window.
//
// Memory layout (80 bytes, 7-byte tail pad):
//
//	Expire      time.Time    [24]  ← 24-byte fields first
//	Secondaries []ServerAddr [24]
//	Primary     ServerAddr   [16]  ← then 16-byte
//	Handle      ChunkHandle   [8]  ← then 8-byte
//	InUse       bool          [1]  ← bool moved to tail
//	_                         [7]  (tail padding)
type Lease struct {
	Expire      time.Time    // absolute time at which the lease becomes invalid
	Primary     ServerAddr   // the chunk server currently holding the lease
	Secondaries []ServerAddr // replica servers that must apply the same mutations
	Handle      ChunkHandle  // the chunk this lease applies to
	InUse       bool         // true while at least one write is in progress
}

// IsExpired reports whether the lease has expired relative to time u.
func (ls *Lease) IsExpired(u time.Time) bool {
	return ls.Expire.Before(u)
}

// -----------------------------------------------------------------------------
// System telemetry
// -----------------------------------------------------------------------------

// MachineInfo holds network and proximity metadata for a chunk server, used by
// the master when selecting replicas for client reads.
//
// Memory layout (24 bytes, no padding):
//
//	Hostname               string  [16]  ← larger field first
//	RoundTripProximityTime float64  [8]
type MachineInfo struct {
	Hostname               string  // resolvable hostname or IP of the server
	RoundTripProximityTime float64 // estimated round-trip time to the client in milliseconds
}

// Memory captures a snapshot of Go runtime memory statistics, reported by each
// server during heartbeat cycles for observability purposes.
//
// Memory layout (32 bytes, no padding — all fields are float64):
//
//	Alloc      [8]
//	TotalAlloc [8]
//	Sys        [8]
//	NumGC      [8]
type Memory struct {
	Alloc      float64 // bytes currently allocated and in use by the heap
	TotalAlloc float64 // cumulative bytes allocated since process start
	Sys        float64 // total bytes of memory obtained from the OS
	NumGC      float64 // number of completed garbage collection cycles
}
