# FileSystem - Thread-Safe Sandboxed Filesystem Operations

## Overview

The **FileSystem** package provides a secure, thread-safe abstraction layer for file and directory operations in the Hercules distributed file system. It enforces a sandboxed environment by restricting all operations to paths within a designated root directory, preventing directory traversal attacks and ensuring safe concurrent access through mutex-based synchronization.

**Key Features:**
- 🔒 **Sandboxed Access:** All paths restricted to root directory, preventing traversal attacks
- 🔄 **Thread-Safe:** Mutex-protected operations safe for concurrent access
- 🛡️ **Type Safety:** Validates file vs directory operations to prevent misuse
- ✅ **POSIX-Like API:** Familiar filesystem operations with safety guarantees
- 🚀 **Zero Dependencies:** Built on standard Go `os` and `filepath` packages

**Use Cases:**
- ChunkServer local chunk storage management
- Secure file operations in multi-tenant environments
- Sandboxed application data storage
- Any scenario requiring restricted filesystem access

## Installation

The FileSystem package is part of the Hercules distributed file system:

```bash
# Clone the repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# Install dependencies
go mod download

# Run tests
go test ./file_system/...
```

## Quick Start

### Basic Setup

```go
package main

import (
    "fmt"
    "os"
    "github.com/caleberi/hercules-dfs/file_system"
)

func main() {
    // Create a new FileSystem rooted at /data/chunks
    fs := file_system.NewFileSystem("/data/chunks")
    
    // Create directory
    if err := fs.MkDir("my-data"); err != nil {
        panic(err)
    }
    
    // Create file
    if err := fs.CreateFile("my-data/file.txt"); err != nil {
        panic(err)
    }
    
    // Write to file
    file, err := fs.GetFile("my-data/file.txt", os.O_WRONLY, 0644)
    if err != nil {
        panic(err)
    }
    defer file.Close()
    
    file.WriteString("Hello, Hercules!")
    
    fmt.Println("File created successfully")
}
```

### ChunkServer Integration

```go
type ChunkServer struct {
    fs *file_system.FileSystem
}

func NewChunkServer(storageRoot string) *ChunkServer {
    return &ChunkServer{
        fs: file_system.NewFileSystem(storageRoot),
    }
}

func (cs *ChunkServer) StoreChunk(handle int, version int, data []byte) error {
    // Create chunk directory
    chunkDir := fmt.Sprintf("chunk_%d", handle)
    if err := cs.fs.MkDir(chunkDir); err != nil {
        return err
    }
    
    // Write chunk data atomically
    tempPath := fmt.Sprintf("%s/.tmp_v%d", chunkDir, version)
    finalPath := fmt.Sprintf("%s/v%d.chunk", chunkDir, version)
    
    // Write to temporary file
    file, err := cs.fs.GetFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
    if err != nil {
        return err
    }
    
    if _, err := file.Write(data); err != nil {
        file.Close()
        return err
    }
    file.Close()
    
    // Atomically rename to final location
    return cs.fs.Rename(tempPath, finalPath)
}
```

## API Reference

### Constructor

#### NewFileSystem

```go
func NewFileSystem(root string) *FileSystem
```

Creates a new FileSystem instance rooted at the specified directory.

**Parameters:**
- `root` (string): Absolute path to the root directory for sandboxed operations

**Returns:**
- `*FileSystem`: New FileSystem instance

**Example:**
```go
fs := file_system.NewFileSystem("/data/chunks")
```

**Important:** The root directory should:
- Be an absolute path
- Exist before creating FileSystem (or be created by the application)
- Have appropriate permissions for the application user

---

### Directory Operations

#### MkDir

```go
func (fs *FileSystem) MkDir(path string) error
```

Creates a directory at the specified path, creating parent directories as needed (similar to `mkdir -p`).

**Parameters:**
- `path` (string): Relative path within the FileSystem root

**Returns:**
- `error`: `nil` on success, error otherwise

**Behavior:**
- Creates all parent directories automatically
- Idempotent: succeeds if directory already exists
- Uses `0777` permissions (subject to umask)

**Examples:**

```go
// Create single directory
err := fs.MkDir("data")
// Creates: /root/data/

// Create nested directories
err := fs.MkDir("data/chunks/v1")
// Creates: /root/data/
//          /root/data/chunks/
//          /root/data/chunks/v1/

// Already exists (no error)
err := fs.MkDir("data")  // Returns nil
```

**Error Cases:**
```go
// Path traversal attempt
err := fs.MkDir("../../../etc")
// Error: "provided path ../../../etc is restricted to the filesystem root"

// Permission denied
err := fs.MkDir("protected")
// Error: "mkdir /root/protected: permission denied"
```

#### RemoveDir

```go
func (fs *FileSystem) RemoveDir(path string) error
```

Removes a directory and all its contents recursively.

**Parameters:**
- `path` (string): Relative path to directory

**Returns:**
- `error`: `nil` on success, error otherwise

**Behavior:**
- Recursively removes directory and all contents
- Validates path is a directory (not a file)
- Fails if path doesn't exist

**Examples:**

```go
// Remove empty directory
err := fs.RemoveDir("empty-dir")

// Remove directory with contents
fs.MkDir("data/chunks")
fs.CreateFile("data/chunks/file1.txt")
fs.CreateFile("data/chunks/file2.txt")
err := fs.RemoveDir("data")  // Removes entire tree

// Error: path is a file
fs.CreateFile("file.txt")
err := fs.RemoveDir("file.txt")
// Error: "path /root/file.txt is not a directory"
```

**Error Cases:**
```go
// Directory doesn't exist
err := fs.RemoveDir("nonexistent")
// Error: "failed to get file info: stat /root/nonexistent: no such file or directory"

// Not a directory
err := fs.RemoveDir("file.txt")
// Error: "path /root/file.txt is not a directory"
```

---

### File Operations

#### CreateFile

```go
func (fs *FileSystem) CreateFile(path string) error
```

Creates a new empty file at the specified path.

**Parameters:**
- `path` (string): Relative path to file

**Returns:**
- `error`: `nil` on success, error otherwise

**Behavior:**
- Creates an empty file with `0777` permissions (subject to umask)
- Fails if file already exists (prevents accidental overwrites)
- Creates parent directories automatically

**Examples:**

```go
// Create file in existing directory
fs.MkDir("data")
err := fs.CreateFile("data/file.txt")

// Create file with nested path (creates parents)
err := fs.CreateFile("data/subdir/file.txt")

// Error: file already exists
err := fs.CreateFile("data/file.txt")
err = fs.CreateFile("data/file.txt")
// Error: "failed to create file: file /root/data/file.txt already exists"
```

**Error Cases:**
```go
// File already exists
fs.CreateFile("file.txt")
err := fs.CreateFile("file.txt")
// Error: "failed to create file: file /root/file.txt already exists"

// Permission denied
err := fs.CreateFile("protected/file.txt")
// Error: "open /root/protected/file.txt: permission denied"
```

#### GetFile

```go
func (fs *FileSystem) GetFile(path string, flag int, mode os.FileMode) (*os.File, error)
```

Opens a file with the specified flags and mode, returning a file handle.

**Parameters:**
- `path` (string): Relative path to file
- `flag` (int): Open flags (e.g., `os.O_RDONLY`, `os.O_WRONLY`, `os.O_RDWR`)
- `mode` (os.FileMode): File mode/permissions (e.g., `0644`)

**Returns:**
- `*os.File`: File handle (caller must close)
- `error`: `nil` on success, error otherwise

**Common Flags:**

| Flag | Description |
|------|-------------|
| `os.O_RDONLY` | Open read-only |
| `os.O_WRONLY` | Open write-only |
| `os.O_RDWR` | Open read-write |
| `os.O_APPEND` | Append mode (writes go to end) |
| `os.O_CREATE` | Create file if it doesn't exist |
| `os.O_TRUNC` | Truncate file to zero length on open |
| `os.O_EXCL` | Used with O_CREATE, file must not exist |

**Examples:**

```go
// Read file
file, err := fs.GetFile("data/file.txt", os.O_RDONLY, 0)
if err != nil {
    panic(err)
}
defer file.Close()

data, err := io.ReadAll(file)

// Write to existing file
file, err := fs.GetFile("data/file.txt", os.O_WRONLY|os.O_TRUNC, 0644)
if err != nil {
    panic(err)
}
defer file.Close()

file.WriteString("New content")

// Append to file
file, err := fs.GetFile("log.txt", os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0644)
if err != nil {
    panic(err)
}
defer file.Close()

file.WriteString("Log entry\n")

// Create and write atomically
file, err := fs.GetFile("new.txt", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
if err != nil {
    panic(err)
}
defer file.Close()

file.Write(data)
```

**Important:** Always close the returned file:

```go
// Good: defer close immediately
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
defer file.Close()  // ✓ Ensures cleanup

// Bad: forget to close
file, err := fs.GetFile(path, os.O_RDONLY, 0)
// ✗ File handle leak!
```

**Error Cases:**
```go
// File doesn't exist (without O_CREATE)
file, err := fs.GetFile("missing.txt", os.O_RDONLY, 0)
// Error: "open /root/missing.txt: no such file or directory"

// Path is a directory
err := fs.MkDir("dir")
file, err := fs.GetFile("dir", os.O_RDONLY, 0)
// Error: "failed to get file, the path /root/dir is a directory"
```

#### RemoveFile

```go
func (fs *FileSystem) RemoveFile(path string) error
```

Deletes a file at the specified path.

**Parameters:**
- `path` (string): Relative path to file

**Returns:**
- `error`: `nil` on success, error otherwise

**Behavior:**
- Only removes regular files (not directories)
- Fails if path is a directory
- Fails if file doesn't exist

**Examples:**

```go
// Remove file
fs.CreateFile("temp.txt")
err := fs.RemoveFile("temp.txt")

// Error: path is a directory
fs.MkDir("dir")
err := fs.RemoveFile("dir")
// Error: "path /root/dir is not a regular file"
```

**Error Cases:**
```go
// File doesn't exist
err := fs.RemoveFile("missing.txt")
// Error: "failed to get file info: stat /root/missing.txt: no such file or directory"

// Path is a directory
err := fs.RemoveFile("directory")
// Error: "path /root/directory is not a regular file"
```

#### Rename

```go
func (fs *FileSystem) Rename(oldPath, newPath string) error
```

Atomically renames/moves a file or directory from `oldPath` to `newPath`.

**Parameters:**
- `oldPath` (string): Current relative path
- `newPath` (string): New relative path

**Returns:**
- `error`: `nil` on success, error otherwise

**Behavior:**
- Atomic operation on most filesystems
- Works for both files and directories
- Both paths must be within FileSystem root
- Fails if `oldPath` doesn't exist

**Examples:**

```go
// Rename file
fs.CreateFile("old.txt")
err := fs.Rename("old.txt", "new.txt")

// Move file to different directory
fs.MkDir("archive")
err := fs.Rename("old.txt", "archive/old.txt")

// Rename directory
fs.MkDir("old-dir")
err := fs.Rename("old-dir", "new-dir")

// Atomic chunk version update
fs.CreateFile("chunk/.tmp_v2")
// ... write data to temp file ...
err := fs.Rename("chunk/.tmp_v2", "chunk/v2.chunk")
// Atomically replaces old version
```

**Error Cases:**
```go
// Old path doesn't exist
err := fs.Rename("missing.txt", "new.txt")
// Error: "old path /root/missing.txt does not exist"

// Path traversal in either path
err := fs.Rename("file.txt", "../../../etc/passwd")
// Error: "provided path ../../../etc/passwd is restricted to the filesystem root"
```

**Atomic Update Pattern:**

```go
// Safe atomic file update
func atomicUpdate(fs *FileSystem, path string, data []byte) error {
    tempPath := path + ".tmp"
    
    // Write to temporary file
    file, err := fs.GetFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
    if err != nil {
        return err
    }
    
    if _, err := file.Write(data); err != nil {
        file.Close()
        return err
    }
    file.Close()
    
    // Atomically replace original
    return fs.Rename(tempPath, path)
}
```

---

### Utility Operations

#### GetStat

```go
func (fs *FileSystem) GetStat(path string) (fs.FileInfo, error)
```

Retrieves file or directory metadata.

**Parameters:**
- `path` (string): Relative path to file or directory

**Returns:**
- `fs.FileInfo`: Metadata about the file/directory
- `error`: `nil` on success, error otherwise

**FileInfo Methods:**

```go
type FileInfo interface {
    Name() string       // Base name of file
    Size() int64        // Size in bytes
    Mode() FileMode     // Permission and mode bits
    ModTime() time.Time // Modification time
    IsDir() bool        // Whether path is a directory
    Sys() interface{}   // Underlying system-specific data
}
```

**Examples:**

```go
// Check if file exists
info, err := fs.GetStat("file.txt")
if err != nil {
    if os.IsNotExist(err) {
        fmt.Println("File doesn't exist")
    }
    return err
}

// Get file size
size := info.Size()
fmt.Printf("File size: %d bytes\n", size)

// Check if path is directory
if info.IsDir() {
    fmt.Println("Path is a directory")
} else {
    fmt.Println("Path is a file")
}

// Get modification time
modTime := info.ModTime()
fmt.Printf("Last modified: %s\n", modTime)

// Get permissions
mode := info.Mode()
fmt.Printf("Permissions: %s\n", mode.Perm())
```

**Practical Use Cases:**

```go
// Verify chunk size matches expected
func verifyChunkSize(fs *FileSystem, path string, expectedSize int64) error {
    info, err := fs.GetStat(path)
    if err != nil {
        return err
    }
    
    if info.Size() != expectedSize {
        return fmt.Errorf("size mismatch: got %d, want %d", info.Size(), expectedSize)
    }
    
    return nil
}

// List directory contents (requires combining with filepath.Walk or os.ReadDir)
func listDirectory(fs *FileSystem, dirPath string) ([]string, error) {
    // First verify it's a directory
    info, err := fs.GetStat(dirPath)
    if err != nil {
        return nil, err
    }
    
    if !info.IsDir() {
        return nil, fmt.Errorf("not a directory: %s", dirPath)
    }
    
    // Get absolute path for os.ReadDir
    absPath := filepath.Join(fs.root, dirPath)
    entries, err := os.ReadDir(absPath)
    if err != nil {
        return nil, err
    }
    
    var names []string
    for _, entry := range entries {
        names = append(names, entry.Name())
    }
    
    return names, nil
}
```

**Error Cases:**
```go
// File doesn't exist
info, err := fs.GetStat("missing.txt")
// Error: "failed to get file info: stat /root/missing.txt: no such file or directory"
```

---

## Security

### Sandboxing and Path Restriction

All paths are validated to prevent directory traversal attacks:

```go
fs := file_system.NewFileSystem("/data/chunks")

// ✓ Allowed: paths within root
fs.CreateFile("file.txt")              // → /data/chunks/file.txt
fs.CreateFile("dir/file.txt")          // → /data/chunks/dir/file.txt
fs.CreateFile("./relative.txt")        // → /data/chunks/relative.txt

// ✗ Blocked: directory traversal
fs.CreateFile("../../../etc/passwd")   // Error: path restricted
fs.CreateFile("/etc/passwd")           // → /data/chunks/etc/passwd (safe)
fs.CreateFile("dir/../../etc/passwd")  // Error: path restricted
```

**How It Works:**

1. Path is cleaned: `../../../etc/passwd` → `../../etc/passwd`
2. Joined with root: `/data/chunks` + `../../etc/passwd` → `/data/chunks/../../etc/passwd`
3. Cleaned again: `/data/chunks/../../etc/passwd` → `/etc/passwd`
4. Prefix check: `/etc/passwd`.HasPrefix(`/data/chunks`) → **false** → **BLOCKED**

### Permissions

Files and directories are created with `0777` permissions by default, which are modified by the system umask:

```bash
# With umask 0022 (typical)
umask 0022
# Created files: 0755 (rwxr-xr-x)
# Created directories: 0755 (rwxr-xr-x)

# With umask 0077 (restrictive)
umask 0077
# Created files: 0700 (rwx------)
# Created directories: 0700 (rwx------)
```

**Best Practices:**

```go
// For production, consider more restrictive permissions
file, err := fs.GetFile("sensitive.dat", os.O_WRONLY|os.O_CREATE, 0600)
// Creates file with rw------- (owner only)

// Public data
file, err := fs.GetFile("public.txt", os.O_WRONLY|os.O_CREATE, 0644)
// Creates file with rw-r--r-- (owner write, others read)
```

### Thread Safety

All operations are protected by a mutex, making concurrent access safe:

```go
fs := file_system.NewFileSystem("/data")

// Safe concurrent access
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(id int) {
        defer wg.Done()
        path := fmt.Sprintf("file_%d.txt", id)
        fs.CreateFile(path)  // Thread-safe
    }(i)
}
wg.Wait()
```

**Mutex Protection:**
- All operations acquire lock before execution
- Lock is released via `defer` (even on panic)
- No partial operations visible to other threads

---

## Error Handling

### Error Types

```go
// Path restricted (security error)
err := fs.CreateFile("../../../etc/passwd")
fmt.Println(err)
// Output: provided path ../../../etc/passwd is restricted to the filesystem root

// File already exists
fs.CreateFile("file.txt")
err = fs.CreateFile("file.txt")
fmt.Println(err)
// Output: failed to create file: file /root/file.txt already exists

// File not found
err = fs.RemoveFile("missing.txt")
fmt.Println(err)
// Output: failed to get file info: stat /root/missing.txt: no such file or directory

// Not a directory
fs.CreateFile("file.txt")
err = fs.RemoveDir("file.txt")
fmt.Println(err)
// Output: path /root/file.txt is not a directory

// Not a regular file
fs.MkDir("dir")
err = fs.RemoveFile("dir")
fmt.Println(err)
// Output: path /root/dir is not a regular file
```

### Error Checking Patterns

```go
// Check specific error types
err := fs.CreateFile(path)
if err != nil {
    if os.IsExist(err) {
        // File already exists, handle accordingly
    } else if os.IsPermission(err) {
        // Permission denied
    } else if os.IsNotExist(err) {
        // Parent directory doesn't exist (shouldn't happen with CreateFile)
    } else {
        // Other error
    }
}

// Check if file exists before operating
info, err := fs.GetStat(path)
if err != nil {
    if os.IsNotExist(err) {
        // File doesn't exist, create it
        fs.CreateFile(path)
    } else {
        return err
    }
}

// Idempotent directory creation
if err := fs.MkDir("data"); err != nil {
    // MkDir is idempotent, but you can still check
    if !os.IsExist(err) {
        return err
    }
}
```

---

## Usage Patterns

### Atomic File Updates

```go
// Atomic update pattern using temporary file
func atomicWrite(fs *FileSystem, path string, data []byte) error {
    tempPath := path + ".tmp"
    
    // 1. Write to temporary file
    file, err := fs.GetFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
    if err != nil {
        return err
    }
    
    if _, err := file.Write(data); err != nil {
        file.Close()
        fs.RemoveFile(tempPath)  // Cleanup
        return err
    }
    
    if err := file.Sync(); err != nil {  // Ensure data on disk
        file.Close()
        fs.RemoveFile(tempPath)
        return err
    }
    file.Close()
    
    // 2. Atomically rename to final location
    return fs.Rename(tempPath, path)
}
```

### Safe File Reading

```go
func readFileSafely(fs *FileSystem, path string) ([]byte, error) {
    file, err := fs.GetFile(path, os.O_RDONLY, 0)
    if err != nil {
        return nil, fmt.Errorf("failed to open file: %w", err)
    }
    defer file.Close()
    
    data, err := io.ReadAll(file)
    if err != nil {
        return nil, fmt.Errorf("failed to read file: %w", err)
    }
    
    return data, nil
}
```

### Directory Initialization

```go
func initializeStorage(fs *FileSystem) error {
    // Create directory structure
    dirs := []string{
        "chunks",
        "metadata",
        "temp",
        "archive",
    }
    
    for _, dir := range dirs {
        if err := fs.MkDir(dir); err != nil {
            return fmt.Errorf("failed to create %s: %w", dir, err)
        }
    }
    
    // Create initial metadata files
    metadataFiles := []string{
        "metadata/version.dat",
        "metadata/lease.dat",
    }
    
    for _, file := range metadataFiles {
        if err := fs.CreateFile(file); err != nil && !os.IsExist(err) {
            return fmt.Errorf("failed to create %s: %w", file, err)
        }
    }
    
    return nil
}
```

### Batch Operations

```go
func createMultipleFiles(fs *FileSystem, paths []string) error {
    var errors []error
    
    for _, path := range paths {
        if err := fs.CreateFile(path); err != nil {
            errors = append(errors, fmt.Errorf("%s: %w", path, err))
        }
    }
    
    if len(errors) > 0 {
        return fmt.Errorf("failed to create files: %v", errors)
    }
    
    return nil
}
```

### Cleanup Pattern

```go
func cleanupOldChunks(fs *FileSystem, maxAge time.Duration) error {
    // List all chunk directories
    absRoot := "/data/chunks"  // fs.root
    entries, err := os.ReadDir(absRoot)
    if err != nil {
        return err
    }
    
    now := time.Now()
    for _, entry := range entries {
        if !entry.IsDir() {
            continue
        }
        
        // Get modification time
        info, err := fs.GetStat(entry.Name())
        if err != nil {
            continue
        }
        
        // Remove old directories
        if now.Sub(info.ModTime()) > maxAge {
            if err := fs.RemoveDir(entry.Name()); err != nil {
                log.Printf("Failed to remove %s: %v", entry.Name(), err)
            }
        }
    }
    
    return nil
}
```

---

## Testing

### Running Tests

```bash
# Run all tests
go test ./file_system/...

# Run with race detector
go test -race ./file_system/...

# Run with coverage
go test -cover ./file_system/...

# Verbose output
go test -v ./file_system/...

# Run specific test
go test -run TestCreateFile ./file_system/...
```

### Writing Tests

```go
func TestMyFeature(t *testing.T) {
    // Setup: Create temporary FileSystem
    tempDir, err := os.MkdirTemp("", "fs-test-*")
    require.NoError(t, err)
    defer os.RemoveAll(tempDir)
    
    fs := file_system.NewFileSystem(tempDir)
    
    // Test your feature
    err = fs.CreateFile("test.txt")
    assert.NoError(t, err)
    
    // Verify
    info, err := fs.GetStat("test.txt")
    assert.NoError(t, err)
    assert.False(t, info.IsDir())
}
```

### Example Test Cases

```go
// Test path traversal protection
func TestPathTraversal(t *testing.T) {
    fs, cleanup := setupTestFS(t)
    defer cleanup()
    
    err := fs.CreateFile("../../../etc/passwd")
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "restricted to the filesystem root")
}

// Test concurrent access
func TestConcurrentWrites(t *testing.T) {
    fs, cleanup := setupTestFS(t)
    defer cleanup()
    
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            path := fmt.Sprintf("file_%d.txt", id)
            assert.NoError(t, fs.CreateFile(path))
        }(i)
    }
    wg.Wait()
    
    // Verify all files created
    for i := 0; i < 100; i++ {
        path := fmt.Sprintf("file_%d.txt", i)
        _, err := fs.GetStat(path)
        assert.NoError(t, err)
    }
}
```

---

## Performance Considerations

### Lock Contention

The FileSystem uses a single mutex for all operations, which can cause contention under high concurrency:

```go
// Low contention (typical ChunkServer workload)
// Operations: 1-10ms each
// Frequency: 10-100/sec
// Contention: < 1%

// High contention (many concurrent clients)
// Operations: 1-10ms each
// Frequency: 1000+/sec
// Contention: > 10%
```

**Mitigation:**
- Keep operations fast (avoid long file I/O while holding lock)
- Use async patterns for independent operations
- Consider batching operations

### File Handle Management

Always close files to avoid resource leaks:

```go
// Good: Immediate defer
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
defer file.Close()  // ✓

// Bad: Late close
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
// ... many lines of code ...
file.Close()  // ✗ May be skipped on error paths
```

### Disk I/O Optimization

```go
// Buffer I/O for better performance
file, err := fs.GetFile(path, os.O_WRONLY|os.O_CREATE, 0644)
if err != nil {
    return err
}
defer file.Close()

writer := bufio.NewWriter(file)
// Write data...
writer.Flush()

// Use appropriate buffer sizes
const bufferSize = 64 * 1024  // 64KB
buffer := make([]byte, bufferSize)
```

---

## Best Practices

### 1. Always Defer Close

```go
// ✓ Good
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
defer file.Close()

// ✗ Bad
file, err := fs.GetFile(path, os.O_RDONLY, 0)
// Missing defer - file handle leak
```

### 2. Check Errors

```go
// ✓ Good
if err := fs.CreateFile(path); err != nil {
    return fmt.Errorf("failed to create file: %w", err)
}

// ✗ Bad
fs.CreateFile(path)  // Ignoring error
```

### 3. Use Atomic Updates

```go
// ✓ Good: Atomic update
tempPath := path + ".tmp"
file, _ := fs.GetFile(tempPath, os.O_WRONLY|os.O_CREATE, 0644)
// Write data...
file.Close()
fs.Rename(tempPath, path)  // Atomic

// ✗ Bad: Direct overwrite (not atomic)
file, _ := fs.GetFile(path, os.O_WRONLY|os.O_TRUNC, 0644)
// Write data...  (corruption possible on crash)
```

### 4. Validate Inputs

```go
// ✓ Good
if path == "" {
    return fmt.Errorf("path cannot be empty")
}
if err := fs.CreateFile(path); err != nil {
    return err
}

// ✗ Bad: No validation
fs.CreateFile(path)  // May panic or behave unexpectedly
```

### 5. Use Appropriate Permissions

```go
// ✓ Good: Restrictive permissions for sensitive data
fs.GetFile("secret.key", os.O_WRONLY|os.O_CREATE, 0600)  // Owner only

// ✓ Good: Public permissions for shared data
fs.GetFile("public.txt", os.O_WRONLY|os.O_CREATE, 0644)  // Owner write, all read

// ✗ Bad: Overly permissive
fs.GetFile("secret.key", os.O_WRONLY|os.O_CREATE, 0777)  // World-writable
```

---

## Troubleshooting

### Common Issues

#### "Path restricted to filesystem root"

**Cause:** Path contains directory traversal (`..`)

**Solution:**
```go
// ✗ Wrong
fs.CreateFile("../outside.txt")

// ✓ Correct
fs.CreateFile("inside.txt")
```

#### "File already exists"

**Cause:** `CreateFile` called on existing file

**Solution:**
```go
// Check before creating
if _, err := fs.GetStat(path); os.IsNotExist(err) {
    fs.CreateFile(path)
} else {
    // File exists, decide what to do
}

// Or use GetFile with O_TRUNC to overwrite
file, err := fs.GetFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
```

#### "Not a directory" / "Not a regular file"

**Cause:** Type mismatch (file vs directory)

**Solution:**
```go
// Check type before operating
info, err := fs.GetStat(path)
if err != nil {
    return err
}

if info.IsDir() {
    fs.RemoveDir(path)
} else {
    fs.RemoveFile(path)
}
```

#### File Handle Leaks

**Cause:** Forgetting to close files

**Solution:**
```go
// Always defer close
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
defer file.Close()  // ← Critical!
```

**Diagnosis:**
```bash
# Check open file descriptors (Linux/macOS)
lsof -p <pid> | grep /data/chunks

# Monitor file descriptor count
ls -l /proc/<pid>/fd | wc -l
```

---

## FAQ

### Q: Is FileSystem thread-safe?

**A:** Yes, all operations are protected by a mutex and safe for concurrent use.

### Q: Can I use absolute paths?

**A:** Absolute paths are joined with the root, so `/etc/passwd` becomes `/root/etc/passwd` (safe).

### Q: What happens if I try to access `../../../etc/passwd`?

**A:** The path is cleaned and validated, resulting in an error: "path restricted to filesystem root".

### Q: Can I create files in non-existent directories?

**A:** Yes, `CreateFile` and `GetFile` with `O_CREATE` will create parent directories automatically.

### Q: Is `Rename` atomic?

**A:** Yes, `os.Rename` is atomic on most filesystems (POSIX, NTFS, APFS).

### Q: How do I list directory contents?

**A:** Use `os.ReadDir` with the absolute path (root + relative path), or implement a wrapper using `GetStat` to validate first.

### Q: What permissions are used?

**A:** `0777` by default, modified by umask. Use mode parameter in `GetFile` for custom permissions.

### Q: Can I follow symlinks?

**A:** Symlinks are followed by OS operations, but this may allow escaping the sandbox. Consider adding symlink validation if needed.

### Q: How do I handle errors?

**A:** Check errors using `os.IsExist`, `os.IsNotExist`, `os.IsPermission`, etc. See [Error Handling](#error-handling) section.

### Q: Is there a file size limit?

**A:** No internal limit. Limited only by filesystem and OS constraints.

---

## Related Components

- **ChunkServer:** Primary user of FileSystem for chunk storage
- **common/types.go:** Chunk handle and version types
- **common/constants.go:** Configuration constants

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

Part of the Hercules distributed file system project.

## Support

- GitHub Issues: https://github.com/caleberi/hercules-dfs/issues
- Documentation: [docs/](../docs/)
- Design Document: [DESIGN.md](DESIGN.md)
