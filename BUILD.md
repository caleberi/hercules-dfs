# Hercules Distributed File System - Docker Setup

This directory contains Docker configuration for running the Hercules distributed file system with multiple server types: Master Server, Chunk Servers, and Gateway Server.

**All components are pure Go implementations - no Python or other language dependencies required.**

## Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 1.29+
- Make (optional, but recommended)

### Start All Services

```bash
# Using Make
make build-all
make up

# Or using Docker Compose directly
docker-compose up -d
```

### Check Status

```bash
make status
# or
docker-compose ps
```

### View Logs

```bash
# All services
make logs

# Specific service
make logs-master
make logs-chunk
make logs-gateway
```

## Architecture

The Hercules system is a **pure Go implementation** consisting of three main components:

1. **Master Server** (Port 9090)
   - Manages file metadata
   - Coordinates chunk servers
   - Handles namespace operations
   - Written in Go

2. **Chunk Servers** (Ports 8081-8083)
   - Store actual file chunks
   - Handle read/write operations
   - Report to master server
   - Written in Go

3. **Gateway Server** (Port 8089)
   - HTTP API for client interactions
   - Provides REST endpoints
   - Handles client requests
   - Written in Go

**All servers are pure Go implementations with no external language dependencies.**

## Building Images

### Build All Images

```bash
make build-all
```

### Build Individual Images

```bash
# Master server
make build-master

# Chunk server
make build-chunk

# Gateway server
make build-gateway
```

### Build Arguments

Each image can be built with the `SERVER_TYPE` argument:

```bash
docker build --build-arg SERVER_TYPE=master_server -t hercules-master .
docker build --build-arg SERVER_TYPE=chunk_server -t hercules-chunkserver .
docker build --build-arg SERVER_TYPE=gateway_server -t hercules-gateway .
```

## Service Management

### Start Services

```bash
make up
# or
docker-compose up -d
```

### Stop Services

```bash
make down
# or
docker-compose down
```

### Restart Services

```bash
make restart
# or
docker-compose restart
```

### Scale Chunk Servers

Add more chunk servers dynamically:

```bash
make scale N=5
# or
docker-compose up -d --scale chunkserver=5
```

## Configuration

### Environment Variables

Each service can be configured via environment variables:

#### Master Server
- `SERVER_TYPE=master_server`
- `SERVER_ADDRESS=master:9090`
- `ROOT_DIR=/data/master`
- `LOG_LEVEL=info` (debug, info, warn, error)

#### Chunk Server
- `SERVER_TYPE=chunk_server`
- `SERVER_ADDRESS=chunk_server<number>:8081`
- `MASTER_ADDR=master:9090`
- `ROOT_DIR=/data/chunks`
- `LOG_LEVEL=info`

#### Gateway Server
- `SERVER_TYPE=gateway_server`
- `GATEWAY_ADDR=8089`
- `MASTER_ADDR=master:9090`
- `LOG_LEVEL=info`

### Modify docker-compose.yml

Edit `docker-compose.yml` to customize:
- Port mappings
- Volume mounts
- Resource limits
- Network configuration

## Data Persistence

Data is stored in named Docker volumes:

- `master-data`: Master server metadata
- `chunk1-data`, `chunk2-data`, `chunk3-data`: Chunk storage
- `gateway-data`: Gateway cache and data
- Various log volumes for each service

### Backup Data

```bash
make backup
```

This creates timestamped tar.gz files in the `backups/` directory.

### Restore Data

```bash
make restore BACKUP=master-20240101-120000.tar.gz
```

## Development

### Run Individual Services

```bash
make dev-master
make dev-chunk
make dev-gateway
```

### Access Shell

```bash
make shell-master
make shell-chunk1
make shell-gateway
```

### View Health Status

```bash
make health
```

## Networking

Services communicate over a bridge network (`hercules-net`) with subnet `172.25.0.0/16`.

### Service Discovery

Services use Docker DNS:
- Master: `master:9090`
- Chunk Servers: `chunkserver1:8081`, `chunkserver2:8082`, etc.
- Gateway: `gateway:8089`

### Network Diagnostics

```bash
make network-info
make ping-master
make ping-chunks
```

## Monitoring

### Health Checks

All services include health checks that monitor:
- Process status
- Service availability
- Response times

Health checks run every 30 seconds with:
- Timeout: 10s
- Retries: 3
- Start period: 10-20s (varies by service)

Access logs via:
```bash
docker-compose logs -f [service-name]
```

## API Access

### Gateway API

The gateway server exposes HTTP endpoints on port 8089:

```bash
# Health check
curl http://localhost:8089/health

# File operations (example)
curl http://localhost:8089/api/v1/list?path=./
```

## Troubleshooting

### Services Won't Start

1. Check if ports are already in use:
   ```bash
   netstat -tuln | grep -E '9090|808[1-3]|8089'
   ```

2. Check logs:
   ```bash
   make logs
   ```

3. Verify Docker resources:
   ```bash
   docker system df
   docker system prune
   ```

### Connection Issues

1. Check network:
   ```bash
   make network-info
   ```

2. Ping services:
   ```bash
   make ping-master
   make ping-chunks
   ```

3. Verify service health:
   ```bash
   make health
   ```

### Data Persistence Issues

1. List volumes:
   ```bash
   docker volume ls | grep hercules
   ```

2. Inspect volume:
   ```bash
   docker volume inspect hercules_master-data
   ```

## Cleanup

### Remove Containers

```bash
make down
```

### Remove Containers and Volumes

```bash
make clean
```

### Remove Only Volumes

```bash
make clean-volumes
```

### Full Reset

```bash
make clean
make build-all
make up
```

## Advanced Configuration

### Resource Limits

Add resource constraints in `docker-compose.yml`:

```yaml
services:
  master:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Custom Networks

Modify the network configuration:

```yaml
networks:
  hercules-net:
    driver: bridge
    ipam:
      config:
        - subnet: 10.5.0.0/16
```

### Volume Drivers

Use alternative volume drivers (e.g., for NFS):

```yaml
volumes:
  master-data:
    driver: local
    driver_opts:
      type: nfs
      o: addr=10.0.0.1,rw
      device: ":/path/to/share"
```

## Production Deployment

For production use, consider:

1. **Use specific image tags** instead of `latest`
2. **Set resource limits** for all services
3. **Enable log rotation** to prevent disk space issues
4. **Configure automated backups**
5. **Set up monitoring** (Prometheus, Grafana)
6. **Use secrets management** for sensitive data
7. **Enable TLS** for gateway server
8. **Configure proper DNS** instead of Docker DNS

## Contributing

When modifying Docker configuration:

1. Test builds: `make build-all