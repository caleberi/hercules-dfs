// Package archivemanager provides compression and decompression services for the Hercules distributed file system.
// It manages concurrent compression/decompression operations using a worker pool pattern and supports
// gzip compression with configurable worker counts.
package archivemanager

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/caleberi/distributed-system/common"
	filesystem "github.com/caleberi/distributed-system/file_system"
	"github.com/rs/zerolog/log"
)

const (
	// zipExt is the file extension for compressed files
	zipExt = ".gz"

	// defaultChannelBuffer is the buffer size for task and result channels
	defaultChannelBuffer = 10

	// defaultSubmitTimeout is the timeout for submitting tasks
	defaultSubmitTimeout = 5 * time.Second

	// defaultShutdownTimeout is maximum time to wait during shutdown
	defaultShutdownTimeout = 10 * time.Second
)

// ResultInfo contains the result of a compression or decompression operation.
type ResultInfo struct {
	Path common.Path // Resulting file path after operation
	Err  error       // Error if operation failed
}

// CompressPipeline manages compression tasks and results.
type CompressPipeline struct {
	Task   chan common.Path // Channel for submitting compression tasks
	Result chan ResultInfo  // Channel for receiving compression results
}

// DecompressPipeline manages decompression tasks and results.
type DecompressPipeline struct {
	Task   chan common.Path // Channel for submitting decompression tasks
	Result chan ResultInfo  // Channel for receiving decompression results
}

// ArchiverManager manages concurrent compression and decompression operations.
// It uses a worker pool pattern to process files efficiently.
type ArchiverManager struct {
	mu                 sync.RWMutex       // Protects isClosed flag
	CompressPipeline   CompressPipeline   // Pipeline for compression operations
	DecompressPipeline DecompressPipeline // Pipeline for decompression operations
	fileSystem         *filesystem.FileSystem
	ctx                context.Context
	cancel             context.CancelFunc
	wg                 sync.WaitGroup
	isClosed           bool // Indicates if archiver has been closed
}

// NewArchiver creates a new ArchiverManager with the specified number of workers.
// Workers are split evenly between compression and decompression tasks.
//
// Parameters:
//   - fileSystem: The filesystem to operate on
//   - numWorkers: Total number of workers (split between compress/decompress)
//
// Returns a configured and running ArchiverManager.
func NewArchiver(ctx context.Context, fileSystem *filesystem.FileSystem, numWorkers int) *ArchiverManager {
	if numWorkers < 2 {
		numWorkers = 2
	}

	ctx, cancel := context.WithCancel(ctx)
	archiver := &ArchiverManager{
		CompressPipeline: CompressPipeline{
			Task:   make(chan common.Path, defaultChannelBuffer),
			Result: make(chan ResultInfo, defaultChannelBuffer),
		},
		DecompressPipeline: DecompressPipeline{
			Task:   make(chan common.Path, defaultChannelBuffer),
			Result: make(chan ResultInfo, defaultChannelBuffer),
		},
		fileSystem: fileSystem,
		ctx:        ctx,
		cancel:     cancel,
		isClosed:   false,
	}
	archiver.startWorkers(numWorkers)
	log.Info().Int("workers", numWorkers).Msg("ArchiverManager started")
	return archiver
}

func (ac *ArchiverManager) startWorkers(numWorkers int) {
	compressWorkers := numWorkers / 2
	if compressWorkers <= 0 {
		compressWorkers = 1
	}
	decompressWorkers := numWorkers - compressWorkers
	if decompressWorkers <= 0 {
		decompressWorkers = 1
	}

	ac.wg.Add(compressWorkers)
	for i := 0; i < compressWorkers; i++ {
		go ac.compressWorker()
	}

	ac.wg.Add(decompressWorkers)
	for i := 0; i < decompressWorkers; i++ {
		go ac.decompressWorker()
	}
}

func (ac *ArchiverManager) compressWorker() {
	defer ac.wg.Done()
	for {
		select {
		case <-ac.ctx.Done():
			return
		case p, ok := <-ac.CompressPipeline.Task:
			if !ok {
				return
			}
			np, err := ac.compress(p)
			select {
			case ac.CompressPipeline.Result <- ResultInfo{Path: common.Path(np), Err: err}:
			case <-ac.ctx.Done():
				return
			}
		}
	}
}

func (ac *ArchiverManager) decompressWorker() {
	defer ac.wg.Done()
	for {
		select {
		case <-ac.ctx.Done():
			return
		case p, ok := <-ac.DecompressPipeline.Task:
			if !ok {
				return
			}
			np, err := ac.decompress(p)
			select {
			case ac.DecompressPipeline.Result <- ResultInfo{Path: common.Path(np), Err: err}:
			case <-ac.ctx.Done():
				return
			}
		}
	}
}

// decompress decompresses a gzip file and removes the compressed source file on success.
// It creates a new file without the .gz extension containing the decompressed data.
//
// Returns the path to the decompressed file or an error if decompression fails.
func (ac *ArchiverManager) decompress(path common.Path) (string, error) {
	if !strings.HasSuffix(string(path), zipExt) {
		return "", fmt.Errorf("file %s does not have .gz extension", path)
	}

	sourceFile, err := ac.fileSystem.GetFile(string(path), os.O_RDONLY, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to open compressed file %s: %w", path, err)
	}
	defer sourceFile.Close()

	decompressor, err := gzip.NewReader(sourceFile)
	if err != nil {
		return "", fmt.Errorf("failed to create gzip reader for %s: %w", path, err)
	}
	defer decompressor.Close()

	uncompressedFilePath, err := removeGzipExtension(string(path))
	if err != nil {
		return "", fmt.Errorf("failed to determine output path for %s: %w", path, err)
	}

	err = ac.fileSystem.CreateFile(uncompressedFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to create decompressed file %s: %w", uncompressedFilePath, err)
	}

	decompressedFile, err := ac.fileSystem.GetFile(
		uncompressedFilePath, os.O_RDWR|os.O_TRUNC, 0644)
	if err != nil {
		ac.fileSystem.RemoveFile(uncompressedFilePath)
		return "", fmt.Errorf("failed to open decompressed file %s: %w", uncompressedFilePath, err)
	}
	defer decompressedFile.Close()

	_, err = io.Copy(decompressedFile, decompressor)
	if err != nil {
		ac.fileSystem.RemoveFile(uncompressedFilePath) // Clean up corrupted file, NOT source
		return "", fmt.Errorf("failed to decompress data from %s: %w", path, err)
	}

	stat, err := decompressedFile.Stat()
	if err != nil {
		ac.fileSystem.RemoveFile(uncompressedFilePath)
		return "", fmt.Errorf("failed to stat decompressed file %s: %w", uncompressedFilePath, err)
	}
	if stat.Size() == 0 {
		ac.fileSystem.RemoveFile(uncompressedFilePath)
		return "", fmt.Errorf("decompressed file %s is empty", uncompressedFilePath)
	}

	if err := ac.fileSystem.RemoveFile(string(path)); err != nil {
		log.Warn().Err(err).Str("path", string(path)).Msg("Failed to remove compressed source file")
	}

	log.Debug().Str("source", string(path)).Str("dest", uncompressedFilePath).Msg("Decompression completed")
	return uncompressedFilePath, nil
}

// compress compresses a file using gzip and removes the uncompressed source file on success.
// It creates a new file with a .gz extension containing the compressed data.
//
// Returns the path to the compressed file or an error if compression fails.
func (ac *ArchiverManager) compress(path common.Path) (string, error) {

	sourceFile, err := ac.fileSystem.GetFile(string(path), os.O_RDONLY, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to open source file %s: %w", path, err)
	}
	defer sourceFile.Close()

	destinationPath := string(path) + zipExt

	_, err = ac.fileSystem.GetStat(destinationPath)
	if err != nil {
		if os.IsNotExist(err) {
			if err := ac.fileSystem.CreateFile(destinationPath); err != nil {
				return "", fmt.Errorf("failed to create compressed file %s: %w", destinationPath, err)
			}
		} else {
			return "", fmt.Errorf("failed to stat destination file %s: %w", destinationPath, err)
		}
	}

	compressedFile, err := ac.fileSystem.GetFile(
		destinationPath, os.O_RDWR|os.O_TRUNC, 0644)
	if err != nil {
		ac.fileSystem.RemoveFile(destinationPath)
		return "", fmt.Errorf("failed to open compressed file %s: %w", destinationPath, err)
	}
	defer compressedFile.Close()

	compressor := gzip.NewWriter(compressedFile)

	_, err = io.Copy(compressor, sourceFile)
	if err != nil {
		compressor.Close()
		ac.fileSystem.RemoveFile(destinationPath)
		return "", fmt.Errorf("failed to compress data from %s: %w", path, err)
	}

	if err := compressor.Close(); err != nil {
		ac.fileSystem.RemoveFile(destinationPath)
		return "", fmt.Errorf("failed to finalize compression for %s: %w", path, err)
	}

	stat, err := compressedFile.Stat()
	if err != nil {
		ac.fileSystem.RemoveFile(destinationPath)
		return "", fmt.Errorf("failed to verify compressed file %s: %w", destinationPath, err)
	}
	if stat.Size() == 0 {
		ac.fileSystem.RemoveFile(destinationPath)
		return "", fmt.Errorf("compressed file %s is empty", destinationPath)
	}

	if err := ac.fileSystem.RemoveFile(string(path)); err != nil {
		log.Warn().Err(err).Str("path", string(path)).Msg("Failed to remove source file after compression")
	}

	log.Debug().Str("source", string(path)).Str("dest", destinationPath).Int64("size", stat.Size()).Msg("Compression completed")
	return destinationPath, nil
}

// Close gracefully shuts down the ArchiverManager.
// It waits for all pending tasks to complete or times out after defaultShutdownTimeout.
// This method is safe to call multiple times.
func (ac *ArchiverManager) Close() {
	ac.mu.Lock()
	if ac.isClosed {
		ac.mu.Unlock()
		log.Debug().Msg("ArchiverManager already closed")
		return
	}
	ac.isClosed = true
	ac.mu.Unlock()

	log.Info().Msg("Shutting down ArchiverManager")

	// Cancel context to signal workers to stop
	ac.cancel()

	// Close task channels to prevent new submissions
	close(ac.CompressPipeline.Task)
	close(ac.DecompressPipeline.Task)

	// Wait for all workers to finish with timeout
	done := make(chan struct{})
	go func() {
		ac.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Info().Msg("All archiver workers completed")
	case <-time.After(defaultShutdownTimeout):
		log.Warn().Dur("timeout", defaultShutdownTimeout).Msg("ArchiverManager shutdown timed out")
	}

	close(ac.CompressPipeline.Result)
	close(ac.DecompressPipeline.Result)

	log.Info().Msg("ArchiverManager shutdown complete")
}

// SubmitCompress submits a file for compression.
// The file at the given path will be compressed asynchronously and results
// can be read from CompressPipeline.Result channel.
//
// SubmitCompress submits a file for compression.
// The file at the given path will be compressed asynchronously and results
// can be read from CompressPipeline.Result channel.
//
// Returns an error if the archiver is closed, shutting down, or if submission times out.
func (ac *ArchiverManager) SubmitCompress(path common.Path) error {
	ac.mu.RLock()
	if ac.isClosed {
		ac.mu.RUnlock()
		return fmt.Errorf("archiver has been closed")
	}
	ac.mu.RUnlock()

	select {
	case <-ac.ctx.Done():
		return fmt.Errorf("archiver is shutting down")
	case ac.CompressPipeline.Task <- path:
		log.Debug().Str("path", string(path)).Msg("Compression task submitted")
		return nil
	case <-time.After(defaultSubmitTimeout):
		return fmt.Errorf("timeout submitting compression task for %s after %v", path, defaultSubmitTimeout)
	}
}

// SubmitDecompress submits a file for decompression.
// The file at the given path will be decompressed asynchronously and results
// can be read from DecompressPipeline.Result channel.
//
// Returns an error if the archiver is closed, shutting down, or if submission times out.
func (ac *ArchiverManager) SubmitDecompress(path common.Path) error {
	ac.mu.RLock()
	if ac.isClosed {
		ac.mu.RUnlock()
		return fmt.Errorf("archiver has been closed")
	}
	ac.mu.RUnlock()

	select {
	case <-ac.ctx.Done():
		return fmt.Errorf("archiver is shutting down")
	case ac.DecompressPipeline.Task <- path:
		log.Debug().Str("path", string(path)).Msg("Decompression task submitted")
		return nil
	case <-time.After(defaultSubmitTimeout):
		return fmt.Errorf("timeout submitting decompression task for %s after %v", path, defaultSubmitTimeout)
	}
}

// removeGzipExtension removes the .gz extension from a file path.
// Returns an error if the path doesn't have a .gz extension.
func removeGzipExtension(path string) (string, error) {
	if !strings.HasSuffix(path, zipExt) {
		return "", fmt.Errorf("path %s does not have .gz extension", path)
	}
	return strings.TrimSuffix(path, zipExt), nil
}
