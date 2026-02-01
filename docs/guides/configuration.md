# Configuration Reference

Complete reference for all configuration options in Hercules.

## Command-Line Flags

### Common Flags (All Servers)

#### `-ServerType`
**Type**: `string`  
**Default**: `chunk_server`  
**Valid Values**: `master_server`, `chunk_server`, `gateway_server`  
**Description**: Specifies which type of server to run.

**Example**:
```bash
go run main.go -ServerType master_server
```

---

#### `-logLevel`
**Type**: `string`  
**Default**: `debug`  
**Valid Values**: `debug`, `info`, `warn`, `error`  
**Description**: Sets the logging verbosity level.

**Example**:
```bash
go run main.go -logLevel info
```

**Log Levels**:
- `debug`: Very verbose, shows all operations
- `info`: General information (recommended for production)
- `warn`: Warning messages only
- `error`: Error messages only

---

#### `-rootDir`
**Type**: `string`  
**Default**: `mroot`  
**Description**: Root directory for data storage. Will be created if it doesn't exist.

**Example**:
```bash
go run main.go -rootDir /var/lib/hercules/data
```

---

### Master Server Flags

#### `-serverAddr`
**Type**: `string`  
**Default**: `127.0.0.1:9090`  
**Description**: Address and port for the master server to listen on.

**Example**:
```bash
go run main.go \
  -ServerType master_server \
  -serverAddr 0.0.0.0:9090
```

---

### Chunkserver Flags

#### `-serverAddr`
**Type**: `string`  
**Default**: `127.0.0.1:8085`  
**Description**: Address and port for the chunkserver to listen on.

**Example**:
```bash
go run main.go \
  -ServerType chunk_server \
  -serverAddr 0.0.0.0:8081
```

---

#### `-masterAddr`
**Type**: `string`  
**Default**: `127.0.0.1:9090`  
**Description**: Address of the master server to connect to.

**Example**:
```bash
go run main.go \
  -ServerType chunk_server \
  -masterAddr master.example.com:9090
```

---

#### `-redisAddr`
**Type**: `string`  
**Default**: `127.0.0.1:6379`  
**Description**: Address of Redis server for failure detection.

**Example**:
```bash
go run main.go \
  -ServerType chunk_server \
  -redisAddr redis.example.com:6379
```

---

### Gateway Server Flags

#### `-gatewayAddr`
**Type**: `int`  
**Default**: `8089`  
**Description**: Port number for HTTP gateway server.

**Example**:
```bash
go run main.go \
  -ServerType gateway_server \
  -gatewayAddr 8080
```

---

#### `-masterAddr`
**Type**: `string`  
**Default**: `127.0.0.1:9090`  
**Description**: Address of the master server.

**Example**:
```bash
go run main.go \
  -ServerType gateway_server \
  -masterAddr master.example.com:9090
```

---

## Environment Variables

Environment variables can be used instead of command-line flags (Docker preferred method).

### Master Server

| Variable | Equivalent Flag | Default | Description |
|----------|----------------|---------|-------------|
| `SERVER_TYPE` | `-ServerType` | `master_server` | Server type |
| `SERVER_ADDRESS` | `-serverAddr` | `127.0.0.1:9090` | Listen address |
| `ROOT_DIR` | `-rootDir` | `./data/master` | Data directory |
| `LOG_LEVEL` | `-logLevel` | `info` | Log level |

**Example**:
```bash
export SERVER_TYPE=master_server
export SERVER_ADDRESS=0.0.0.0:9090
export ROOT_DIR=/var/lib/hercules/master
export LOG_LEVEL=info
./hercules
```

---

### Chunkserver

| Variable | Equivalent Flag | Default | Description |
|----------|----------------|---------|-------------|
| `SERVER_TYPE` | `-ServerType` | `chunk_server` | Server type |
| `SERVER_ADDRESS` | `-serverAddr` | `127.0.0.1:8081` | Listen address |
| `MASTER_ADDR` | `-masterAddr` | `127.0.0.1:9090` | Master address |
| `REDIS_ADDR` | `-redisAddr` | `127.0.0.1:6379` | Redis address |
| `ROOT_DIR` | `-rootDir` | `./data/chunks` | Data directory |
| `LOG_LEVEL` | `-logLevel` | `info` | Log level |

**Example**:
```bash
export SERVER_TYPE=chunk_server
export SERVER_ADDRESS=0.0.0.0:8081
export MASTER_ADDR=master:9090
export REDIS_ADDR=redis:6379
export ROOT_DIR=/var/lib/hercules/chunks
export LOG_LEVEL=info
./hercules
```

---

### Gateway Server

| Variable | Equivalent Flag | Default | Description |
|----------|----------------|---------|-------------|
| `SERVER_TYPE` | `-ServerType` | `gateway_server` | Server type |
| `GATEWAY_ADDR` | `-gatewayAddr` | `8089` | HTTP port |
| `MASTER_ADDR` | `-masterAddr` | `127.0.0.1:9090` | Master address |
| `LOG_LEVEL` | `-logLevel` | `info` | Log level |

**Example**:
```bash
export SERVER_TYPE=gateway_server
export GATEWAY_ADDR=8089
export MASTER_ADDR=master:9090
export LOG_LEVEL=info
./hercules
```

---

## System Constants

These constants are defined in `common/constants.go` and require code changes to modify.

### Chunk Configuration

```go
const (
    // Chunk size
    ChunkMaxSizeInMb   = 64           // 64 MB per chunk
    ChunkMaxSizeInByte = 64 << 20     // 67,108,864 bytes
    
    // Append limits
    AppendMaxSizeInByte = ChunkMaxSizeInByte / 4  // 16 MB max append
    
    // File names
    ChunkFileNameFormat   = "chunk-%v.chk"        // chunk-{handle}.chk
    ChunkMetaDataFileName = "chunk.server.meta"   // metadata file
)
```

**To Change**: Edit `common/constants.go` and rebuild.

---

### Replication

```go
const (
    MinimumReplicationFactor = 3  // Minimum copies of each chunk
)
```

**Note**: Actual replication factor is determined at runtime based on available chunkservers.

---

### Timeouts and Intervals

#### Master Server

```go
const (
    ServerHealthCheckInterval = 10 * time.Second  // Check chunkserver health
    ServerHealthCheckTimeout  = 60 * time.Second  // Mark dead if no heartbeat
    MasterPersistMetaInterval = 15 * time.Hour    // Save metadata to disk
    LeaseTimeout             = 60 * time.Second   // Lease duration
)
```

#### Chunkserver

```go
const (
    HeartBeatInterval         = 5 * time.Second   // Send heartbeat to master
    GarbageCollectionInterval = 5 * time.Minute   // Clean up deleted chunks
    PersistMetaDataInterval   = 10 * time.Minute  // Save metadata to disk
)
```

#### Failure Detection

```go
const (
    FailureDetectorKeyExpiryTime = 5 * time.Minute  // Redis key TTL
)
```

#### Download Buffer

```go
const (
    DownloadBufferItemExpire = 10 * time.Second  // Buffer entry expiration
    DownloadBufferTick       = 10 * time.Second  // Cleanup interval
)
```

#### Archival

```go
const (
    ArchivalDaySpan      = 5                          // Days between archives
    ArchiveChunkInterval = 5 * 24 * time.Hour         // Archive frequency
)
```

---

## Configuration Files

### Master Metadata File

**Location**: `{ROOT_DIR}/master.server.meta`

**Format**: Binary (GOB encoding)

**Contents**:
- Namespace tree
- File to chunk mappings
- Chunk locations
- Chunk versions

**When Created**: 
- On first run (empty)
- Periodically saved (every 15 hours)
- On graceful shutdown

**Recovery**: Automatically loaded on master startup.

---

### Chunkserver Metadata File

**Location**: `{ROOT_DIR}/chunk.server.meta`

**Format**: Binary (GOB encoding)

**Contents**:
- List of chunks on this server
- Chunk versions
- Chunk sizes
- Checksums
- Mutation logs

**When Created**:
- On first run (empty)
- Periodically saved (every 10 minutes)
- On graceful shutdown

**Recovery**: Automatically loaded on chunkserver startup.

---

### Chunk Files

**Location**: `{ROOT_DIR}/chunk-{handle}.chk`

**Format**: Binary (raw chunk data)

**Naming**: `chunk-12345.chk` (where 12345 is the chunk handle)

**Max Size**: 64 MB (ChunkMaxSizeInByte)

**Checksum**: Stored in metadata file

---

## Docker Configuration

### docker-compose.yml

Complete configuration example:

```yaml
version: '3.8'

services:
  master:
    image: hercules-master:latest
    container_name: hercules-master
    environment:
      SERVER_TYPE: master_server
      SERVER_ADDRESS: 0.0.0.0:9090
      ROOT_DIR: /data/master
      LOG_LEVEL: info
    ports:
      - "9090:9090"
    volumes:
      - master-data:/data/master
    networks:
      - hercules-net
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G

  chunkserver1:
    image: hercules-chunkserver:latest
    container_name: hercules-chunkserver1
    environment:
      SERVER_TYPE: chunk_server
      SERVER_ADDRESS: chunkserver1:8081
      MASTER_ADDR: master:9090
      REDIS_ADDR: redis:6379
      ROOT_DIR: /data/chunks
      LOG_LEVEL: info
    ports:
      - "8081:8081"
    volumes:
      - chunk1-data:/data/chunks
    networks:
      - hercules-net
    depends_on:
      - master
      - redis
    restart: unless-stopped

  gateway:
    image: hercules-gateway:latest
    container_name: hercules-gateway
    environment:
      SERVER_TYPE: gateway_server
      GATEWAY_ADDR: 8089
      MASTER_ADDR: master:9090
      LOG_LEVEL: info
    ports:
      - "8089:8089"
    networks:
      - hercules-net
    depends_on:
      - master
    restart: unless-stopped

  redis:
    image: redis:latest
    container_name: hercules-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - hercules-net
    restart: unless-stopped

volumes:
  master-data:
  chunk1-data:
  redis-data:

networks:
  hercules-net:
    driver: bridge
```

---

## Production Recommendations

### Master Server

```bash
SERVER_TYPE=master_server
SERVER_ADDRESS=0.0.0.0:9090
ROOT_DIR=/var/lib/hercules/master
LOG_LEVEL=info

# Resource allocation
CPU: 4+ cores
Memory: 8+ GB (depends on number of files)
Disk: SSD recommended for metadata
```

### Chunkserver

```bash
SERVER_TYPE=chunk_server
SERVER_ADDRESS=0.0.0.0:8081
MASTER_ADDR=master.internal:9090
REDIS_ADDR=redis.internal:6379
ROOT_DIR=/mnt/hercules/chunks
LOG_LEVEL=info

# Resource allocation
CPU: 2+ cores per chunkserver
Memory: 4+ GB per chunkserver
Disk: As much as needed for storage
Network: 10 Gbps recommended
```

### Gateway

```bash
SERVER_TYPE=gateway_server
GATEWAY_ADDR=8089
MASTER_ADDR=master.internal:9090
LOG_LEVEL=info

# Resource allocation
CPU: 4+ cores (handles HTTP traffic)
Memory: 4+ GB
Network: High bandwidth
```

---

## Tuning Guide

### For Small Files (< 1 MB average)

- Consider reducing `ChunkMaxSizeInMb` to 32 or 16
- Increases metadata overhead but reduces wasted space

### For Large Sequential Workloads

- Default 64 MB chunks are optimal
- Ensure sufficient network bandwidth between chunkservers

### For High Concurrent Appends

- Increase `MinimumReplicationFactor` for better availability
- Add more chunkservers to distribute load

### For Low-Latency Requirements

- Reduce `LeaseTimeout` for faster failover
- Increase `HeartBeatInterval` for quicker failure detection
- Use SSD for master metadata storage

### For High Availability

- Deploy master with replicated metadata (external solution)
- Run chunkservers across multiple availability zones
- Increase `MinimumReplicationFactor` to 4 or 5

---

## Security Configuration

### Network Security

```yaml
# Restrict network access
networks:
  hercules-net:
    driver: bridge
    internal: true  # No external access
```

### Container Security

```yaml
security_opt:
  - no-new-privileges:true
read_only: true
user: "1000:1000"  # Non-root user
```

### TLS Configuration (Future)

Currently not implemented. Plan to add:
- TLS for RPC communication
- Client certificate authentication
- Encrypted chunk storage

---

## Monitoring Configuration

### Prometheus Metrics

Export metrics at `/metrics` endpoint (gateway):
```yaml
environment:
  ENABLE_METRICS: "true"
  METRICS_PORT: "9100"
```

### Log Aggregation

Send logs to external system:
```yaml
logging:
  driver: "syslog"
  options:
    syslog-address: "tcp://logstash:5000"
```

---

## Troubleshooting Configuration Issues

### Check Current Configuration

```bash
# View environment variables
docker exec hercules-master env | grep -E "SERVER|LOG|ROOT"

# View process arguments
docker exec hercules-master ps aux
```

### Validate Configuration

```bash
# Test master connectivity
nc -zv master 9090

# Test Redis connectivity
redis-cli -h redis ping

# Check file permissions
ls -la /var/lib/hercules/
```

---

## Configuration Best Practices

1. **Use Environment Variables in Docker**: Easier to manage than command-line flags
2. **Separate Data Directories**: Different directories for each server type
3. **Consistent Log Levels**: Use `info` in production, `debug` only for troubleshooting
4. **Monitor Resource Usage**: Adjust resource limits based on actual usage
5. **Regular Backups**: Back up master metadata frequently
6. **Version Control Configuration**: Store docker-compose.yml in git
7. **Document Changes**: Keep track of any custom configurations

---

## Example Configurations

### Development (Single Machine)

```bash
# Master
./hercules -ServerType master_server -serverAddr 127.0.0.1:9090 -rootDir ./dev/master -logLevel debug

# Chunkserver 1
./hercules -ServerType chunk_server -serverAddr 127.0.0.1:8081 -masterAddr 127.0.0.1:9090 -redisAddr 127.0.0.1:6379 -rootDir ./dev/chunk1 -logLevel debug

# Gateway
./hercules -ServerType gateway_server -gatewayAddr 8089 -masterAddr 127.0.0.1:9090 -logLevel debug
```

### Production (Multi-Host)

```bash
# Master (dedicated host)
SERVER_TYPE=master_server SERVER_ADDRESS=0.0.0.0:9090 ROOT_DIR=/mnt/ssd/hercules/master LOG_LEVEL=info ./hercules

# Chunkserver (storage hosts, multiple)
SERVER_TYPE=chunk_server SERVER_ADDRESS=0.0.0.0:8081 MASTER_ADDR=master.internal:9090 REDIS_ADDR=redis.internal:6379 ROOT_DIR=/mnt/data/hercules/chunks LOG_LEVEL=info ./hercules

# Gateway (API hosts, load balanced)
SERVER_TYPE=gateway_server GATEWAY_ADDR=8089 MASTER_ADDR=master.internal:9090 LOG_LEVEL=info ./hercules
```
