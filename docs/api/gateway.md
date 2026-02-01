# Gateway HTTP API Reference

The Gateway Server provides a RESTful HTTP interface to the Hercules distributed file system. It translates HTTP requests into internal RPC calls to the master and chunkservers.

## Base URL

```
http://localhost:8089
```

## Authentication

Currently, the gateway does not implement authentication. This should be added for production use.

## Endpoints

### Health Check

#### `GET /health`
Check if the gateway is running and healthy.

**Response**: `200 OK`
```json
{
  "status": "healthy",
  "timestamp": "2026-02-01T12:00:00Z"
}
```

---

### File Operations

#### `POST /api/v1/files`
Create a new file.

**Request Body**:
```json
{
  "path": "/path/to/file.txt"
}
```

**Response**: `201 Created`
```json
{
  "success": true,
  "path": "/path/to/file.txt",
  "message": "File created successfully"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid path
- `409 Conflict`: File already exists
- `500 Internal Server Error`: Server error

---

#### `GET /api/v1/files`
Get file information.

**Query Parameters**:
- `path` (required): File path

**Example**: `GET /api/v1/files?path=/myfile.txt`

**Response**: `200 OK`
```json
{
  "path": "/myfile.txt",
  "isDir": false,
  "length": 1048576,
  "chunks": 1,
  "createdAt": "2026-01-15T10:30:00Z",
  "modifiedAt": "2026-01-20T14:45:00Z"
}
```

**Error Responses**:
- `400 Bad Request`: Missing or invalid path
- `404 Not Found`: File doesn't exist
- `500 Internal Server Error`: Server error

---

#### `DELETE /api/v1/files`
Delete a file.

**Query Parameters**:
- `path` (required): File path to delete

**Example**: `DELETE /api/v1/files?path=/myfile.txt`

**Response**: `200 OK`
```json
{
  "success": true,
  "path": "/myfile.txt",
  "message": "File deleted successfully"
}
```

**Error Responses**:
- `400 Bad Request`: Missing or invalid path
- `404 Not Found`: File doesn't exist
- `500 Internal Server Error`: Server error

---

#### `GET /api/v1/files/download`
Download file content.

**Query Parameters**:
- `path` (required): File path to download

**Example**: `GET /api/v1/files/download?path=/myfile.txt`

**Response**: `200 OK`
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename="myfile.txt"`
- Body: Raw file bytes

**Error Responses**:
- `400 Bad Request`: Missing or invalid path
- `404 Not Found`: File doesn't exist
- `500 Internal Server Error`: Server error

---

#### `POST /api/v1/files/upload`
Upload a file.

**Content-Type**: `multipart/form-data`

**Form Fields**:
- `file` (required): File to upload
- `path` (required): Destination path

**Example**:
```bash
curl -X POST http://localhost:8089/api/v1/files/upload \
  -F "file=@localfile.txt" \
  -F "path=/remote/file.txt"
```

**Response**: `201 Created`
```json
{
  "success": true,
  "path": "/remote/file.txt",
  "size": 1048576,
  "message": "File uploaded successfully"
}
```

**Error Responses**:
- `400 Bad Request`: Missing file or path
- `413 Payload Too Large`: File exceeds size limit
- `500 Internal Server Error`: Server error

---

### Directory Operations

#### `POST /api/v1/directories`
Create a directory.

**Request Body**:
```json
{
  "path": "/path/to/directory"
}
```

**Response**: `201 Created`
```json
{
  "success": true,
  "path": "/path/to/directory",
  "message": "Directory created successfully"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid path
- `409 Conflict`: Directory already exists
- `500 Internal Server Error`: Server error

---

#### `GET /api/v1/directories`
List directory contents.

**Query Parameters**:
- `path` (required): Directory path

**Example**: `GET /api/v1/directories?path=/mydir`

**Response**: `200 OK`
```json
{
  "path": "/mydir",
  "files": [
    {
      "name": "file1.txt",
      "path": "/mydir/file1.txt",
      "isDir": false,
      "length": 2048,
      "chunks": 1
    },
    {
      "name": "subdir",
      "path": "/mydir/subdir",
      "isDir": true,
      "length": 0,
      "chunks": 0
    }
  ]
}
```

**Error Responses**:
- `400 Bad Request`: Missing or invalid path
- `404 Not Found`: Directory doesn't exist
- `500 Internal Server Error`: Server error

---

### Chunk Operations

#### `GET /api/v1/chunks/:handle`
Get information about a specific chunk.

**Path Parameters**:
- `handle`: Chunk handle (integer)

**Example**: `GET /api/v1/chunks/12345`

**Response**: `200 OK`
```json
{
  "handle": 12345,
  "version": 3,
  "length": 65536,
  "locations": [
    "chunkserver1:8081",
    "chunkserver2:8082",
    "chunkserver3:8083"
  ],
  "checksum": "a1b2c3d4"
}
```

**Error Responses**:
- `404 Not Found`: Chunk doesn't exist
- `500 Internal Server Error`: Server error

---

### System Operations

#### `GET /api/v1/system/status`
Get system status and statistics.

**Response**: `200 OK`
```json
{
  "master": {
    "address": "master:9090",
    "status": "healthy",
    "uptime": 86400
  },
  "chunkservers": [
    {
      "address": "chunkserver1:8081",
      "status": "healthy",
      "chunks": 150,
      "memory": {
        "alloc": 45.2,
        "totalAlloc": 120.5,
        "sys": 67.8,
        "numGC": 23
      }
    }
  ],
  "totalChunks": 450,
  "totalFiles": 125
}
```

---

#### `GET /api/v1/system/metrics`
Get system metrics for monitoring.

**Response**: `200 OK`
```json
{
  "timestamp": "2026-02-01T12:00:00Z",
  "metrics": {
    "requests": {
      "total": 10000,
      "success": 9950,
      "failed": 50,
      "rate": 10.5
    },
    "bandwidth": {
      "upload": 1048576,
      "download": 5242880
    },
    "latency": {
      "avg": 15.5,
      "p50": 12.0,
      "p95": 45.0,
      "p99": 120.0
    }
  }
}
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional error details"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_PATH` | 400 | Invalid file or directory path |
| `FILE_NOT_FOUND` | 404 | File or directory doesn't exist |
| `FILE_EXISTS` | 409 | File or directory already exists |
| `PERMISSION_DENIED` | 403 | Permission denied |
| `PAYLOAD_TOO_LARGE` | 413 | Upload exceeds size limit |
| `INTERNAL_ERROR` | 500 | Internal server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |
| `TIMEOUT` | 504 | Request timeout |

## Request/Response Headers

### Common Request Headers

- `Content-Type`: `application/json` (for JSON requests)
- `Content-Type`: `multipart/form-data` (for file uploads)
- `Accept`: `application/json` (for JSON responses)

### Common Response Headers

- `Content-Type`: `application/json` (for JSON responses)
- `Content-Type`: `application/octet-stream` (for file downloads)
- `Content-Length`: Size of response body
- `X-Request-ID`: Unique request identifier for tracing

## Usage Examples

### Example 1: Upload and Download File

```bash
# Upload file
curl -X POST http://localhost:8089/api/v1/files/upload \
  -F "file=@mydata.txt" \
  -F "path=/data/mydata.txt"

# Download file
curl -X GET "http://localhost:8089/api/v1/files/download?path=/data/mydata.txt" \
  -o downloaded.txt
```

### Example 2: Create Directory and List Contents

```bash
# Create directory
curl -X POST http://localhost:8089/api/v1/directories \
  -H "Content-Type: application/json" \
  -d '{"path": "/myapp/logs"}'

# List directory
curl -X GET "http://localhost:8089/api/v1/directories?path=/myapp/logs"
```

### Example 3: Check System Status

```bash
# Get system status
curl -X GET http://localhost:8089/api/v1/system/status | jq

# Get metrics
curl -X GET http://localhost:8089/api/v1/system/metrics | jq
```

## CORS Configuration

The gateway is configured with permissive CORS settings:

- **Allowed Origins**: `*` (all origins)
- **Allowed Methods**: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- **Allowed Headers**: `Content-Type, Content-Length, accept, origin, Cache-Control`
- **Max Age**: 12 hours

For production, configure stricter CORS policies.

## Rate Limiting

Currently, no rate limiting is implemented. For production:

- Implement per-IP rate limiting
- Add request quota per client
- Add burst protection

## Streaming Support

### Large File Uploads

Files larger than memory can be uploaded in chunks:

```bash
# Split file
split -b 64M largefile.dat chunk_

# Upload chunks sequentially
for chunk in chunk_*; do
  curl -X POST http://localhost:8089/api/v1/files/append \
    -F "file=@$chunk" \
    -F "path=/large/file.dat"
done
```

### Large File Downloads

The gateway supports HTTP range requests for partial downloads:

```bash
# Download first 1MB
curl -X GET "http://localhost:8089/api/v1/files/download?path=/large/file.dat" \
  -H "Range: bytes=0-1048575" \
  -o partial.dat
```

## WebSocket Support

Future versions may include WebSocket support for:
- Real-time file change notifications
- Progress updates for large transfers
- System event streaming

## SDK Integration

The gateway internally uses the HerculesClient SDK:

```go
import "github.com/caleberi/distributed-system/hercules"

// Create client
client := hercules.NewHerculesClient(masterAddr)

// Gateway translates HTTP to SDK calls
result := client.CreateFile("/myfile.txt")
```

## Performance Considerations

1. **Direct Chunkserver Access**: For best performance, clients should use the Go SDK to communicate directly with chunkservers after getting metadata from master.

2. **Gateway Overhead**: HTTP gateway adds latency:
   - HTTP parsing: ~1-2ms
   - JSON serialization: ~0.5-1ms
   - RPC call: ~5-10ms

3. **Connection Pooling**: Gateway maintains connection pools to master and chunkservers.

4. **Caching**: Consider adding:
   - File metadata caching
   - Chunk location caching
   - CDN for static files

## Security Recommendations

For production deployment:

1. **Enable TLS**: Configure gateway with TLS certificates
2. **Add Authentication**: Implement JWT or OAuth2
3. **Add Authorization**: Role-based access control
4. **Input Validation**: Strict path and parameter validation
5. **Rate Limiting**: Prevent abuse
6. **Audit Logging**: Log all file operations

## Monitoring Integration

The gateway exposes metrics compatible with:
- Prometheus (at `/metrics` endpoint)
- Grafana dashboards
- CloudWatch/Datadog integrations

Example Prometheus scrape config:
```yaml
scrape_configs:
  - job_name: 'hercules-gateway'
    static_configs:
      - targets: ['localhost:8089']
```
