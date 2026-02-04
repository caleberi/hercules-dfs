# Engine - HTTP Server Framework

## Overview

The **Engine** package provides a production-ready HTTP/HTTPS server framework for building web services in the Hercules distributed file system. It wraps Go's `net/http` server with essential features like TLS support, graceful shutdown, dual logging, and comprehensive configuration options.

**Key Features:**
- 🔒 **TLS/SSL Support:** Automatic certificate loading from directory
- 🛑 **Graceful Shutdown:** Signal-based termination with configurable timeout
- 📝 **Dual Logging:** Structured JSON logs + colorized console output
- ⚙️ **Flexible Configuration:** Fine-grained control over timeouts and limits
- 🔌 **Router Agnostic:** Works with Gin, Chi, or stdlib mux
- 🛡️ **Security Hardening:** Header limits, timeout protection, TLS best practices

**Use Cases:**
- Gateway servers handling client requests
- Master servers exposing metadata APIs
- Chunk servers serving file data
- Admin/monitoring dashboards

## Installation

The engine package is part of Hercules DFS:

```bash
# Clone repository
git clone https://github.com/caleberi/hercules-dfs.git
cd hercules-dfs

# Install dependencies
go mod download

# Run tests
go test ./engine/...

# Run with coverage
go test -cover ./engine/...
```

## Quick Start

### Basic HTTP Server

```go
package main

import (
    "net/http"
    "os"
    "time"
    
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    // Create HTTP handler
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("Hello from Hercules!"))
    })
    
    // Configure server
    server := engine.NewServer(
        "MyServer",           // Server name for logs
        8080,                 // Port
        os.Stdout,            // Log output
        "",                   // TLS dir (empty = HTTP only)
        engine.ServerOpts{
            EnableTls:         false,
            MaxHeaderBytes:    1 << 20,  // 1 MB
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      10 * time.Second,
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: true,
        },
    )
    
    // Inject handler and start (blocks until SIGINT/SIGTERM)
    server.Mux = mux
    server.Serve()
}
```

### HTTPS Server with TLS

```go
func main() {
    // TLS directory structure:
    // /etc/hercules/tls/
    // ├── server.cert
    // └── server.key
    
    server := engine.NewServer(
        "SecureServer",
        8443,
        os.Stdout,
        "/etc/hercules/tls",  // TLS certificate directory
        engine.ServerOpts{
            EnableTls:         true,  // ← Enable HTTPS
            MaxHeaderBytes:    1 << 20,
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      10 * time.Second,
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: false,
        },
    )
    
    server.Mux = mux
    server.Serve()
}
```

### Programmatic Shutdown

```go
func main() {
    server := engine.NewServer(...)
    server.Mux = mux
    
    // Start server in background
    go server.Serve()
    
    // Later, trigger graceful shutdown
    time.Sleep(30 * time.Second)
    server.Shutdown()  // Sends SIGTERM internally
}
```

## API Reference

### Constructor

#### NewServer

```go
func NewServer(
    serverName string,
    address int,
    logger io.Writer,
    tlsDir string,
    opts ServerOpts,
) *Server
```

Creates a new HTTP server with specified configuration.

**Parameters:**
- `serverName`: Identifier for log messages (e.g., "Gateway", "MasterServer")
- `address`: TCP port to listen on (e.g., 8080, 8443)
- `logger`: Output destination for structured logs (`os.Stdout`, file, etc.)
- `tlsDir`: Directory containing `.cert` and `.key` files (empty string disables TLS)
- `opts`: Server configuration options

**Returns:**
- `*Server`: Configured server ready to serve

**Example:**
```go
server := engine.NewServer(
    "APIServer",
    8080,
    os.Stdout,
    "/etc/tls",
    engine.ServerOpts{
        EnableTls:         true,
        MaxHeaderBytes:    2 << 20,  // 2 MB
        ReadHeaderTimeout: 5 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
        UseColorizedLogger: false,
    },
)
```

---

### Methods

#### Serve

```go
func (s *Server) Serve()
```

Starts the HTTP/HTTPS server and blocks until shutdown signal received.

**Behavior:**
1. Configures `http.Server` with specified options
2. Loads TLS certificates if `EnableTls` is true
3. Registers signal handlers (SIGINT, SIGTERM)
4. Starts listening in background goroutine
5. **Blocks** waiting for shutdown signal
6. Performs graceful shutdown with 10-second timeout
7. Returns after shutdown completes

**Blocking:** This method blocks the calling goroutine until `SIGINT`, `SIGTERM`, or `Shutdown()` called.

**Example:**
```go
server := engine.NewServer(...)
server.Mux = router

// This blocks until server receives shutdown signal
server.Serve()

// Code here runs after shutdown completes
fmt.Println("Server stopped")
```

**Logs Produced:**
```
INFO  | Starting server on :8080
INFO  | => Caught interrupt
INFO  | Server terminated successfully
```

---

#### Shutdown

```go
func (s *Server) Shutdown()
```

Programmatically triggers graceful server shutdown.

**Behavior:**
- Sends `SIGTERM` to internal shutdown channel
- Unblocks `Serve()` method
- Initiates 10-second graceful shutdown sequence

**Use Cases:**
- Health check failures
- Resource exhaustion
- Coordinated multi-server shutdown
- Integration tests

**Example:**
```go
// Start server in background
go server.Serve()

// Allow server to run
time.Sleep(5 * time.Minute)

// Gracefully stop
server.Shutdown()

// Wait for completion
time.Sleep(15 * time.Second)
```

**Thread Safety:** Safe to call from any goroutine.

---

### Configuration

#### ServerOpts

```go
type ServerOpts struct {
    EnableTls                    bool
    MaxHeaderBytes               int
    ReadHeaderTimeout            time.Duration
    WriteTimeout                 time.Duration
    IdleTimeout                  time.Duration
    DisableGeneralOptionsHandler bool
    UseColorizedLogger           bool
}
```

**Field Descriptions:**

| Field | Type | Description | Recommended Value |
|-------|------|-------------|-------------------|
| `EnableTls` | `bool` | Enable HTTPS with TLS encryption | `true` (production), `false` (dev) |
| `MaxHeaderBytes` | `int` | Maximum request header size in bytes | `1 << 20` (1 MB) |
| `ReadHeaderTimeout` | `time.Duration` | Timeout for reading request headers | `5 * time.Second` |
| `WriteTimeout` | `time.Duration` | Timeout for writing response | `10 * time.Second` (API), `300 * time.Second` (file upload) |
| `IdleTimeout` | `time.Duration` | Keep-alive connection timeout | `120 * time.Second` |
| `DisableGeneralOptionsHandler` | `bool` | Disable default OPTIONS handler | `false` (use default) |
| `UseColorizedLogger` | `bool` | Use colorized console logger | `true` (dev), `false` (prod) |

**Production Configuration:**
```go
prodOpts := engine.ServerOpts{
    EnableTls:         true,
    MaxHeaderBytes:    1 << 20,              // 1 MB
    ReadHeaderTimeout: 5 * time.Second,      // Prevent Slowloris
    WriteTimeout:      10 * time.Second,     // API responses
    IdleTimeout:       120 * time.Second,    // Keep-alive
    UseColorizedLogger: false,               // JSON logs for aggregation
}
```

**Development Configuration:**
```go
devOpts := engine.ServerOpts{
    EnableTls:         false,                // HTTP for simplicity
    MaxHeaderBytes:    4 << 20,              // 4 MB (generous)
    ReadHeaderTimeout: 30 * time.Second,     // Debugging-friendly
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    UseColorizedLogger: true,                // Pretty console output
}
```

**File Upload Server:**
```go
uploadOpts := engine.ServerOpts{
    EnableTls:         true,
    MaxHeaderBytes:    4 << 20,              // 4 MB (large multipart headers)
    ReadHeaderTimeout: 10 * time.Second,
    WriteTimeout:      300 * time.Second,    // 5 minutes for large uploads
    IdleTimeout:       60 * time.Second,
}
```

---

### Types

#### ServerAddress

```go
type ServerAddress string
```

Type-safe representation of network addresses.

**Example:**
```go
addr := engine.ServerAddress(":8080")
// Internally used as string(addr) → ":8080"
```

---

## TLS Configuration

### Certificate Setup

#### Directory Structure

The `tlsDir` parameter expects the following structure:

```
/etc/hercules/tls/
├── server.cert       # Server certificate (PEM format)
├── server.key        # Server private key (PEM format)
├── intermediate.cert # Optional: intermediate CA cert
└── intermediate.key  # Optional: intermediate CA key
```

**Naming Convention:**
- Certificates: `*.cert` extension
- Keys: `*.key` extension
- Pairing: `server.cert` must have matching `server.key`

**Supported Formats:**
- PEM-encoded X.509 certificates
- RSA keys (2048/4096-bit)
- ECDSA keys (P-256/P-384)

---

### Generating Certificates

#### Development (Self-Signed)

```bash
# Generate private key
openssl genrsa -out server.key 2048

# Generate self-signed certificate (valid 1 year)
openssl req -new -x509 -sha256 -key server.key -out server.cert -days 365 \
    -subj "/C=US/ST=CA/L=SanFrancisco/O=Hercules/CN=localhost"

# Create TLS directory
mkdir -p /etc/hercules/tls
mv server.cert server.key /etc/hercules/tls/

# Set permissions
chmod 600 /etc/hercules/tls/server.key
chmod 644 /etc/hercules/tls/server.cert
```

#### Production (Let's Encrypt)

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Obtain certificate (requires domain and port 80 access)
sudo certbot certonly --standalone -d hercules.example.com

# Certificates saved to:
# /etc/letsencrypt/live/hercules.example.com/fullchain.pem
# /etc/letsencrypt/live/hercules.example.com/privkey.pem

# Copy to engine TLS directory
sudo mkdir -p /etc/hercules/tls
sudo cp /etc/letsencrypt/live/hercules.example.com/fullchain.pem \
    /etc/hercules/tls/server.cert
sudo cp /etc/letsencrypt/live/hercules.example.com/privkey.pem \
    /etc/hercules/tls/server.key

# Auto-renewal (add to crontab)
0 0 * * * certbot renew --quiet --deploy-hook "systemctl restart hercules-gateway"
```

#### Production (Internal CA)

```bash
# Generate CA key and cert (one-time)
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key -out ca.cert \
    -subj "/C=US/O=Hercules/CN=HerculesCA"

# Generate server key
openssl genrsa -out server.key 2048

# Create certificate signing request
openssl req -new -key server.key -out server.csr \
    -subj "/C=US/O=Hercules/CN=gateway.hercules.local"

# Sign with CA
openssl x509 -req -in server.csr -CA ca.cert -CAkey ca.key \
    -CAcreateserial -out server.cert -days 365

# Move to TLS directory
mv server.cert server.key /etc/hercules/tls/
```

---

### TLS Configuration Details

The engine automatically configures TLS with:

```go
s.server.TLSConfig = &tls.Config{
    Certificates:       certificates,  // Loaded from tlsDir
    InsecureSkipVerify: false,         // Always verify peer
    ClientAuth:         tls.VerifyClientCertIfGiven,  // Optional mutual TLS
}
```

**Client Authentication Modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| `NoClientCert` | No client cert required | Public-facing APIs |
| `RequestClientCert` | Request but don't require | Logging client identity |
| `RequireAnyClientCert` | Require any client cert | Testing |
| `VerifyClientCertIfGiven` | **Default:** Verify if provided | Internal + external mixed |
| `RequireAndVerifyClientCert` | Strict mutual TLS | Internal microservices |

---

## Logging

### Dual Logger System

The engine maintains two separate loggers:

#### 1. ExternalLogger (Structured JSON)

**Purpose:** Machine-readable logs for production log aggregation (ELK, Splunk, CloudWatch)

**Format:**
```json
{"level":"info","time":"2026-02-04T10:30:00Z","message":"Starting server on :8080"}
{"level":"error","time":"2026-02-04T10:35:12Z","message":"Could not shutdown server properly"}
```

**Configuration:**
```go
server := engine.NewServer(
    "MyServer",
    8080,
    os.Stdout,  // JSON logs to stdout
    "",
    engine.ServerOpts{UseColorizedLogger: false},
)
```

**Production Redirection:**
```bash
# Redirect to file
./myapp > /var/log/hercules/app.log 2>&1

# Redirect to systemd journal
systemctl start hercules-gateway  # Logs to journald
```

---

#### 2. ColorizedLogger (Human-Readable)

**Purpose:** Developer-friendly console output during local development

**Format:**
```
2026-02-04T10:30:00Z | INFO   | Starting server on :8080
2026-02-04T10:35:12Z | ERROR  | Could not shutdown server properly
```

**Configuration:**
```go
server := engine.NewServer(
    "MyServer",
    8080,
    os.Stdout,
    "",
    engine.ServerOpts{UseColorizedLogger: true},  // ← Enable colorized
)
```

**Log Levels:**

| Level | Color | Use Case |
|-------|-------|----------|
| INFO | Green | Server lifecycle events |
| ERROR | Red | Startup/shutdown failures |

---

### Custom Logging

#### Log to File

```go
logFile, err := os.OpenFile(
    "/var/log/hercules/server.log",
    os.O_CREATE|os.O_WRONLY|os.O_APPEND,
    0644,
)
if err != nil {
    log.Fatal(err)
}
defer logFile.Close()

server := engine.NewServer(
    "MyServer",
    8080,
    logFile,  // Write to file instead of stdout
    "",
    opts,
)
```

#### Log to Multiple Destinations

```go
import "io"

logFile, _ := os.Create("/var/log/app.log")
multiWriter := io.MultiWriter(os.Stdout, logFile)

server := engine.NewServer(
    "MyServer",
    8080,
    multiWriter,  // Write to both stdout AND file
    "",
    opts,
)
```

---

## Graceful Shutdown

### Shutdown Sequence

```
1. Signal received (SIGINT/SIGTERM or Shutdown() called)
2. Log: "=> Caught interrupt"
3. Create 10-second timeout context
4. Call http.Server.Shutdown(ctx)
   ↓
   • Stop accepting new connections
   • Wait for active requests to finish
   • OR timeout after 10 seconds
   ↓
5. Log: "Server terminated successfully"
6. Serve() method returns
```

### Timeout Behavior

**Scenario 1: Clean Shutdown (< 10 seconds)**

```
T+0s:   SIGINT received
T+0s:   Stop accepting new connections
T+1s:   3 active requests processing
T+3s:   All requests complete
T+3s:   Server terminated successfully ✓
```

**Scenario 2: Timeout Exceeded (> 10 seconds)**

```
T+0s:   SIGTERM received
T+0s:   Stop accepting new connections
T+5s:   Still 2 long-running requests
T+10s:  Timeout! Force close connections
T+10s:  Log: "Could not shutdown server properly: context deadline exceeded"
T+10s:  Server terminated (forcibly) ⚠️
```

### Best Practices

#### 1. Health Check Integration

```go
func main() {
    server := engine.NewServer(...)
    
    // Mark unhealthy before shutdown
    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        if shuttingDown {
            w.WriteHeader(http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    })
    
    // Signal handler
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGTERM)
    
    go func() {
        <-c
        shuttingDown = true           // Stop health checks
        time.Sleep(5 * time.Second)   // Drain load balancer traffic
        server.Shutdown()
    }()
    
    server.Serve()
}
```

#### 2. Resource Cleanup

```go
func main() {
    db := connectDatabase()
    cache := connectRedis()
    
    server := engine.NewServer(...)
    
    defer func() {
        db.Close()
        cache.Close()
    }()
    
    server.Serve()
    // After server stops, defer runs cleanup
}
```

#### 3. Coordinated Shutdown

```go
func main() {
    gatewayServer := engine.NewServer("Gateway", 8080, ...)
    adminServer := engine.NewServer("Admin", 9000, ...)
    
    go gatewayServer.Serve()
    go adminServer.Serve()
    
    // Wait for signal
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGTERM)
    <-c
    
    // Shutdown in order
    adminServer.Shutdown()        // Admin first (no client traffic)
    time.Sleep(2 * time.Second)
    gatewayServer.Shutdown()      // Gateway last
}
```

---

## Integration Examples

### Example 1: Gateway Server with Gin

```go
package main

import (
    "os"
    "time"
    
    "github.com/gin-gonic/gin"
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    // Create Gin router
    router := gin.Default()
    
    router.POST("/upload", handleUpload)
    router.GET("/download/:path", handleDownload)
    router.DELETE("/delete/:path", handleDelete)
    router.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "healthy"})
    })
    
    // Create server
    server := engine.NewServer(
        "GatewayServer",
        8080,
        os.Stdout,
        "/etc/hercules/tls",
        engine.ServerOpts{
            EnableTls:         true,
            MaxHeaderBytes:    4 << 20,  // 4 MB for multipart uploads
            ReadHeaderTimeout: 10 * time.Second,
            WriteTimeout:      300 * time.Second,  // 5 min for large uploads
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: false,
        },
    )
    
    server.Mux = router
    server.Serve()
}

func handleUpload(c *gin.Context) {
    // Handle file upload
}

func handleDownload(c *gin.Context) {
    // Stream file data
}

func handleDelete(c *gin.Context) {
    // Delete file
}
```

---

### Example 2: Master Server API

```go
package main

import (
    "net/http"
    "encoding/json"
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    mux := http.NewServeMux()
    
    mux.HandleFunc("/metadata/get", getMetadata)
    mux.HandleFunc("/metadata/create", createFile)
    mux.HandleFunc("/metadata/delete", deleteFile)
    
    server := engine.NewServer(
        "MasterServer",
        9000,
        os.Stdout,
        "",  // HTTP only (internal communication)
        engine.ServerOpts{
            EnableTls:         false,
            MaxHeaderBytes:    1 << 20,
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      10 * time.Second,
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: true,
        },
    )
    
    server.Mux = mux
    server.Serve()
}

func getMetadata(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Query().Get("path")
    // Fetch metadata from namespace manager
    metadata := fetchMetadata(path)
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(metadata)
}
```

---

### Example 3: Chunk Server

```go
package main

import (
    "io"
    "net/http"
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    mux := http.NewServeMux()
    
    mux.HandleFunc("/chunk/read", readChunk)
    mux.HandleFunc("/chunk/write", writeChunk)
    
    server := engine.NewServer(
        "ChunkServer",
        8081,
        os.Stdout,
        "/etc/hercules/tls",
        engine.ServerOpts{
            EnableTls:         true,
            MaxHeaderBytes:    1 << 20,
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      60 * time.Second,  // Chunk transfers
            IdleTimeout:       300 * time.Second,  // Long-lived connections
        },
    )
    
    server.Mux = mux
    server.Serve()
}

func readChunk(w http.ResponseWriter, r *http.Request) {
    chunkID := r.URL.Query().Get("id")
    
    // Open chunk file
    file, _ := os.Open("/data/chunks/" + chunkID)
    defer file.Close()
    
    // Stream to client
    w.Header().Set("Content-Type", "application/octet-stream")
    io.Copy(w, file)
}

func writeChunk(w http.ResponseWriter, r *http.Request) {
    chunkID := r.URL.Query().Get("id")
    
    // Save chunk data
    file, _ := os.Create("/data/chunks/" + chunkID)
    defer file.Close()
    
    io.Copy(file, r.Body)
    w.WriteHeader(http.StatusCreated)
}
```

---

### Example 4: Admin Dashboard

```go
package main

import (
    "html/template"
    "net/http"
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    mux := http.NewServeMux()
    
    mux.HandleFunc("/", dashboardHandler)
    mux.HandleFunc("/metrics", metricsHandler)
    mux.Handle("/static/", http.StripPrefix("/static/", 
        http.FileServer(http.Dir("static"))))
    
    server := engine.NewServer(
        "AdminDashboard",
        9090,
        os.Stdout,
        "/etc/hercules/tls",
        engine.ServerOpts{
            EnableTls:         true,
            MaxHeaderBytes:    512 << 10,  // 512 KB (admin traffic only)
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      30 * time.Second,
            IdleTimeout:       600 * time.Second,  // Keep dashboards open
            UseColorizedLogger: false,
        },
    )
    
    server.Mux = mux
    server.Serve()
}

func dashboardHandler(w http.ResponseWriter, r *http.Request) {
    tmpl := template.Must(template.ParseFiles("dashboard.html"))
    data := getDashboardData()
    tmpl.Execute(w, data)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
    metrics := collectMetrics()
    json.NewEncoder(w).Encode(metrics)
}
```

---

## Testing

### Running Tests

```bash
# All tests
go test ./engine/...

# Verbose output
go test -v ./engine/...

# With coverage
go test -cover ./engine/...

# Race detector
go test -race ./engine/...

# Specific test
go test -run TestServerWithMux ./engine/...
```

---

### Writing Tests

#### Basic Test

```go
func TestHTTPServer(t *testing.T) {
    // Setup router
    router := gin.Default()
    router.GET("/ping", func(c *gin.Context) {
        c.String(200, "pong")
    })
    
    // Create server
    server := engine.NewServer(
        "TestServer",
        8082,
        os.Stdout,
        "",
        engine.ServerOpts{
            EnableTls:      false,
            MaxHeaderBytes: 1 << 20,
            ReadHeaderTimeout: 1 * time.Second,
            WriteTimeout:      1 * time.Second,
            IdleTimeout:       10 * time.Second,
        },
    )
    server.Mux = router
    
    // Start server
    go server.Serve()
    defer server.Shutdown()
    
    // Wait for startup
    time.Sleep(100 * time.Millisecond)
    
    // Test request
    resp, err := http.Get("http://localhost:8082/ping")
    assert.NoError(t, err)
    defer resp.Body.Close()
    
    assert.Equal(t, 200, resp.StatusCode)
    
    body, _ := io.ReadAll(resp.Body)
    assert.Equal(t, "pong", string(body))
}
```

#### HTTPS Test

```go
func TestHTTPSServer(t *testing.T) {
    // Create temp TLS dir
    tmpDir := t.TempDir()
    generateTestCerts(tmpDir)  // Helper function
    
    // Create HTTPS server
    server := engine.NewServer(
        "TestHTTPS",
        8443,
        os.Stdout,
        tmpDir,
        engine.ServerOpts{EnableTls: true, ...},
    )
    server.Mux = router
    
    go server.Serve()
    defer server.Shutdown()
    
    time.Sleep(100 * time.Millisecond)
    
    // Create client that accepts self-signed cert
    client := &http.Client{
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{
                InsecureSkipVerify: true,
            },
        },
    }
    
    resp, err := client.Get("https://localhost:8443/health")
    assert.NoError(t, err)
    assert.Equal(t, 200, resp.StatusCode)
}
```

---

## Performance

### Benchmarking

```bash
# Run benchmarks
go test -bench=. ./engine/...

# With memory profiling
go test -bench=. -benchmem ./engine/...

# CPU profiling
go test -bench=. -cpuprofile=cpu.prof ./engine/...
go tool pprof cpu.prof
```

### Tuning Guidelines

#### High-Traffic API Server

```go
engine.ServerOpts{
    MaxHeaderBytes:    512 << 10,     // 512 KB (smaller = more connections)
    ReadHeaderTimeout: 2 * time.Second,
    WriteTimeout:      5 * time.Second,
    IdleTimeout:       30 * time.Second,  // Short to reclaim resources
}
```

#### File Upload Server

```go
engine.ServerOpts{
    MaxHeaderBytes:    4 << 20,       // 4 MB (multipart form headers)
    ReadHeaderTimeout: 10 * time.Second,
    WriteTimeout:      300 * time.Second,  // 5 min for uploads
    IdleTimeout:       60 * time.Second,
}
```

#### Streaming Server

```go
engine.ServerOpts{
    MaxHeaderBytes:    1 << 20,
    ReadHeaderTimeout: 5 * time.Second,
    WriteTimeout:      0,             // No timeout for streaming
    IdleTimeout:       300 * time.Second,
}
```

---

## Troubleshooting

### Server Won't Start

**Error:** `bind: address already in use`

**Solution:**
```bash
# Find process using port
lsof -i :8080

# Kill process
kill -9 <PID>

# Or use different port
server := engine.NewServer("Server", 8081, ...)
```

---

### TLS Certificate Errors

**Error:** `error occurred loading tls certificate: missing key for certificate: server.cert`

**Solution:**
```bash
# Ensure matching .cert and .key files
ls /etc/hercules/tls/
# Should see: server.cert AND server.key

# Check naming
mv server-key.pem server.key  # Rename to match
```

---

### Graceful Shutdown Timeout

**Error:** `Could not shutdown server properly: context deadline exceeded`

**Cause:** Requests taking > 10 seconds to complete

**Solution:**
```go
// Reduce WriteTimeout to ensure faster request completion
WriteTimeout: 5 * time.Second,  // Forces completion within 5s

// Or: Implement request context cancellation
http.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
    select {
    case <-time.After(20 * time.Second):
        // Long operation
    case <-r.Context().Done():
        // Client disconnected or shutdown initiated
        return
    }
})
```

---

### High Memory Usage

**Cause:** Too many idle connections

**Solution:**
```go
// Reduce IdleTimeout
IdleTimeout: 30 * time.Second,  // Shorter = fewer idle connections

// Monitor connections
netstat -an | grep :8080 | wc -l
```

---

## Security Best Practices

- ✅ Enable TLS in production (`EnableTls: true`)
- ✅ Set `ReadHeaderTimeout` to prevent Slowloris attacks (5-10s)
- ✅ Limit `MaxHeaderBytes` to prevent memory exhaustion (1-4 MB)
- ✅ Configure `WriteTimeout` to prevent slow-read attacks (10-30s)
- ✅ Use strong TLS certificates (RSA 2048+ or ECDSA P-256+)
- ✅ Rotate certificates regularly (Let's Encrypt auto-renewal)
- ✅ Implement rate limiting (external middleware like `golang.org/x/time/rate`)
- ✅ Validate input in HTTP handlers
- ✅ Use HTTPS-only cookies (`Secure` flag)
- ✅ Implement CORS policies (via router middleware)

---

## FAQ

### Q: Can I use multiple TLS certificates?

**A:** Yes! Place multiple `.cert`/`.key` pairs in `tlsDir`:
```
/etc/hercules/tls/
├── example.com.cert
├── example.com.key
├── api.example.com.cert
└── api.example.com.key
```

### Q: How do I redirect HTTP to HTTPS?

**A:** Run two servers:
```go
// HTTPS server
httpsServer := engine.NewServer("HTTPS", 8443, os.Stdout, "/etc/tls", 
    engine.ServerOpts{EnableTls: true, ...})
go httpsServer.Serve()

// HTTP redirect server
httpMux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    https := "https://" + r.Host + r.RequestURI
    http.Redirect(w, r, https, http.StatusMovedPermanently)
})
httpServer := engine.NewServer("HTTP", 8080, os.Stdout, "", 
    engine.ServerOpts{EnableTls: false, ...})
httpServer.Mux = httpMux
httpServer.Serve()
```

### Q: Can I change timeouts after server starts?

**A:** No, timeouts are set at `http.Server` creation. You must restart the server.

### Q: What's the default shutdown timeout?

**A:** 10 seconds (hardcoded in `Serve()` method).

### Q: Can I use this with WebSockets?

**A:** Yes, but set `WriteTimeout: 0` to prevent connection closure:
```go
engine.ServerOpts{
    WriteTimeout: 0,  // Disable timeout for long-lived connections
    IdleTimeout:  300 * time.Second,
}
```

---

## Related Components

- **Gateway:** Uses engine for client-facing HTTP API
- **Master Server:** Uses engine for metadata API
- **Chunk Server:** Uses engine for chunk data transfer

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## License

Part of the Hercules distributed file system project.

## Support

- GitHub Issues: https://github.com/caleberi/hercules-dfs/issues
- Documentation: [docs/](../docs/)
- Design Document: [DESIGN.md](DESIGN.md)
