# FileSystem Design Documentation

## Overview

The FileSystem package provides a **thread-safe, sandboxed file and directory management layer** for the Hercules distributed file system. It acts as a secure abstraction over the operating system's file operations, enforcing path restrictions to prevent directory traversal attacks and ensuring concurrent access safety through mutex-based synchronization.

This component is critical for ChunkServers, which need to safely manage chunk storage on local disk while preventing malicious or accidental access to paths outside the designated storage directory.

## Architecture

### Design Patterns

#### 1. Sandbox Pattern (Path Restriction)

The FileSystem enforces a security boundary preventing access outside the root directory:

```
┌────────────────────────────────────────────┐
│         FileSystem Sandbox                 │
├────────────────────────────────────────────┤
│                                            │
│  Root: /data/chunks                       │
│  ┌──────────────────────────────────┐     │
│  │  Allowed Paths:                  │     │
│  │  ✓ /data/chunks/file.txt         │     │
│  │  ✓ /data/chunks/dir/sub.txt      │     │
│  │  ✓ ./relative.txt                │     │
│  │                                   │     │
│  │  Blocked Paths:                  │     │
│  │  ✗ ../../../etc/passwd           │     │
│  │  ✗ /etc/passwd                   │     │
│  │  ✗ ../.ssh/id_rsa                │     │
│  └──────────────────────────────────┘     │
│                                            │
│  restrictToRoot() verification:           │
│  1. Join root + relative path             │
│  2. Clean path (resolve .., .)            │
│  3. Verify starts with root prefix        │
│                                            │
└────────────────────────────────────────────┘
```

**Security Properties:**
- **Path Canonicalization:** Resolves `.` and `..` before validation
- **Prefix Check:** Ensures absolute path starts with root directory
- **Defense in Depth:** Validates before every OS operation
- **No Symlink Following:** Uses `filepath.Join` which doesn't follow symlinks in the path

**Attack Prevention:**

| Attack Type | Example | Prevention |
|-------------|---------|------------|
| Directory Traversal | `../../../etc/passwd` | Cleaned to absolute path, prefix check fails |
| Absolute Path | `/etc/passwd` | Joined with root, becomes `/data/chunks/etc/passwd` |
| Relative Traversal | `dir/../../etc/passwd` | Cleaned before prefix check |
| Current Directory | `./file.txt` | Cleaned to `file.txt`, allowed |
| Empty Path | `""` | Treated as current directory (root) |

#### 2. Coarse-Grained Lock Pattern

Uses a single mutex for all operations to ensure consistency:

```
┌───────────────────────────────────────┐
│    Thread-Safe Operations             │
├───────────────────────────────────────┤
│                                       │
│  Thread A          Thread B           │
│     │                 │               │
│     ├─ Lock ─────────┤               │
│     │                 │ (blocked)     │
│     ├─ CreateFile     │               │
│     │                 │               │
│     ├─ Unlock ────────┤               │
│     │                 ▼               │
│     │              Lock               │
│     │              MkDir               │
│     │              Unlock              │
│     ▼                 ▼               │
│                                       │
└───────────────────────────────────────┘
```

**Design Choice: Coarse-Grained vs Fine-Grained**

| Aspect | Coarse (Current) | Fine-Grained |
|--------|------------------|--------------|
| Implementation | Single mutex | Per-file/directory locks |
| Complexity | Low | High |
| Contention | Higher for parallel ops | Lower |
| Deadlock Risk | None | Possible (lock ordering) |
| Use Case Fit | ChunkServer (sequential writes) | High-concurrency FS |

**Rationale for Coarse-Grained:**
- ChunkServer operations are typically sequential per chunk
- Simplicity reduces bug surface area
- Adequate performance for chunk-based workloads
- No risk of deadlocks from complex lock hierarchies

#### 3. Defensive Programming Pattern

Every operation validates inputs and checks state before modification:

```
Operation Flow:
    │
    ├─ Acquire Lock
    │
    ├─ Validate Path (restrictToRoot)
    │    └─ Error → Return
    │
    ├─ Check Preconditions (file exists, is directory, etc.)
    │    └─ Error → Return
    │
    ├─ Execute OS Operation
    │    └─ Error → Return
    │
    ├─ Release Lock
    │
    └─ Return Success
```

**Validation Layers:**

1. **Path Validation:** `restrictToRoot()` checks path safety
2. **Existence Checks:** Verify file/directory exists when required
3. **Type Checks:** Ensure path is file/directory as expected
4. **Permission Checks:** Rely on OS-level permissions (0777 default)

## Component Design

### Core Structure

```go
type FileSystem struct {
    mu   sync.Mutex // Serializes all operations
    root string     // Absolute base path for sandboxing
}
```

**Field Purposes:**

| Field | Type | Purpose | Immutable |
|-------|------|---------|-----------|
| `mu` | `sync.Mutex` | Ensures atomic, thread-safe operations | No (mutex state) |
| `root` | `string` | Defines security boundary for path access | Yes (set at creation) |

**Invariants:**
1. `root` is set at creation and never modified
2. All operations acquire `mu` before accessing filesystem
3. No operation completes without releasing `mu` (via defer)
4. All paths are validated through `restrictToRoot` before use

### Key Methods

#### Path Validation

```go
func (fs *FileSystem) restrictToRoot(path string) (string, error)
```

**Algorithm:**
```
Input: "../../etc/passwd"
  │
  ├─ filepath.Join(root, filepath.Clean(path))
  │    root = "/data/chunks"
  │    cleaned = "../../etc/passwd"
  │    joined = "/data/chunks/../../etc/passwd"
  │    → cleaned again = "/data/etc/passwd"
  │
  ├─ Check prefix
  │    "/data/etc/passwd".HasPrefix("/data/chunks") → false
  │
  └─ Return error ✗
```

**Time Complexity:** O(n) where n = path length (string operations)  
**Space Complexity:** O(n) for cleaned path string

#### Directory Operations

##### MkDir
```go
func (fs *FileSystem) MkDir(path string) error
```

**Behavior:**
- Creates directory and all parent directories (like `mkdir -p`)
- Idempotent: succeeds if directory already exists
- Uses 0777 permissions (respects umask)

**Implementation:**
```
MkDir("a/b/c"):
  │
  ├─ restrictToRoot("a/b/c")
  │    → "/data/chunks/a/b/c"
  │
  ├─ os.MkdirAll("/data/chunks/a/b/c", 0777)
  │    Creates: /data/chunks/a
  │             /data/chunks/a/b
  │             /data/chunks/a/b/c
  │
  └─ Success ✓
```

**Use Case in ChunkServer:**
```go
// Create directory for chunk handle 12345
chunkDir := fmt.Sprintf("chunks/%d", chunkHandle)
fs.MkDir(chunkDir)
```

##### RemoveDir
```go
func (fs *FileSystem) RemoveDir(path string) error
```

**Preconditions:**
1. Path exists
2. Path is a directory
3. Caller has permissions

**Behavior:**
- Recursively removes directory and all contents
- Fails if path is a file (type safety)

**Safety Checks:**
```
RemoveDir("file.txt"):
  │
  ├─ restrictToRoot("file.txt")
  │
  ├─ getFileInfo(path)
  │    info.IsDir() → false
  │
  ├─ Return error: "not a directory" ✗
  │
  └─ os.Remove never called (prevented)
```

#### File Operations

##### CreateFile
```go
func (fs *FileSystem) CreateFile(path string) error
```

**Behavior:**
- Creates empty file
- Fails if file already exists (prevents accidental overwrites)
- Creates parent directories automatically (via `os.Create`)

**Existence Check:**
```
CreateFile("existing.txt"):
  │
  ├─ getFileInfo(path)
  │    info != nil && info.Mode().IsRegular()
  │
  ├─ Return error: "already exists" ✗
  │
  └─ os.Create never called (prevented)
```

**Use Case in ChunkServer:**
```go
// Initialize new chunk file
chunkPath := fmt.Sprintf("chunks/%d/%d.chunk", handle, version)
fs.CreateFile(chunkPath)
```

##### GetFile
```go
func (fs *FileSystem) GetFile(path string, flag int, mode os.FileMode) (*os.File, error)
```

**Flags:**
- `os.O_RDONLY`: Read-only access
- `os.O_WRONLY`: Write-only access
- `os.O_RDWR`: Read-write access
- `os.O_APPEND`: Append mode
- `os.O_CREATE`: Create if not exists
- `os.O_TRUNC`: Truncate on open

**Validation:**
```
GetFile("chunk.dat", os.O_RDWR, 0644):
  │
  ├─ restrictToRoot("chunk.dat")
  │
  ├─ getFileInfo(path)
  │    info.Mode().IsDir() → check if directory
  │
  ├─ If directory → error ✗
  │
  ├─ os.OpenFile(path, flag, mode)
  │
  └─ Return *os.File ✓
```

**Important:** Caller is responsible for closing the returned file.

**Usage Pattern:**
```go
file, err := fs.GetFile("chunk.dat", os.O_RDWR, 0644)
if err != nil {
    return err
}
defer file.Close()

// Use file...
```

##### RemoveFile
```go
func (fs *FileSystem) RemoveFile(path string) error
```

**Type Safety:**
- Only removes regular files
- Fails for directories (prevents accidental recursive deletion)

**Validation:**
```
RemoveFile("directory/"):
  │
  ├─ getFileInfo(path)
  │    info.Mode().IsRegular() → false
  │
  ├─ Return error: "not a regular file" ✗
  │
  └─ os.Remove never called (prevented)
```

##### Rename
```go
func (fs *FileSystem) Rename(oldPath, newPath string) error
```

**Atomic Operation:** Uses `os.Rename` which is atomic on most filesystems

**Validation:**
```
Rename("old.txt", "new.txt"):
  │
  ├─ restrictToRoot("old.txt")
  ├─ restrictToRoot("new.txt")
  │
  ├─ Check old path exists
  │    os.IsNotExist → error ✗
  │
  ├─ Check new path doesn't exist (optional in code)
  │
  ├─ os.Rename(oldPath, newPath)
  │    Atomic operation on filesystem
  │
  └─ Success ✓
```

**Use Case in ChunkServer:**
```go
// Atomic chunk version update
tempPath := fmt.Sprintf("chunks/%d/.tmp_%d", handle, newVersion)
finalPath := fmt.Sprintf("chunks/%d/%d.chunk", handle, newVersion)

// Write to temp file, then atomically rename
fs.Rename(tempPath, finalPath)
```

#### Utility Methods

##### GetStat
```go
func (fs *FileSystem) GetStat(path string) (fs.FileInfo, error)
```

**Returns:**
- `FileInfo` interface providing:
  - `Name()`: Base name
  - `Size()`: File size in bytes
  - `Mode()`: Permission and mode bits
  - `ModTime()`: Modification time
  - `IsDir()`: Whether path is directory
  - `Sys()`: Underlying system-specific data

**Use Cases:**
- Check if file/directory exists
- Get file size for chunk metadata
- Determine if path is file or directory

## Operational Semantics

### Concurrency Model

#### Single-Writer, Multiple-Reader Problem

**Current Implementation:** Exclusive locks for all operations

```
Sequential Execution:
    Thread A: CreateFile ─────┐
                               │
    Thread B: GetStat ─────────┴──┐
                                   │
    Thread C: RemoveFile ──────────┴──┐
                                       │
    Total Time: T_A + T_B + T_C       ▼
```

**Alternative (Not Implemented):** Read-Write Mutex

```
Parallel Execution (if using RWMutex):
    Thread A: CreateFile ─────────┐ (write lock)
                                   │
    Thread B: GetStat ──────────┐ │ (read lock, blocked)
                                │ │
    Thread C: GetStat ──────────┤ │ (read lock, blocked)
                                ▼ ▼
    Total Time: T_A + max(T_B, T_C)
```

**Why Not Implemented:**
- Minimal concurrency in typical ChunkServer workload
- All operations modify filesystem state (even reads update atime)
- Simpler reasoning about operation ordering
- Lower implementation complexity

### Error Handling Strategy

#### Error Categories

1. **Security Errors:** Path traversal attempts
2. **Validation Errors:** Type mismatches (file vs directory)
3. **Existence Errors:** Path not found or already exists
4. **Permission Errors:** OS-level access denied
5. **System Errors:** Disk full, I/O errors

#### Error Responses

```go
// Security Error
error: "provided path ../../../etc/passwd is restricted to the filesystem root"

// Validation Error
error: "path /data/chunks/dir is not a regular file"

// Existence Error
error: "old path /data/chunks/missing.txt does not exist"

// System Error (from OS)
error: "failed to open file /data/chunks/file.txt: permission denied"
```

#### Error Handling Best Practices

```go
// Always check errors
if err := fs.CreateFile(path); err != nil {
    if os.IsExist(err) {
        // Handle existing file
    } else if os.IsPermission(err) {
        // Handle permission denied
    } else {
        // Handle other errors
    }
}

// Files must be closed
file, err := fs.GetFile(path, os.O_RDONLY, 0)
if err != nil {
    return err
}
defer file.Close()  // Ensures cleanup even on panic
```

## Security Analysis

### Threat Model

**Attacker Goals:**
1. Read sensitive files outside sandbox (`/etc/passwd`, `~/.ssh/id_rsa`)
2. Modify system files (`/etc/hosts`)
3. Escape sandbox to arbitrary filesystem locations
4. Cause denial of service (disk exhaustion, infinite loops)

**Attack Vectors:**

#### 1. Directory Traversal

**Attack:**
```go
fs.CreateFile("../../../etc/cron.d/malicious")
```

**Defense:**
```
restrictToRoot("../../../etc/cron.d/malicious"):
  │
  ├─ filepath.Join("/data/chunks", filepath.Clean("../../../etc/cron.d/malicious"))
  │    cleaned: "../../../etc/cron.d/malicious"
  │    joined: "/data/chunks/../../../etc/cron.d/malicious"
  │    → final clean: "/etc/cron.d/malicious"
  │
  ├─ strings.HasPrefix("/etc/cron.d/malicious", "/data/chunks")
  │    → false
  │
  └─ Return error ✓ (blocked)
```

#### 2. Absolute Paths

**Attack:**
```go
fs.RemoveFile("/etc/passwd")
```

**Defense:**
```
restrictToRoot("/etc/passwd"):
  │
  ├─ filepath.Join("/data/chunks", filepath.Clean("/etc/passwd"))
  │    → "/data/chunks/etc/passwd"
  │
  ├─ strings.HasPrefix("/data/chunks/etc/passwd", "/data/chunks")
  │    → true ✓
  │
  └─ Attempts to remove "/data/chunks/etc/passwd" (safe)
```

**Result:** Attacker can only affect files within sandbox.

#### 3. Symlink Attacks

**Attack:**
```bash
# Outside FileSystem: Create symlink
ln -s /etc/passwd /data/chunks/symlink

# Via FileSystem:
fs.GetFile("symlink", os.O_RDONLY, 0)
```

**Current State:** 
- `restrictToRoot` doesn't follow symlinks in path
- `os.OpenFile` **does** follow symlinks
- **Vulnerability:** Can read outside sandbox via symlinks

**Mitigation Options:**

1. **Disable symlink following:**
```go
// Use lstat instead of stat to detect symlinks
info, err := os.Lstat(path)
if err != nil {
    return nil, err
}
if info.Mode()&os.ModeSymlink != 0 {
    return nil, fmt.Errorf("symlinks not allowed")
}
```

2. **Validate target:**
```go
realPath, err := filepath.EvalSymlinks(path)
if err != nil {
    return nil, err
}
if !strings.HasPrefix(realPath, fs.root) {
    return nil, fmt.Errorf("symlink target outside sandbox")
}
```

3. **Open with O_NOFOLLOW (platform-specific):**
```go
// Platform-specific values:
// Linux: 0x20000
// macOS: 0x0100
// Note: Not available on Windows
const O_NOFOLLOW = 0x20000  // Linux
file, err := os.OpenFile(path, flag|O_NOFOLLOW, mode)
```

**⚠️ SECURITY WARNING:**

The current implementation is **vulnerable to symlink attacks** in multi-tenant environments. An attacker with write access to the root directory can create symlinks pointing outside the sandbox, allowing them to read or modify files beyond the intended boundaries.

**For production use, you MUST:**
- Implement symlink validation (option 2 recommended - validate target path)
- Run FileSystem with a dedicated user account with minimal permissions
- Apply OS-level restrictions (AppArmor/SELinux profiles on Linux, sandboxing on macOS)
- Regularly audit the root directory for unexpected symlinks

**Recommendation:** Implement symlink validation before deploying to production.

### Permission Model

**Current Permissions:**
```go
const filePerm = 0777  // Owner: rwx, Group: rwx, Others: rwx
```

**Effective Permissions:**
```
Created with 0777, respects umask:
    umask 0022: Files → 0755 (rwxr-xr-x)
    umask 0077: Files → 0700 (rwx------)
```

**Security Implications:**

| Setting | Security | Usability |
|---------|----------|-----------|
| 0777 | Low (world-writable) | High (no permission issues) |
| 0750 | Medium (group-readable) | Medium (requires group membership) |
| 0700 | High (owner-only) | Low (single user only) |

**Recommendation for Production:**

*Note: Current implementation uses 0777. The following values are recommended for production deployments:*

```go
const (
    dirPerm  = 0750  // Owner: rwx, Group: r-x, Others: ---
    filePerm = 0640  // Owner: rw-, Group: r--, Others: ---
)
```

## Performance Characteristics

### Time Complexity

| Operation | Avg Case | Worst Case | Notes |
|-----------|----------|------------|-------|
| `MkDir` | O(d) | O(d) | d = directory depth |
| `CreateFile` | O(1) | O(d) | d = depth if creating parents |
| `GetFile` | O(1) | O(1) | File lookup |
| `RemoveFile` | O(1) | O(1) | Single file removal |
| `RemoveDir` | O(n) | O(n) | n = files in directory tree |
| `Rename` | O(1) | O(1) | Atomic operation |
| `GetStat` | O(1) | O(1) | Metadata lookup |
| `restrictToRoot` | O(p) | O(p) | p = path length (string ops) |

### Lock Contention Analysis

**Contention Probability:**
```
P(contention) = (N * T_op) / T_interval

Where:
- N = number of concurrent threads
- T_op = average operation duration
- T_interval = time between operations

Example (ChunkServer):
- N = 10 concurrent writes
- T_op = 1ms (file creation)
- T_interval = 100ms (writes every 100ms)
P(contention) = (10 * 1ms) / 100ms = 10% ← Low contention
```

**Typical Performance (SSD, example values):**

```
BenchmarkCreateFile-8      100000    12000 ns/op  (~12 μs)
BenchmarkGetFile-8         200000     8000 ns/op  (~8 μs)
BenchmarkRemoveFile-8      100000    10000 ns/op  (~10 μs)
BenchmarkMkDir-8           100000    15000 ns/op  (~15 μs)
BenchmarkGetStat-8        1000000     1200 ns/op  (~1.2 μs)
```

**Note:** Run your own benchmarks using `go test -bench=. -benchmem` to get actual performance data for your specific hardware and workload.

**Bottlenecks:**
1. Disk I/O (dominates operation time)
2. Mutex contention (minimal for typical workload)
3. Path validation overhead (negligible)

### Memory Usage

**Per FileSystem Instance:**
```
sizeof(FileSystem) = sizeof(sync.Mutex) + sizeof(string)
                   ≈ 24 bytes + len(root)
                   ≈ 24 + 50 bytes (typical)
                   ≈ 74 bytes

Negligible memory overhead.
```

**File Handle Management:**
- `GetFile` returns `*os.File` (caller owns)
- OS limits: typically 1024-65536 open files per process
- **Critical:** Always close files in caller

## Integration with ChunkServer

### Chunk Storage Layout

```
Root: /data/chunks
├── chunk_12345/
│   ├── v1.chunk       (Version 1 data)
│   ├── v2.chunk       (Version 2 data)
│   └── .tmp_v3        (Temporary write)
├── chunk_12346/
│   └── v1.chunk
└── metadata/
    ├── lease.dat
    └── version.dat
```

### Typical Operations

#### Chunk Creation
```go
func (cs *ChunkServer) createChunk(handle ChunkHandle) error {
    chunkDir := fmt.Sprintf("chunk_%d", handle)
    if err := cs.fs.MkDir(chunkDir); err != nil {
        return err
    }
    
    chunkPath := fmt.Sprintf("%s/v1.chunk", chunkDir)
    if err := cs.fs.CreateFile(chunkPath); err != nil {
        return err
    }
    
    return nil
}
```

#### Chunk Write (Atomic Update)
```go
func (cs *ChunkServer) writeChunk(handle ChunkHandle, version int, data []byte) error {
    tempPath := fmt.Sprintf("chunk_%d/.tmp_v%d", handle, version)
    finalPath := fmt.Sprintf("chunk_%d/v%d.chunk", handle, version)
    
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

#### Chunk Read
```go
func (cs *ChunkServer) readChunk(handle ChunkHandle, version int) ([]byte, error) {
    chunkPath := fmt.Sprintf("chunk_%d/v%d.chunk", handle, version)
    
    file, err := cs.fs.GetFile(chunkPath, os.O_RDONLY, 0)
    if err != nil {
        return nil, err
    }
    defer file.Close()
    
    return io.ReadAll(file)
}
```

#### Chunk Deletion (Garbage Collection)
```go
func (cs *ChunkServer) deleteChunk(handle ChunkHandle) error {
    chunkDir := fmt.Sprintf("chunk_%d", handle)
    return cs.fs.RemoveDir(chunkDir)
}
```

## Testing Strategy

### Unit Tests

**Coverage Areas:**
1. **Path Validation:** Traversal attacks, absolute paths
2. **Directory Operations:** Create, remove, stat
3. **File Operations:** Create, get, remove, rename
4. **Error Handling:** Nonexistent paths, permission errors
5. **Idempotency:** Repeated operations
6. **Concurrency:** Parallel access (race detector)

**Test Structure:**
```go
func setupTestFS(t *testing.T) (*FileSystem, func())
    → Creates temp directory
    → Returns cleanup function
    → Uses require for fatal errors
```

**Example Test:**
```go
func TestCreateFile(t *testing.T) {
    fs, cleanup := setupTestFS(t)
    defer cleanup()
    
    // Test creation
    err := fs.CreateFile("test.txt")
    assert.NoError(t, err)
    
    // Test duplicate creation
    err = fs.CreateFile("test.txt")
    assert.Error(t, err)  // Should fail
}
```

### Security Tests

**Test Cases:**
- Directory traversal: `../../../etc/passwd`
- Absolute paths: `/etc/passwd`
- Complex traversal: `dir/../../etc/passwd`
- Empty paths: `""`
- Current directory: `.`
- Symlink attacks (if mitigation added)

### Concurrency Tests

```go
func TestConcurrentAccess(t *testing.T) {
    fs, cleanup := setupTestFS(t)
    defer cleanup()
    
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            path := fmt.Sprintf("file_%d.txt", id)
            fs.CreateFile(path)
        }(i)
    }
    wg.Wait()
    
    // Verify all files created
    // Run with: go test -race
}
```

## Production Readiness Checklist

Before deploying FileSystem in production environments, ensure the following items are addressed:

### Security
- [ ] **Symlink Protection**: Implement symlink validation (see Security Analysis section)
- [ ] **Permission Hardening**: Change `filePerm` from `0777` to restrictive values (e.g., `0640`)
- [ ] **Root Directory Validation**: Verify root directory exists with correct ownership and permissions
- [ ] **Path Sanitization Review**: Audit `restrictToRoot()` implementation for edge cases

### Operational
- [ ] **Resource Limits**: Configure OS-level disk quotas to prevent exhaustion
- [ ] **Monitoring**: Add metrics for operation latency, error rates, and file handle count
- [ ] **Audit Logging**: Log security-relevant operations (file deletions, renames, access denials)
- [ ] **Error Handling**: Implement structured error types with sufficient context

### Testing
- [ ] **Race Detection**: Run all tests with `go test -race`
- [ ] **Load Testing**: Verify performance under concurrent access patterns
- [ ] **Security Testing**: Test path traversal protection with fuzzing
- [ ] **Failure Scenarios**: Test behavior under disk full, permission denied conditions

### Performance
- [ ] **Benchmark**: Run actual benchmarks on target hardware
- [ ] **Profile**: Identify bottlenecks using `pprof` under realistic workloads
- [ ] **Lock Contention**: Measure mutex contention with production traffic patterns
- [ ] **File Handle Leaks**: Monitor for unclosed file descriptors

### Documentation
- [ ] **Operational Runbook**: Document common issues and resolution steps
- [ ] **Security Policy**: Define access control requirements and audit procedures
- [ ] **Disaster Recovery**: Plan for corrupted filesystems, disk failures

## Future Enhancements

### 1. Symlink Protection

Add validation to prevent symlink escape:

```go
func (fs *FileSystem) restrictToRoot(path string) (string, error) {
    path = filepath.Join(fs.root, filepath.Clean(path))
    
    // Resolve symlinks
    realPath, err := filepath.EvalSymlinks(path)
    if err != nil && !os.IsNotExist(err) {
        return "", err
    }
    
    if realPath != "" && !strings.HasPrefix(realPath, fs.root) {
        return "", fmt.Errorf("symlink points outside sandbox")
    }
    
    if !strings.HasPrefix(path, fs.root) {
        return "", fmt.Errorf("path outside sandbox")
    }
    
    return path, nil
}
```

### 2. Quota Management

Enforce storage limits per FileSystem:

```go
type FileSystem struct {
    mu        sync.Mutex
    root      string
    quota     int64  // Maximum bytes
    used      int64  // Current usage
}

func (fs *FileSystem) checkQuota(size int64) error {
    if fs.used + size > fs.quota {
        return fmt.Errorf("quota exceeded")
    }
    return nil
}
```

### 3. Read-Write Mutex

Optimize for concurrent reads:

```go
type FileSystem struct {
    mu   sync.RWMutex  // Changed from sync.Mutex
    root string
}

func (fs *FileSystem) GetStat(path string) (fs.FileInfo, error) {
    fs.mu.RLock()  // Read lock for non-mutating operation
    defer fs.mu.RUnlock()
    // ... implementation
}
```

### 4. Operation Auditing

Log all filesystem operations:

```go
type FileSystem struct {
    mu      sync.Mutex
    root    string
    logger  *log.Logger
}

func (fs *FileSystem) CreateFile(path string) error {
    fs.logger.Printf("CreateFile: %s", path)
    // ... implementation
}
```

### 5. Atomic Batch Operations

Support multiple operations atomically:

```go
func (fs *FileSystem) Batch(ops []Operation) error {
    fs.mu.Lock()
    defer fs.mu.Unlock()
    
    // Execute all operations
    // Roll back on any failure
}
```

## Limitations

### 1. Coarse-Grained Locking

**Impact:** Serializes all operations, even reads

**Acceptable When:**
- Operations are fast (< 10ms typical)
- Concurrency is low (< 10 concurrent threads)
- Correctness > throughput

**Problem When:**
- High-frequency reads (metadata queries)
- Many concurrent clients
- Long-running operations

### 2. No Quota Enforcement

**Impact:** Can fill disk without limit

**Mitigation:**
- OS-level quotas
- External monitoring
- Periodic cleanup

### 3. Limited Error Context

**Impact:** Hard to diagnose failures

**Example:**
```go
// Current
error: "failed to open file: permission denied"

// Better
error: "failed to open file /data/chunks/chunk_123/v5.chunk: permission denied (uid=1000, mode=0600, owner=0)"
```

### 4. No Transaction Support

**Impact:** No rollback for multi-step operations

**Example Failure:**
```go
fs.MkDir("dir")       // ✓ succeeds
fs.CreateFile("dir/file1")  // ✓ succeeds
fs.CreateFile("dir/file2")  // ✗ fails
// dir and file1 remain (no rollback)
```

## References

- Go `filepath` package: Path manipulation and security
- Go `os` package: File operations
- POSIX filesystem semantics
- [Path Traversal Attack Prevention](https://owasp.org/www-community/attacks/Path_Traversal)
- ChunkServer Design: Integration context
- Google File System Paper (2003)
