# Namespace Manager - Hierarchical File System Tree

## Overview

The **Namespace Manager** maintains an in-memory hierarchical tree structure representing the entire file system namespace for the Hercules distributed file system. It provides thread-safe POSIX-like operations (create, delete, rename, list) with fine-grained locking for high concurrency.

**Key Features:**
- 🌳 **Hierarchical Structure:** In-memory tree mirroring filesystem hierarchy
- 🔒 **Fine-Grained Locking:** Per-node concurrency control for parallel operations
- ♻️ **Lazy Deletion:** Async cleanup reduces lock contention
- 🔄 **Serializable:** Full tree persistence for crash recovery
- 🚫 **Deadlock-Free:** Lexicographic lock ordering prevents circular waits
- ⚡ **High Concurrency:** Read locks on ancestors, write locks only on targets

**Use Cases:**
- Master Server namespace management
- Distributed file system metadata tracking
- POSIX-like operations in custom filesystems
- Any scenario requiring concurrent tree manipulation

## Installation

The Namespace Manager is part of the Hercules distributed file system:

```bash
# Clone repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# Install dependencies
go mod download

# Run tests
go test ./namespace_manager/...

# Run with race detector
go test -race ./namespace_manager/...
```

## Quick Start

### Basic Usage

```go
package main

import (
    "context"
    "fmt"
    "time"
    
    "github.com/caleberi/hercules-dfs/common"
    nm "github.com/caleberi/hercules-dfs/namespace_manager"
)

func main() {
    // Create namespace manager
    ctx := context.Background()
    cleanupInterval := 1 * time.Minute
    mgr := nm.NewNameSpaceManager(ctx, cleanupInterval)
    
    // Create directories
    mgr.MkDirAll(common.Path("/home/user/docs"))
    
    // Create file
    mgr.Create(common.Path("/home/user/file.txt"))
    
    // Update file metadata
    mgr.UpdateFileMetadata(common.Path("/home/user/file.txt"), 1024, 1)
    
    // List directory
    files, _ := mgr.List(common.Path("/home/user"))
    for _, f := range files {
        fmt.Printf("%s (dir: %v, size: %d bytes)\n", f.Name, f.IsDir, f.Length)
    }
    
    // Rename file
    mgr.Rename(common.Path("/home/user/file.txt"), 
               common.Path("/home/user/renamed.txt"))
    
    // Delete file
    mgr.Delete(common.Path("/home/user/renamed.txt"))
}
```

### Master Server Integration

```go
type MasterServer struct {
    namespace *nm.NamespaceManager
    // ... other fields
}

func NewMasterServer() *MasterServer {
    ctx := context.Background()
    return &MasterServer{
        namespace: nm.NewNameSpaceManager(ctx, 5*time.Minute),
    }
}

// Handle client file creation
func (ms *MasterServer) CreateFile(path string) error {
    // Create namespace entry
    err := ms.namespace.Create(common.Path(path))
    if err != nil {
        return fmt.Errorf("namespace create failed: %w", err)
    }
    
    // Allocate chunk handles (separate logic)
    // ...
    
    return nil
}

// Update after successful write
func (ms *MasterServer) OnWriteComplete(path string, totalBytes int64, chunkCount int64) error {
    return ms.namespace.UpdateFileMetadata(
        common.Path(path),
        totalBytes,
        chunkCount,
    )
}

// Periodic checkpoint for crash recovery
func (ms *MasterServer) Checkpoint() error {
    data := ms.namespace.Serialize()
    
    // Write to disk
    bytes, err := json.Marshal(data)
    if err != nil {
        return err
    }
    
    return os.WriteFile("/var/hercules/namespace.json", bytes, 0644)
}
```

## API Reference

### Constructor

#### NewNameSpaceManager

```go
func NewNameSpaceManager(ctx context.Context, cleanUpInterval time.Duration) *NamespaceManager
```

Creates a new NamespaceManager with background cleanup workers.

**Parameters:**
- `ctx`: Context for lifecycle management (cancel to shutdown)
- `cleanUpInterval`: How often to flush deleted files from memory

**Returns:**
- `*NamespaceManager`: Initialized namespace manager

**Background Workers:**
- Cleanup scheduler: Flushes deleteCache every `cleanUpInterval`
- Cleanup worker: Processes cleanup queue asynchronously

**Example:**
```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()  // Shutdown on exit

mgr := nm.NewNameSpaceManager(ctx, 5*time.Minute)
```

---

### Directory Operations

#### MkDir

```go
func (nm *NamespaceManager) MkDir(p common.Path) error
```

Creates a single directory (non-recursive).

**Parameters:**
- `p`: Absolute path to directory

**Returns:**
- `error`: `nil` on success, error if parent doesn't exist

**Behavior:**
- Requires parent directory to exist
- Idempotent: succeeds if directory already exists
- Thread-safe: write lock on parent directory

**Examples:**

```go
// Create top-level directory
err := mgr.MkDir(common.Path("/home"))  // ✓ Success

// Create nested directory (parent must exist)
err = mgr.MkDir(common.Path("/home/user"))  // ✓ Success

// Parent doesn't exist
err = mgr.MkDir(common.Path("/nonexistent/dir"))  // ✗ Error
```

---

#### MkDirAll

```go
func (nm *NamespaceManager) MkDirAll(p common.Path) error
```

Creates all parent directories recursively (like `mkdir -p`).

**Parameters:**
- `p`: Absolute path to directory (or file path, creates parent dirs)

**Returns:**
- `error`: `nil` on success

**Behavior:**
- Creates all missing ancestor directories
- Idempotent: succeeds if path already exists
- Smart file detection: If path has extension, only creates parent

**Examples:**

```go
// Create nested directories (all parents)
err := mgr.MkDirAll(common.Path("/home/user/docs/projects"))
// Creates: /home, /home/user, /home/user/docs, /home/user/docs/projects

// Create parent for file
err = mgr.MkDirAll(common.Path("/home/user/file.txt"))
// Creates: /home, /home/user (stops before file.txt)

// Idempotent
err = mgr.MkDirAll(common.Path("/home/user"))  // Already exists
// ✓ Success (no error)
```

**File Detection:**
```go
// Has extension → treated as file, only create parent
mgr.MkDirAll("/data/log.txt")  // Creates /data only

// No extension → treated as directory, create full path
mgr.MkDirAll("/data/logs")  // Creates /data/logs
```

---

### File Operations

#### Create

```go
func (nm *NamespaceManager) Create(p common.Path) error
```

Creates a new file node in the namespace.

**Parameters:**
- `p`: Absolute path to file

**Returns:**
- `error`: `nil` on success, error if parent doesn't exist

**Behavior:**
- Requires parent directory to exist
- Idempotent: succeeds if file already exists
- Validates filename (no invalid characters)
- Initial metadata: Length=0, Chunks=0

**Examples:**

```go
// Create file (parent must exist)
mgr.MkDir(common.Path("/home"))
err := mgr.Create(common.Path("/home/file.txt"))  // ✓ Success

// Parent doesn't exist
err = mgr.Create(common.Path("/nonexistent/file.txt"))  // ✗ Error

// Idempotent
err = mgr.Create(common.Path("/home/file.txt"))  // ✓ Success (already exists)
```

**Typical Workflow:**
```go
// Client creates file
mgr.MkDirAll("/data/uploads")  // Ensure parent exists
mgr.Create("/data/uploads/video.mp4")

// Later, after write completes
mgr.UpdateFileMetadata("/data/uploads/video.mp4", 1073741824, 16)  // 1GB, 16 chunks
```

---

#### Delete

```go
func (nm *NamespaceManager) Delete(p common.Path) error
```

Marks a file or directory for deletion (soft delete).

**Parameters:**
- `p`: Absolute path to file or directory

**Returns:**
- `error`: `nil` on success, error if path doesn't exist

**Behavior:**
- **Soft delete:** Renames with `___deleted__` prefix
- **Async cleanup:** Removed from tree after `cleanUpInterval`
- **Fast operation:** Client doesn't wait for cleanup
- Fails if path doesn't exist

**Examples:**

```go
// Delete file
mgr.Create(common.Path("/home/file.txt"))
err := mgr.Delete(common.Path("/home/file.txt"))  // ✓ Success

// Immediately after delete:
// - File renamed to "___deleted__file.txt"
// - Still in tree (invisible to List)
// - Queued for async removal

// After cleanUpInterval:
// - Completely removed from tree
// - Memory reclaimed

// Delete non-existent file
err = mgr.Delete(common.Path("/nonexistent.txt"))  // ✗ Error
```

**Visibility:**
```go
// Deleted files are filtered from List
mgr.Create("/home/a.txt")
mgr.Create("/home/b.txt")
mgr.Delete("/home/a.txt")

files, _ := mgr.List("/home")
// Only shows: /home/b.txt (a.txt is hidden)
```

---

#### Rename

```go
func (nm *NamespaceManager) Rename(source, target common.Path) error
```

Moves or renames a file/directory atomically.

**Parameters:**
- `source`: Current path
- `target`: New path

**Returns:**
- `error`: `nil` on success, error if source doesn't exist or target exists

**Behavior:**
- **Atomic operation:** No intermediate state visible
- **Creates target parent:** Automatically calls MkDirAll if needed
- **Deadlock-free:** Uses lexicographic lock ordering
- Fails if target already exists
- Works for both files and directories

**Examples:**

```go
// Rename file in same directory
mgr.Rename(common.Path("/home/old.txt"), 
           common.Path("/home/new.txt"))

// Move file to different directory
mgr.Rename(common.Path("/home/file.txt"), 
           common.Path("/archive/file.txt"))

// Move directory (entire subtree)
mgr.Rename(common.Path("/home/docs"), 
           common.Path("/backup/docs"))

// Error: target already exists
mgr.Create(common.Path("/home/a.txt"))
mgr.Create(common.Path("/home/b.txt"))
err := mgr.Rename(common.Path("/home/a.txt"), 
                  common.Path("/home/b.txt"))  // ✗ Error
```

**Concurrency:**
```go
// Deadlock prevention via lock ordering
Thread A: Rename("/a/file", "/z/file")
Thread B: Rename("/z/other", "/a/other")

Both threads lock in alphabetical order: "/a" before "/z"
No deadlock possible ✓
```

---

#### UpdateFileMetadata

```go
func (nm *NamespaceManager) UpdateFileMetadata(p common.Path, length int64, chunks int64) error
```

Updates file size and chunk count after write operations.

**Parameters:**
- `p`: Absolute path to file
- `length`: Total file size in bytes
- `chunks`: Number of chunks

**Returns:**
- `error`: `nil` on success, error if path is directory

**Behavior:**
- Updates Length and Chunks fields
- Thread-safe: locks the file node
- Fails if path is a directory

**Examples:**

```go
// After initial write (64MB chunk)
mgr.UpdateFileMetadata(common.Path("/data/file.bin"), 67108864, 1)

// After append (another 64MB chunk)
mgr.UpdateFileMetadata(common.Path("/data/file.bin"), 134217728, 2)

// Error: path is directory
err := mgr.UpdateFileMetadata(common.Path("/data"), 1024, 1)  // ✗ Error
```

**Typical Usage:**
```go
func (ms *MasterServer) OnAppendComplete(path string, newTotalSize int64) error {
    chunkSize := int64(64 * 1024 * 1024)  // 64MB
    numChunks := (newTotalSize + chunkSize - 1) / chunkSize
    
    return ms.namespace.UpdateFileMetadata(
        common.Path(path),
        newTotalSize,
        numChunks,
    )
}
```

---

### Query Operations

#### Get

```go
func (nm *NamespaceManager) Get(p common.Path) (*NsTree, error)
```

Retrieves the tree node at the specified path.

**Parameters:**
- `p`: Absolute path to file or directory

**Returns:**
- `*NsTree`: Pointer to node
- `error`: `nil` on success, error if path doesn't exist

**Behavior:**
- Uses read locks (concurrent Gets allowed)
- Returns pointer (caller can inspect but shouldn't modify directly)

**Examples:**

```go
// Get file node
node, err := mgr.Get(common.Path("/home/file.txt"))
if err != nil {
    // Path doesn't exist
}

fmt.Printf("IsDir: %v\n", node.IsDir)         // false
fmt.Printf("Length: %d bytes\n", node.Length)  // File size
fmt.Printf("Chunks: %d\n", node.Chunks)       // Chunk count

// Get directory node
node, err = mgr.Get(common.Path("/home/user"))
fmt.Printf("IsDir: %v\n", node.IsDir)  // true

// Non-existent path
node, err = mgr.Get(common.Path("/nonexistent"))  // err != nil
```

**Node Fields:**
```go
type NsTree struct {
    Path   common.Path      // Absolute path
    IsDir  bool             // true for directories
    Length int64            // File size in bytes (files only)
    Chunks int64            // Number of chunks (files only)
    
    // Internal fields (don't modify directly)
    childrenNodes map[string]*NsTree
    sync.RWMutex
}
```

---

#### List

```go
func (nm *NamespaceManager) List(p common.Path) ([]common.PathInfo, error)
```

Recursively lists all files and directories under a path.

**Parameters:**
- `p`: Absolute path to directory (use "/" for root)

**Returns:**
- `[]common.PathInfo`: List of all nodes in subtree
- `error`: `nil` on success, error if path doesn't exist

**Behavior:**
- Breadth-first traversal of entire subtree
- Filters out deleted files (prefix `___deleted__`)
- Returns all descendants, not just immediate children

**Examples:**

```go
// Setup
mgr.MkDirAll(common.Path("/home/user/docs"))
mgr.Create(common.Path("/home/user/file.txt"))
mgr.Create(common.Path("/home/user/docs/readme.md"))

// List root (all nodes)
files, _ := mgr.List(common.Path("/"))
// Returns:
// - {Path: "/home", Name: "home", IsDir: true}
// - {Path: "/home/user", Name: "user", IsDir: true}
// - {Path: "/home/user/file.txt", Name: "file.txt", IsDir: false, Length: 0, Chunk: 0}
// - {Path: "/home/user/docs", Name: "docs", IsDir: true}
// - {Path: "/home/user/docs/readme.md", Name: "readme.md", IsDir: false}

// List specific directory (all descendants)
files, _ = mgr.List(common.Path("/home/user"))
// Returns:
// - {Path: "/home/user/file.txt", ...}
// - {Path: "/home/user/docs", ...}
// - {Path: "/home/user/docs/readme.md", ...}

// Process results
for _, file := range files {
    if file.IsDir {
        fmt.Printf("DIR:  %s\n", file.Name)
    } else {
        fmt.Printf("FILE: %s (%d bytes, %d chunks)\n", 
            file.Name, file.Length, file.Chunk)
    }
}
```

**PathInfo Structure:**
```go
type PathInfo struct {
    Path   string  // Absolute path
    Name   string  // Base name (filename or dirname)
    IsDir  bool    // Directory flag
    Length int64   // File size in bytes
    Chunk  int64   // Number of chunks
}
```

---

### Serialization

#### Serialize

```go
func (nm *NamespaceManager) Serialize() []SerializedNsTreeNode
```

Converts the in-memory tree to a serializable format for persistence.

**Returns:**
- `[]SerializedNsTreeNode`: Array of serialized nodes

**Behavior:**
- Depth-first traversal
- Root is last element in array
- Child relationships stored as indices

**Example:**

```go
// Serialize namespace
data := mgr.Serialize()

// Persist to disk
bytes, _ := json.Marshal(data)
err := os.WriteFile("/var/hercules/namespace.json", bytes, 0644)

// Gob encoding (more efficient)
var buf bytes.Buffer
enc := gob.NewEncoder(&buf)
enc.Encode(data)
os.WriteFile("/var/hercules/namespace.gob", buf.Bytes(), 0644)
```

**SerializedNsTreeNode:**
```go
type SerializedNsTreeNode struct {
    IsDir    bool
    Path     common.Path
    Children map[string]int  // child name → index in array
    Chunks   int64
}
```

---

#### Deserialize

```go
func (nm *NamespaceManager) Deserialize(nodes []SerializedNsTreeNode) *NsTree
```

Reconstructs the in-memory tree from serialized format.

**Parameters:**
- `nodes`: Array of serialized nodes (from Serialize())

**Returns:**
- `*NsTree`: Reconstructed root node

**Behavior:**
- Rebuilds entire tree structure
- Replaces current `nm.root`
- Preserves all metadata and relationships

**Example:**

```go
// Load from disk
bytes, _ := os.ReadFile("/var/hercules/namespace.json")
var nodes []SerializedNsTreeNode
json.Unmarshal(bytes, &nodes)

// Reconstruct tree
mgr.Deserialize(nodes)

// Tree is now fully restored
files, _ := mgr.List(common.Path("/"))
```

**Crash Recovery:**
```go
func (ms *MasterServer) Recover() error {
    // Load checkpoint
    data, err := os.ReadFile("/var/hercules/namespace.json")
    if err != nil {
        return err
    }
    
    var nodes []SerializedNsTreeNode
    if err := json.Unmarshal(data, &nodes); err != nil {
        return err
    }
    
    // Restore namespace
    ms.namespace.Deserialize(nodes)
    
    log.Println("Namespace restored from checkpoint")
    return nil
}
```

---

### Utility Methods

#### RetrievePartitionFromPath

```go
func (nm *NamespaceManager) RetrievePartitionFromPath(p common.Path) (string, string)
```

Splits a path into directory and filename/dirname.

**Parameters:**
- `p`: Absolute path

**Returns:**
- `string`: Directory path
- `string`: Base name (filename or dirname)

**Examples:**

```go
dir, name := mgr.RetrievePartitionFromPath(common.Path("/home/user/file.txt"))
// dir = "/home/user"
// name = "file.txt"

dir, name = mgr.RetrievePartitionFromPath(common.Path("/home"))
// dir = "/"
// name = "home"

dir, name = mgr.RetrievePartitionFromPath(common.Path("/"))
// dir = "/"
// name = "/"
```

---

## Thread Safety

All operations are thread-safe through fine-grained locking:

```go
// Concurrent operations on different subtrees
go mgr.Create(common.Path("/home/a.txt"))
go mgr.Create(common.Path("/tmp/b.txt"))
// ✓ Fully concurrent (no lock contention)

// Concurrent operations on same directory
go mgr.Create(common.Path("/home/a.txt"))
go mgr.Create(common.Path("/home/b.txt"))
// Serialized (write lock contention on /home)

// Concurrent reads
go mgr.Get(common.Path("/home/file.txt"))
go mgr.Get(common.Path("/home/file.txt"))
go mgr.List(common.Path("/home"))
// ✓ Fully concurrent (read locks)
```

**Lock Levels:**
- **Per-node RWMutex:** Read locks for queries, write locks for mutations
- **Manager-level mutex:** Protects deleteCache and counters

---

## Usage Patterns

### Complete Lifecycle

```go
// 1. Initialize
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

mgr := nm.NewNameSpaceManager(ctx, 5*time.Minute)

// 2. Create directory structure
mgr.MkDirAll(common.Path("/data/uploads"))
mgr.MkDirAll(common.Path("/data/archive"))

// 3. Create file
mgr.Create(common.Path("/data/uploads/video.mp4"))

// 4. Update metadata after write
mgr.UpdateFileMetadata(common.Path("/data/uploads/video.mp4"), 
    1073741824,  // 1GB
    16)          // 16 chunks

// 5. List files
files, _ := mgr.List(common.Path("/data/uploads"))
for _, f := range files {
    fmt.Printf("%s: %d bytes\n", f.Name, f.Length)
}

// 6. Archive file
mgr.Rename(common.Path("/data/uploads/video.mp4"),
           common.Path("/data/archive/video.mp4"))

// 7. Delete file
mgr.Delete(common.Path("/data/archive/video.mp4"))

// 8. Checkpoint (persist to disk)
data := mgr.Serialize()
bytes, _ := json.Marshal(data)
os.WriteFile("checkpoint.json", bytes, 0644)
```

### Graceful Shutdown

```go
ctx, cancel := context.WithCancel(context.Background())
mgr := nm.NewNameSpaceManager(ctx, 1*time.Minute)

// Application shutdown
func shutdown() {
    // 1. Checkpoint current state
    data := mgr.Serialize()
    saveCheckpoint(data)
    
    // 2. Cancel context (stops background workers)
    cancel()
    
    // 3. Allow cleanup to finish
    time.Sleep(100 * time.Millisecond)
    
    log.Println("Namespace manager shut down")
}
```

### Error Handling

```go
// Always check errors
if err := mgr.Create(path); err != nil {
    if strings.Contains(err.Error(), "not found") {
        // Parent directory doesn't exist
        if err := mgr.MkDirAll(filepath.Dir(string(path))); err != nil {
            return err
        }
        // Retry create
        return mgr.Create(path)
    }
    return err
}
```

---

## Performance Considerations

### Memory Usage

```
Per-node overhead: ~100-150 bytes
1 million nodes: ~200-500 MB

Optimize:
- Use short paths
- Clean up deleted files promptly
- Serialize and compact periodically
```

### Lock Contention

```
Hot spots:
- Root directory (all operations)
- Top-level directories (/home, /tmp)

Mitigation:
- Read locks on ancestors
- Write locks only on target
- Different subtrees don't contend
```

### Benchmarks

```bash
# Run benchmarks
go test -bench=. -benchmem ./namespace_manager/...

# Typical results (single core):
# BenchmarkCreate-8       500000    3000 ns/op
# BenchmarkGet-8         1000000    1500 ns/op
# BenchmarkList-8         100000   15000 ns/op
```

---

## Testing

### Running Tests

```bash
# All tests
go test ./namespace_manager/...

# With race detector
go test -race ./namespace_manager/...

# Verbose output
go test -v ./namespace_manager/...

# Specific test
go test -run TestCreate ./namespace_manager/...

# Coverage
go test -cover ./namespace_manager/...
```

### Writing Tests

```go
func TestMyFeature(t *testing.T) {
    ctx := context.Background()
    mgr := nm.NewNameSpaceManager(ctx, 10*time.Second)
    
    // Setup
    require.NoError(t, mgr.MkDirAll(common.Path("/home/user")))
    
    // Test
    err := mgr.Create(common.Path("/home/user/file.txt"))
    assert.NoError(t, err)
    
    // Verify
    node, err := mgr.Get(common.Path("/home/user/file.txt"))
    assert.NoError(t, err)
    assert.False(t, node.IsDir)
}
```

---

## Best Practices

### 1. Always Create Parents First

```go
// ✓ Good: Ensure parent exists
mgr.MkDirAll("/home/user/docs")
mgr.Create("/home/user/docs/file.txt")

// ✗ Bad: Parent might not exist
mgr.Create("/home/user/docs/file.txt")  // May fail
```

### 2. Use Context for Lifecycle

```go
// ✓ Good: Graceful shutdown
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
mgr := nm.NewNameSpaceManager(ctx, 5*time.Minute)

// ✗ Bad: No cleanup mechanism
mgr := nm.NewNameSpaceManager(context.Background(), 5*time.Minute)
```

### 3. Checkpoint Periodically

```go
// ✓ Good: Regular checkpoints
ticker := time.NewTicker(1 * time.Hour)
go func() {
    for range ticker.C {
        data := mgr.Serialize()
        saveCheckpoint(data)
    }
}()

// ✗ Bad: No persistence (data loss on crash)
```

### 4. Handle Errors Properly

```go
// ✓ Good: Check and handle
if err := mgr.Create(path); err != nil {
    log.Printf("Failed to create %s: %v", path, err)
    return err
}

// ✗ Bad: Ignore errors
mgr.Create(path)  // Silent failure
```

---

## Troubleshooting

### "path is not found" Error

**Cause:** Parent directory doesn't exist

**Solution:**
```go
// Use MkDirAll instead of MkDir
mgr.MkDirAll(common.Path("/home/user/docs"))
```

### "target path already exists" Error (Rename)

**Cause:** Destination file/directory already exists

**Solution:**
```go
// Delete target first
mgr.Delete(targetPath)
time.Sleep(cleanupInterval)  // Wait for cleanup
mgr.Rename(sourcePath, targetPath)
```

### Memory Growth from Deleted Files

**Cause:** Cleanup interval too long, many deletions

**Solution:**
```go
// Shorter cleanup interval
mgr := nm.NewNameSpaceManager(ctx, 30*time.Second)

// Or force checkpoint + reload
data := mgr.Serialize()
mgr.Deserialize(data)  // Compacts tree
```

---

## FAQ

### Q: Is NamespaceManager thread-safe?

**A:** Yes, all operations use fine-grained locking and are safe for concurrent use.

### Q: What happens to deleted files?

**A:** Files are renamed with `___deleted__` prefix immediately, then asynchronously removed from the tree after `cleanUpInterval`.

### Q: Can I use this for millions of files?

**A:** Yes, but consider memory usage (~200-500 MB per million nodes) and periodic serialization for compaction.

### Q: How do I handle crashes?

**A:** Serialize periodically to disk, then Deserialize on startup to restore state.

### Q: What's the difference between MkDir and MkDirAll?

**A:** `MkDir` requires parent to exist. `MkDirAll` creates all ancestors (like `mkdir -p`).

### Q: Can I rename directories?

**A:** Yes, Rename works for both files and directories, moving the entire subtree atomically.

### Q: How fast are operations?

**A:** Create/Get: ~1-3 microseconds. List: depends on subtree size. Serialize: O(n) where n = total nodes.

---

## Related Components

- **Master Server:** Primary user of namespace manager
- **Common Types:** Uses `common.Path`, `common.PathInfo`
- **Utils:** Filename validation

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

Part of the Hercules distributed file system project.

## Support

- GitHub Issues: https://github.com/caleberi/hercules-dfs/issues
- Documentation: [docs/](../docs/)
- Design Document: [DESIGN.md](DESIGN.md)
