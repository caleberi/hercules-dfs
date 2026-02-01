# Hercules Documentation

Welcome to the Hercules Distributed File System documentation! This guide provides comprehensive information about the project architecture, API, deployment, and development.

## Table of Contents

### 📚 Getting Started
- [Quick Start Guide](../README.md#getting-started)
- [Installation](deployment/installation.md)
- [Configuration Reference](guides/configuration.md)

### 🏗️ Architecture
- [System Overview](architecture/overview.md)
- [Component Details](architecture/components.md)
- [Data Flow](architecture/data-flow.md)
- [Failure Detection](architecture/failure-detection.md)
- [Replication Strategy](architecture/replication.md)

### 🔌 API Documentation
- [Master Server API](api/master-server.md)
- [Chunk Server API](api/chunk-server.md)
- [Gateway HTTP API](api/gateway.md)
- [RPC Structures](api/rpc-structures.md)

### 🚀 Deployment
- [Docker Deployment](deployment/docker.md)
- [Local Development Setup](deployment/local.md)
- [Production Deployment](deployment/production.md)
- [Monitoring & Logging](deployment/monitoring.md)

### 💻 Development Guides
- [Development Setup](guides/development.md)
- [Testing Guide](guides/testing.md)
- [Contributing Guidelines](guides/contributing.md)
- [Code Style](guides/code-style.md)

## What is Hercules?

Hercules is a distributed file system implementation inspired by the Google File System (GFS) paper from 2002. It provides:

- **Large-scale storage**: Designed to handle massive amounts of data across multiple chunk servers
- **Fault tolerance**: Automatic replication and failure detection ensure data availability
- **High throughput**: Optimized for large sequential reads/writes and concurrent append operations
- **Simple architecture**: Clear separation between metadata (master) and data (chunkservers)

## Quick Links

- [Project Repository](https://github.com/caleberi/hercules-dfs)
- [Issue Tracker](https://github.com/caleberi/hercules-dfs/issues)
- [Discussions](https://github.com/caleberi/hercules-dfs/discussions)

## Key Concepts

### Chunks
Files are divided into fixed-size chunks (64MB by default). Each chunk is:
- Identified by a unique ChunkHandle
- Versioned for consistency
- Replicated across multiple chunkservers (3 replicas by default)
- Stored as regular Linux files

### Master Server
The master server maintains all metadata:
- File and directory namespace
- Chunk location information
- Access control
- Chunk migration decisions

### Chunkservers
Storage nodes that:
- Store chunks as local files
- Serve read/write requests
- Report status via heartbeats
- Handle garbage collection

### Gateway
HTTP API gateway that:
- Provides RESTful interface
- Translates HTTP to RPC calls
- Manages client sessions

## System Requirements

- **Go**: 1.18 or higher
- **Docker**: 20.10+ (for containerized deployment)
- **Redis**: 6.0+ (for failure detection)
- **Storage**: Depends on your use case
- **Network**: Low-latency network recommended for best performance

## Support

For questions and support:
- Check the [FAQ](guides/faq.md)
- Search [existing issues](https://github.com/caleberi/hercules-dfs/issues)
- Join our [discussions](https://github.com/caleberi/hercules-dfs/discussions)

## License

This project is licensed under the terms specified in the [LICENSE](../LICENSE) file.

## Acknowledgements

This project is inspired by the Google File System paper:
> Ghemawat, S., Gobioff, H., & Leung, S. T. (2003). The Google file system. ACM SIGOPS operating systems review, 37(5), 29-43.
