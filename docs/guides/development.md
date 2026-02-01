# Development Guide

This guide helps developers set up their environment, understand the codebase, and contribute to Hercules.

## Development Setup

### Prerequisites

- **Go**: 1.18 or higher
- **Git**: For version control
- **Make**: For build automation
- **Redis**: For failure detection (can use Docker)
- **Python**: 3.8+ (optional, for plotting/testing scripts)
- **IDE**: VS Code, GoLand, or your preferred Go IDE

### Clone Repository

```bash
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs
```

### Install Dependencies

```bash
# Install Go dependencies
go mod download
go mod verify

# Optional: Install Python dependencies
pip install -r requirements.txt
```

### Start Redis (for failure detection)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:latest

# Or install locally (macOS)
brew install redis
redis-server
```

### Build Project

```bash
# Build all components
go build -o bin/hercules main.go

# Or use Make
make build
```

## Project Structure

```
hercules/
├── main.go                 # Entry point
├── go.mod                  # Go module definition
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # Docker orchestration
├── Makefile               # Build automation
│
├── master_server/         # Master server implementation
│   ├── master_server.go
│   ├── cs_manager.go      # Chunkserver manager
│   └── master_server_test.go
│
├── chunkserver/           # Chunkserver implementation
│   ├── chunkserver.go
│   └── chunkserver_test.go
│
├── gateway/               # HTTP gateway
│   ├── server.go
│   └── server_test.go
│
├── hercules/              # Client SDK
│   ├── hercules.go
│   └── hercules_test.go
│
├── namespace_manager/     # File/directory management
│   ├── nsmanager.go
│   └── nsmanager_test.go
│
├── failure_detector/      # φ Accrual failure detection
│   ├── failure_detector.go
│   ├── sampling_window.go
│   └── tests/
│
├── archive_manager/       # Snapshot/archival
│   └── archiver_manager.go
│
├── download_buffer/       # Temporary data storage
│   └── download_buffer.go
│
├── file_system/           # File system abstraction
│   └── file_system.go
│
├── common/                # Shared types and constants
│   ├── types.go
│   └── constants.go
│
├── rpc_struct/            # RPC request/response structures
│   ├── structs.go
│   └── handlers.go
│
├── utils/                 # Utility functions
│   ├── queue.go
│   ├── bqueue.go
│   └── helpers.go
│
├── plotter/               # Visualization tools
│   └── plotter.go
│
├── docs/                  # Documentation
│   ├── README.md
│   ├── architecture/
│   ├── api/
│   ├── deployment/
│   └── guides/
│
└── example/               # Example applications
    └── photos/            # Photo library example
```

## Running Locally

### Option 1: Single Process (for debugging)

```bash
# Terminal 1: Start Master
go run main.go \
  -ServerType master_server \
  -serverAddr 127.0.0.1:9090 \
  -rootDir ./data/master \
  -logLevel debug

# Terminal 2: Start Chunkserver 1
go run main.go \
  -ServerType chunk_server \
  -serverAddr 127.0.0.1:8081 \
  -masterAddr 127.0.0.1:9090 \
  -redisAddr 127.0.0.1:6379 \
  -rootDir ./data/chunk1 \
  -logLevel debug

# Terminal 3: Start Chunkserver 2
go run main.go \
  -ServerType chunk_server \
  -serverAddr 127.0.0.1:8082 \
  -masterAddr 127.0.0.1:9090 \
  -redisAddr 127.0.0.1:6379 \
  -rootDir ./data/chunk2 \
  -logLevel debug

# Terminal 4: Start Gateway
go run main.go \
  -ServerType gateway_server \
  -gatewayAddr 8089 \
  -masterAddr 127.0.0.1:9090 \
  -logLevel debug
```

### Option 2: Using Docker Compose

```bash
docker-compose up --build
```

### Option 3: Using Make

```bash
# Build and run
make build
make run-master &
make run-chunk1 &
make run-chunk2 &
make run-gateway &
```

## Testing

### Run All Tests

```bash
# Run all tests
go test ./...

# With verbose output
go test -v ./...

# With coverage
go test -cover ./...

# Generate coverage report
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Run Specific Tests

```bash
# Test master server
go test -v ./master_server

# Test chunkserver
go test -v ./chunkserver

# Test namespace manager
go test -v ./namespace_manager

# Test failure detector
go test -v ./failure_detector
```

### Integration Tests

```bash
# Run integration tests (requires running services)
python dtest.py

# Or use the notebook
jupyter notebook hercules/ground_zero.ipynb
```

### Benchmarks

```bash
# Run benchmarks
go test -bench=. -benchmem ./...

# Specific benchmark
go test -bench=BenchmarkWrite -benchmem ./chunkserver
```

## Code Style

### Go Formatting

```bash
# Format all code
go fmt ./...

# Check formatting
gofmt -l .

# Use goimports (includes fmt + import organization)
goimports -w .
```

### Linting

```bash
# Install golangci-lint
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Run linter
golangci-lint run

# Run with auto-fix
golangci-lint run --fix
```

### Code Review Checklist

- [ ] Code is formatted with `go fmt`
- [ ] No linting errors
- [ ] All tests pass
- [ ] New tests added for new features
- [ ] Comments added for exported functions
- [ ] Error handling is appropriate
- [ ] Logging at appropriate levels
- [ ] No hardcoded values (use constants)
- [ ] Resource cleanup (defer close)
- [ ] Concurrency safety (locks where needed)

## Debugging

### Using Delve

```bash
# Install Delve
go install github.com/go-delve/delve/cmd/dlv@latest

# Debug master server
dlv debug main.go -- \
  -ServerType master_server \
  -serverAddr 127.0.0.1:9090 \
  -rootDir ./data/master

# Set breakpoint
(dlv) break master_server.go:100
(dlv) continue
```

### Logging Levels

```bash
# Debug: Very verbose, for development
-logLevel debug

# Info: General information, default
-logLevel info

# Warn: Warning messages
-logLevel warn

# Error: Error messages only
-logLevel error
```

### Common Debug Scenarios

#### Master Not Starting
```bash
# Check port availability
lsof -i :9090

# Check logs
tail -f data/master/hercules.log

# Increase log level
-logLevel debug
```

#### Chunkserver Not Registering
```bash
# Verify master is running
nc -zv 127.0.0.1 9090

# Check chunkserver logs
# Look for heartbeat failures

# Verify Redis connection
redis-cli ping
```

#### Data Not Persisting
```bash
# Check file permissions
ls -la data/

# Check disk space
df -h

# Verify metadata files
ls -la data/master/master.server.meta
ls -la data/chunk1/chunk.server.meta
```

## Development Workflow

### 1. Create Feature Branch

```bash
git checkout -b feature/my-feature
```

### 2. Make Changes

- Follow code style guidelines
- Add tests for new functionality
- Update documentation

### 3. Test Changes

```bash
# Run tests
go test ./...

# Run linter
golangci-lint run

# Test manually
docker-compose up --build
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: add new feature

- Implemented X
- Fixed Y
- Updated docs"
```

Commit message format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `test:` Adding tests
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `chore:` Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create Pull Request on GitHub.

## Common Development Tasks

### Adding New RPC Method

1. Define structs in `rpc_struct/structs.go`:
```go
type MyNewArg struct {
    Param1 string
    Param2 int
}

type MyNewReply struct {
    Result string
    ErrorCode common.ErrorCode
}
```

2. Implement method in server (master or chunkserver):
```go
func (ms *MasterServer) MyNewMethod(arg *rpc_struct.MyNewArg, reply *rpc_struct.MyNewReply) error {
    // Implementation
    reply.Result = "success"
    reply.ErrorCode = common.Success
    return nil
}
```

3. Add client method in `hercules/hercules.go`:
```go
func (c *HerculesClient) MyNewMethod(param1 string, param2 int) (string, error) {
    arg := &rpc_struct.MyNewArg{
        Param1: param1,
        Param2: param2,
    }
    reply := &rpc_struct.MyNewReply{}
    
    err := c.masterClient.Call("MasterServer.MyNewMethod", arg, reply)
    if err != nil {
        return "", err
    }
    
    return reply.Result, nil
}
```

### Adding New HTTP Endpoint

1. Add route in `gateway/server.go`:
```go
router.GET("/api/v1/my-endpoint", gateway.handleMyEndpoint)
```

2. Implement handler:
```go
func (g *HerculesHTTPGateway) handleMyEndpoint(c *gin.Context) {
    // Get parameters
    param := c.Query("param")
    
    // Call SDK method
    result, err := g.client.MyNewMethod(param, 123)
    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(200, gin.H{"result": result})
}
```

### Modifying Chunk Size

In `common/constants.go`:
```go
const (
    ChunkMaxSizeInMb   = 128  // Change from 64 to 128
    ChunkMaxSizeInByte = 128 << 20
)
```

**Warning**: Changing chunk size requires recreating all data.

### Adding New Failure Detection Algorithm

1. Create new detector in `failure_detector/`:
```go
type MyDetector struct {
    // fields
}

func (d *MyDetector) Predict() Prediction {
    // implementation
}
```

2. Update chunkserver to use new detector

### Performance Profiling

```bash
# CPU profiling
go test -cpuprofile=cpu.prof -bench=. ./chunkserver
go tool pprof cpu.prof

# Memory profiling
go test -memprofile=mem.prof -bench=. ./chunkserver
go tool pprof mem.prof

# Web interface
go tool pprof -http=:8080 cpu.prof
```

## IDE Setup

### VS Code

Recommended extensions:
- Go (golang.go)
- Go Test Explorer
- Docker
- YAML

Settings (`.vscode/settings.json`):
```json
{
  "go.useLanguageServer": true,
  "go.lintTool": "golangci-lint",
  "go.lintOnSave": "package",
  "go.formatTool": "goimports",
  "editor.formatOnSave": true
}
```

### GoLand

- Enable Go modules support
- Configure code style to match project
- Set up run configurations for each component

## Resources

### Learning Materials

- [Original GFS Paper](https://research.google/pubs/pub51/)
- [Go Documentation](https://golang.org/doc/)
- [Distributed Systems Concepts](https://www.distributed-systems.net/)

### Related Projects

- [GFS Implementation in Go](https://github.com/topics/gfs)
- [HDFS](https://hadoop.apache.org/docs/r1.2.1/hdfs_design.html)
- [Ceph](https://ceph.io/)

## Getting Help

- Check [FAQ](faq.md)
- Search [GitHub Issues](https://github.com/caleberi/hercules-dfs/issues)
- Join [Discussions](https://github.com/caleberi/hercules-dfs/discussions)
- Read the [Architecture docs](../architecture/overview.md)

## Next Steps

- [Contributing Guidelines](contributing.md)
- [Testing Guide](testing.md)
- [API Documentation](../api/)
