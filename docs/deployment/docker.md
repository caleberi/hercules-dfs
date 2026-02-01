# Docker Deployment Guide

This guide covers deploying Hercules using Docker and Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 1.29+
- 4GB+ RAM recommended
- 10GB+ disk space for chunk storage

## Quick Start

### 1. Clone and Build

```bash
# Clone repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# Build all images
make build-all

# Or build individually
make build-master
make build-chunk
make build-gateway
```

### 2. Start Services

```bash
# Start all services in detached mode
docker-compose up -d

# Or use Make
make up
```

### 3. Verify Deployment

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Or use Make
make status
make logs
```

Expected output:
```
NAME                     STATUS              PORTS
hercules-master          Up 2 minutes        0.0.0.0:9090->9090/tcp
hercules-chunkserver1    Up 2 minutes        0.0.0.0:8081->8081/tcp
hercules-chunkserver2    Up 2 minutes        0.0.0.0:8082->8082/tcp
hercules-chunkserver3    Up 2 minutes        0.0.0.0:8083->8083/tcp
hercules-gateway         Up 2 minutes        0.0.0.0:8089->8089/tcp
hercules-redis           Up 2 minutes        0.0.0.0:6379->6379/tcp
```

## Architecture

The Docker deployment consists of 6 containers:

1. **Master Server** (port 9090)
   - Manages metadata
   - Coordinates chunkservers
   - Single instance

2. **Chunkservers** (ports 8081-8083)
   - Store file chunks
   - 3 instances for replication
   - Can scale to more instances

3. **Gateway Server** (port 8089)
   - HTTP API interface
   - Proxies requests to master/chunkservers

4. **Redis** (port 6379)
   - Failure detection backend
   - Stores heartbeat history

## Docker Compose Configuration

### Master Server

```yaml
master:
  build:
    context: .
    dockerfile: Dockerfile
    args:
      SERVER_TYPE: master_server
  image: hercules-master:latest
  container_name: hercules-master
  environment:
    SERVER_TYPE: master_server
    SERVER_ADDRESS: 0.0.0.0:9090
    ROOT_DIR: ./data/master
    LOG_LEVEL: info
  ports:
    - "9090:9090"
  volumes:
    - master-data:/data/master
  networks:
    - hercules-net
  restart: unless-stopped
```

### Chunkserver

```yaml
chunkserver1:
  build:
    context: .
    dockerfile: Dockerfile
    args:
      SERVER_TYPE: chunk_server
  image: hercules-chunkserver:latest
  container_name: hercules-chunkserver1
  environment:
    SERVER_TYPE: chunk_server
    SERVER_ADDRESS: chunkserver1:8081
    MASTER_ADDR: master:9090
    REDIS_ADDR: redis:6379
    ROOT_DIR: ./data/chunks
    LOG_LEVEL: info
  ports:
    - "8081:8081"
  volumes:
    - chunk1-data:/data/chunks
  networks:
    - hercules-net
  depends_on:
    master:
      condition: service_healthy
    redis:
      condition: service_healthy
```

### Gateway Server

```yaml
gateway:
  build:
    context: .
    dockerfile: Dockerfile
    args:
      SERVER_TYPE: gateway_server
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
    master:
      condition: service_healthy
```

## Environment Variables

### Master Server

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_TYPE` | `master_server` | Server type identifier |
| `SERVER_ADDRESS` | `0.0.0.0:9090` | Listen address |
| `ROOT_DIR` | `./data/master` | Data directory |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |

### Chunkserver

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_TYPE` | `chunk_server` | Server type identifier |
| `SERVER_ADDRESS` | `chunkserver1:8081` | Listen address |
| `MASTER_ADDR` | `master:9090` | Master server address |
| `REDIS_ADDR` | `redis:6379` | Redis address |
| `ROOT_DIR` | `./data/chunks` | Chunk storage directory |
| `LOG_LEVEL` | `info` | Log level |

### Gateway Server

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_TYPE` | `gateway_server` | Server type identifier |
| `GATEWAY_ADDR` | `8089` | HTTP port |
| `MASTER_ADDR` | `master:9090` | Master server address |
| `LOG_LEVEL` | `info` | Log level |

## Scaling Chunkservers

Add more chunkservers by extending docker-compose.yml:

```yaml
chunkserver4:
  extends:
    service: chunkserver1
  container_name: hercules-chunkserver4
  hostname: chunkserver4
  environment:
    SERVER_ADDRESS: chunkserver4:8084
  ports:
    - "8084:8084"
  volumes:
    - chunk4-data:/data/chunks
```

Then restart:
```bash
docker-compose up -d --scale chunkserver=4
```

## Data Persistence

### Volumes

Defined volumes persist data across container restarts:

```yaml
volumes:
  master-data:
    driver: local
  chunk1-data:
    driver: local
  chunk2-data:
    driver: local
  chunk3-data:
    driver: local
  redis-data:
    driver: local
```

### Backup Volumes

```bash
# Backup master data
docker run --rm -v hercules_master-data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/master-backup.tar.gz /data

# Backup chunk data
docker run --rm -v hercules_chunk1-data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/chunk1-backup.tar.gz /data
```

### Restore Volumes

```bash
# Restore master data
docker run --rm -v hercules_master-data:/data -v $(pwd):/backup \
  ubuntu tar xzf /backup/master-backup.tar.gz -C /

# Restore chunk data
docker run --rm -v hercules_chunk1-data:/data -v $(pwd):/backup \
  ubuntu tar xzf /backup/chunk1-backup.tar.gz -C /
```

## Networking

### Default Network

All services connect to `hercules-net` bridge network:

```yaml
networks:
  hercules-net:
    driver: bridge
    ipam:
      driver: default
      config:
        - subnet: 172.25.0.0/16
```

### Service Discovery

Services discover each other using Docker DNS:
- Master: `master:9090`
- Chunkservers: `chunkserver1:8081`, `chunkserver2:8082`, etc.
- Gateway: `gateway:8089`
- Redis: `redis:6379`

## Health Checks

Each service has health checks defined:

```yaml
healthcheck:
  test: ["CMD", "nc", "-z", "127.0.0.1", "9090"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

Check health status:
```bash
docker-compose ps
```

## Monitoring

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f master
docker-compose logs -f chunkserver1
docker-compose logs -f gateway

# With timestamps
docker-compose logs -f --timestamps
```

### Resource Usage

```bash
# All containers
docker stats

# Specific container
docker stats hercules-master
```

### Exec into Container

```bash
# Master
docker exec -it hercules-master sh

# Chunkserver
docker exec -it hercules-chunkserver1 sh

# Gateway
docker exec -it hercules-gateway sh
```

## Makefile Commands

The project includes a Makefile for common operations:

```bash
# Build
make build-all          # Build all images
make build-master       # Build master image
make build-chunk        # Build chunkserver image
make build-gateway      # Build gateway image

# Run
make up                 # Start all services
make down               # Stop all services
make restart            # Restart all services

# Monitor
make status             # Show service status
make logs               # Show all logs
make logs-master        # Show master logs
make logs-chunk         # Show chunkserver logs
make logs-gateway       # Show gateway logs

# Clean
make clean              # Stop and remove containers
make clean-all          # Remove containers, volumes, and images
```

## Troubleshooting

### Containers Not Starting

```bash
# Check logs
docker-compose logs

# Check specific service
docker-compose logs master

# Inspect container
docker inspect hercules-master
```

### Port Already in Use

```bash
# Find process using port
lsof -i :9090

# Kill process or change port in docker-compose.yml
ports:
  - "9091:9090"  # Map to different host port
```

### Network Issues

```bash
# Inspect network
docker network inspect hercules_hercules-net

# Recreate network
docker-compose down
docker network prune
docker-compose up -d
```

### Volume Issues

```bash
# List volumes
docker volume ls

# Remove volumes (WARNING: deletes data)
docker volume rm hercules_master-data

# Prune unused volumes
docker volume prune
```

### Master Can't Reach Chunkservers

Check that chunkservers registered:
```bash
# Exec into master
docker exec -it hercules-master sh

# Check if chunkservers are reachable
nc -zv chunkserver1 8081
nc -zv chunkserver2 8082
nc -zv chunkserver3 8083
```

## Production Considerations

### Resource Limits

Add resource limits to docker-compose.yml:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
    reservations:
      cpus: '1'
      memory: 2G
```

### Security

```yaml
security_opt:
  - no-new-privileges:true
user: "1000:1000"
read_only: true
tmpfs:
  - /tmp
```

### Logging

Configure log rotation:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

### Multi-Host Deployment

For production, deploy across multiple hosts using Docker Swarm or Kubernetes.

## Next Steps

- [Monitoring Guide](monitoring.md) - Set up monitoring and alerting
- [Production Deployment](production.md) - Deploy to production
- [Backup Strategy](backup.md) - Implement backup and recovery
