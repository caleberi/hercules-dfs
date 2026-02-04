# Engine - HTTP Server Framework Design Document

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Design Patterns](#design-patterns)
5. [API Specifications](#api-specifications)
6. [Configuration Management](#configuration-management)
7. [TLS Support](#tls-support)
8. [Graceful Shutdown](#graceful-shutdown)
9. [Logging Strategy](#logging-strategy)
10. [Error Handling](#error-handling)
11. [Testing Strategy](#testing-strategy)
12. [Performance Considerations](#performance-considerations)
13. [Security](#security)
14. [Integration Examples](#integration-examples)
15. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

The **Engine** package provides a production-ready HTTP/HTTPS server framework with built-in support for:
- **TLS/SSL encryption** with automatic certificate loading
- **Graceful shutdown** with configurable timeouts
- **Dual logging** (colorized console + structured zerolog)
- **Signal handling** for SIGINT/SIGTERM
- **Flexible configuration** for timeouts, header sizes, and server behavior

This is a foundational component used by all HTTP-based services in Hercules DFS (Gateway, Master Server, Chunk Servers).

### Use Cases

1. **Gateway Server:** Handles client file operations over HTTP/HTTPS
2. **Master Server:** Exposes metadata management APIs
3. **Chunk Server:** Serves chunk data via HTTP endpoints
4. **Admin Interfaces:** Provides monitoring/management dashboards

### Design Philosophy

- **Simplicity:** Thin wrapper around `net/http` with sensible defaults
- **Flexibility:** Pluggable HTTP handlers (Gin, Chi, stdlib mux)
- **Observability:** Rich logging with structured and colorized output
- **Production-Ready:** TLS support, graceful shutdown, signal handling

---

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────┐
│                    Hercules DFS Services                    │
│                                                             │
│  ┌───────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Gateway  │    │ Master Server │    │ Chunk Server │   │
│  └─────┬─────┘    └──────┬───────┘    └──────┬───────┘   │
│        │                  │                    │           │
│        └──────────────────┼────────────────────┘           │
│                           │                                │
│                      ┌────▼─────┐                         │
│                      │  Engine  │                         │
│                      │  Server  │                         │
│                      └────┬─────┘                         │
│                           │                                │
└───────────────────────────┼────────────────────────────────┘
                            │
                      ┌─────▼──────┐
                      │ net/http   │
                      │   Server   │
                      └────────────┘
```

### Component Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Engine Server                       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────────────┐    │
│  │              Server Struct                   │    │
│  │  - http.Server (stdlib)                      │    │
│  │  - shutdownChannel (os.Signal)               │    │
│  │  - ExternalLogger (zerolog.Logger)           │    │
│  │  - ColorizedLogger (zerolog.Logger)          │    │
│  │  - Mux (http.Handler)                        │    │
│  │  - Opts (ServerOpts)                         │    │
│  └──────────────────────────────────────────────┘    │
│                                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Serve()   │  │  Shutdown() │  │ TLS Loader  │  │
│  │             │  │             │  │             │  │
│  │ • Starts    │  │ • Sends     │  │ • Scans dir │  │
│  │   server    │  │   SIGTERM   │  │ • Pairs     │  │
│  │ • Handles   │  │ • Triggers  │  │   .cert +   │  │
│  │   signals   │  │   graceful  │  │   .key      │  │
│  │ • Logs      │  │   shutdown  │  │ • Loads     │  │
│  │   events    │  │             │  │   X.509     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Server Struct

The central orchestrator for HTTP server lifecycle management.

```go
type Server struct {
    server          *http.Server   // stdlib HTTP server instance
    shutdownChannel chan os.Signal // buffered channel for shutdown signals
    errorLogger     *log.Logger    // stdlib logger for http.Server errors
    ServerName      string         // identifier for logging
    Opts            ServerOpts     // configuration options
    Address         ServerAddress  // network address (":8080")
    TlsConfigDir    string         // directory containing TLS files
    ExternalLogger  zerolog.Logger // structured logger for application logs
    ColorizedLogger zerolog.Logger // human-friendly console logger
    Mux             http.Handler   // request multiplexer (Gin, Chi, stdlib)
}
```

**Responsibilities:**
- Encapsulates `net/http.Server` with enhanced lifecycle management
- Maintains dual logging channels (structured + colorized)
- Manages TLS certificate loading and configuration
- Handles OS signals for graceful shutdown

**Lifecycle States:**
```
Created → Configured → Serving → Shutting Down → Terminated
    ↑                     ↓
    └─────────────────────┘
       (restart on signal)
```

---

### 2. ServerOpts Configuration

Fine-grained control over server behavior and performance.

```go
type ServerOpts struct {
    EnableTls                    bool          // TLS encryption toggle
    MaxHeaderBytes               int           // header size limit (default: 1MB)
    ReadHeaderTimeout            time.Duration // header read timeout
    WriteTimeout                 time.Duration // response write timeout
    IdleTimeout                  time.Duration // keep-alive timeout
    DisableGeneralOptionsHandler bool          // disable default OPTIONS handler
    UseColorizedLogger           bool          // enable colorized console output
}
```

**Design Rationale:**

1. **EnableTls:** Allows same codebase for HTTP (dev) and HTTPS (prod)
2. **MaxHeaderBytes:** Prevents DoS attacks via large headers (default: 4MB in tests)
3. **ReadHeaderTimeout:** Mitigates Slowloris attacks
4. **WriteTimeout:** Prevents slow clients from holding connections
5. **IdleTimeout:** Reclaims resources from idle keep-alive connections
6. **DisableGeneralOptionsHandler:** For custom CORS/OPTIONS handling
7. **UseColorizedLogger:** Developer-friendly logs during local development

**Recommended Defaults:**

```go
ProductionOpts := ServerOpts{
    EnableTls:         true,
    MaxHeaderBytes:    1 << 20,              // 1 MB
    ReadHeaderTimeout: 5 * time.Second,
    WriteTimeout:      10 * time.Second,
    IdleTimeout:       120 * time.Second,
    UseColorizedLogger: false,               // Use structured logs
}

DevelopmentOpts := ServerOpts{
    EnableTls:         false,
    MaxHeaderBytes:    4 << 20,              // 4 MB
    ReadHeaderTimeout: 30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    UseColorizedLogger: true,                // Colorized for readability
}
```

---

### 3. ServerAddress Type

Type-safe representation of network addresses.

```go
type ServerAddress string

// Usage:
address := ServerAddress(fmt.Sprintf(":%d", 8080))  // ":8080"
```

**Design Benefits:**
- Type safety: Prevents accidental string concatenation errors
- Self-documenting: Signals intent in function signatures
- Future extension: Could add validation methods (`IsValid()`, `ParseHost()`)

---

## Design Patterns

### 1. Builder Pattern (Constructor)

The `NewServer` function acts as a builder with explicit parameter validation.

```go
func NewServer(
    serverName string,      // Required: identifier for logs
    address int,            // Required: port number
    logger io.Writer,       // Required: output for structured logs
    tlsDir string,          // Optional: "" disables TLS
    opts ServerOpts,        // Required: configuration
) *Server
```

**Pattern Benefits:**
- **Explicit Dependencies:** All required parameters visible at construction
- **Immutability:** Server configuration frozen after creation
- **Validation Point:** Single location to validate inputs

**Initialization Sequence:**
```
1. Create Server struct with core fields
2. Initialize ExternalLogger with provided io.Writer
3. Create shutdownChannel (buffered, size 1)
4. Initialize errorLogger for http.Server
5. IF opts.UseColorizedLogger:
   → Configure ConsoleWriter with custom formatters
6. RETURN configured Server
```

---

### 2. Signal-Driven Shutdown Pattern

Graceful shutdown initiated by OS signals or programmatic calls.

```go
// Signal handling flow:
signal.Notify(shutdownChannel, SIGINT, SIGTERM)

// Blocking wait for signal:
sig := <-shutdownChannel

// Graceful shutdown with timeout:
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

server.Shutdown(ctx)
```

**Pattern Characteristics:**
- **Non-Blocking Start:** Server runs in background goroutine
- **Signal Multiplexing:** Single channel for SIGINT, SIGTERM, and programmatic shutdown
- **Timeout Protection:** Hard deadline (10s) prevents hung shutdowns
- **Resource Cleanup:** Deferred context cancellation ensures cleanup

**Shutdown Sequence:**
```
1. Signal received (SIGINT/SIGTERM or Shutdown() call)
2. Log signal reception
3. Create 10-second timeout context
4. Call http.Server.Shutdown(ctx)
   → Stops accepting new connections
   → Waits for active requests to complete
   → OR times out after 10 seconds
5. Block on ctx.Done() (ensures shutdown completes)
6. Log termination success
```

---

### 3. Strategy Pattern (Logging)

Two interchangeable logging strategies based on runtime configuration.

```go
logger := s.ColorizedLogger
if !s.Opts.UseColorizedLogger {
    logger = s.ExternalLogger
}

// Use selected logger:
logger.Info().Msgf("Starting server on %v", s.server.Addr)
```

**Strategy Selection:**
- **Development:** ColorizedLogger (human-readable, formatted output)
- **Production:** ExternalLogger (structured JSON for log aggregation)

**Colorized Logger Configuration:**
```go
colorizedLogger := zerolog.NewConsoleWriter()
colorizedLogger.NoColor = false
colorizedLogger.FormatLevel = func(i interface{}) string {
    return strings.ToUpper(fmt.Sprintf("| %-6s|", i))
}
// Output: | INFO   | Starting server on :8080
```

---

### 4. Factory Pattern (TLS Certificate Loading)

Certificate collection abstracted into dedicated factory function.

```go
certificates, err := collectTlsCertificates(s.TlsConfigDir)
```

**Factory Algorithm:**

```
1. Walk TlsConfigDir recursively
2. Collect *.cert files → certFiles map
3. Collect *.key files → keyFiles map
4. FOR EACH cert in certFiles:
   a. Find matching key (replace .cert with .key)
   b. IF key not found → ERROR
   c. Load X.509 key pair (tls.LoadX509KeyPair)
   d. Append to certificates slice
5. RETURN certificates or error
```

**Naming Convention:**
```
TlsConfigDir/
├── server.cert  ← Paired with server.key
├── server.key
├── client.cert  ← Paired with client.key
├── client.key
└── intermediate.cert  ← ERROR if intermediate.key missing
```

---

## API Specifications

### NewServer

**Signature:**
```go
func NewServer(
    serverName string,
    address int,
    logger io.Writer,
    tlsDir string,
    opts ServerOpts,
) *Server
```

**Purpose:** Constructs a new HTTP server with specified configuration.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `serverName` | `string` | Yes | Server identifier for logs (e.g., "Gateway", "MasterServer") |
| `address` | `int` | Yes | TCP port number (e.g., 8080) |
| `logger` | `io.Writer` | Yes | Output destination for structured logs (e.g., `os.Stdout`) |
| `tlsDir` | `string` | No | Directory containing TLS cert/key pairs (empty string = HTTP only) |
| `opts` | `ServerOpts` | Yes | Server configuration options |

**Returns:**
- `*Server`: Fully configured server ready for `Serve()` call

**Example:**
```go
server := NewServer(
    "GatewayServer",
    8080,
    os.Stdout,
    "/etc/hercules/tls",
    ServerOpts{
        EnableTls:         true,
        MaxHeaderBytes:    1 << 20,
        ReadHeaderTimeout: 5 * time.Second,
        WriteTimeout:      10 * time.Second,
        IdleTimeout:       120 * time.Second,
        UseColorizedLogger: false,
    },
)
server.Mux = myGinRouter  // Inject HTTP handler
server.Serve()             // Start server
```

**Initialization Details:**

1. **ServerAddress Construction:**
   ```go
   Address: ServerAddress(fmt.Sprintf(":%d", address))  // ":8080"
   ```

2. **Dual Logger Setup:**
   ```go
   ExternalLogger: zerolog.New(logger)  // Structured JSON
   
   // Conditional colorized logger:
   if opts.UseColorizedLogger {
       writer := zerolog.NewConsoleWriter()
       writer.NoColor = false
       writer.FormatLevel = formatLevelFunc
       ColorizedLogger = zerolog.New(writer).With().Timestamp().Logger()
   }
   ```

3. **Error Logger:**
   ```go
   errorLogger: log.New(
       os.Stderr,
       fmt.Sprintf("[%s] ", serverName),
       log.Ldate|log.Llongfile|log.Ltime,
   )
   // Output: [GatewayServer] 2026/02/04 server.go:123: error message
   ```

4. **Shutdown Channel:**
   ```go
   shutdownChannel: make(chan os.Signal, 1)  // Buffered to prevent blocking
   ```

---

### Serve

**Signature:**
```go
func (s *Server) Serve()
```

**Purpose:** Starts the HTTP/HTTPS server and blocks until shutdown signal received.

**Behavior:**

1. **Server Configuration:**
   ```go
   s.server = &http.Server{
       MaxHeaderBytes:               s.Opts.MaxHeaderBytes,
       Addr:                         string(s.Address),
       Handler:                      s.Mux,
       DisableGeneralOptionsHandler: s.Opts.DisableGeneralOptionsHandler,
       ErrorLog:                     s.errorLogger,
   }
   ```

2. **TLS Setup (if enabled):**
   ```go
   if s.Opts.EnableTls {
       certificates, err := collectTlsCertificates(s.TlsConfigDir)
       // Error logged, execution continues (will fail on ListenAndServeTLS)
       
       s.server.TLSConfig = &tls.Config{
           Certificates:       certificates,
           InsecureSkipVerify: false,
           ClientAuth:         tls.VerifyClientCertIfGiven,
       }
   }
   ```

3. **Signal Registration:**
   ```go
   signal.Notify(s.shutdownChannel, syscall.SIGINT, syscall.SIGTERM)
   ```

4. **Background Server Start:**
   ```go
   go func(s *Server, logger zerolog.Logger) {
       logger.Info().Msgf("Starting server on %v", s.server.Addr)
       
       if !s.Opts.EnableTls {
           err := s.server.ListenAndServe()  // HTTP
       } else {
           err := s.server.ListenAndServeTLS("", "")  // HTTPS (certs from TLSConfig)
       }
       
       if err != nil && !errors.Is(err, http.ErrServerClosed) {
           logger.Error().Msg("Could not start server engine")
       }
   }(s, logger)
   ```

5. **Signal Wait and Shutdown:**
   ```go
   sig := <-s.shutdownChannel  // Blocks until signal
   logger.Info().Msgf("=> Caught %v", sig.String())
   
   ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
   defer cancel()
   
   if err := s.server.Shutdown(ctx); err != nil {
       logger.Error().Msgf("Could not shutdown server properly: %v", err)
   }
   
   <-ctx.Done()  // Wait for shutdown completion or timeout
   logger.Info().Msg("Server terminated successfully")
   ```

**Blocking Behavior:**
- `Serve()` **blocks** on `<-s.shutdownChannel`
- Main goroutine waits for SIGINT/SIGTERM or `Shutdown()` call
- Returns after graceful shutdown completes (or 10s timeout)

**Error Handling:**
- TLS cert loading errors: Logged but not fatal (fails later at ListenAndServeTLS)
- Server start errors: Logged if not `http.ErrServerClosed`
- Shutdown errors: Logged but does not panic

**Example:**
```go
server := NewServer("API", 8080, os.Stdout, "", opts)
server.Mux = router

// Start server (blocks until shutdown)
server.Serve()  // ← Blocks here

// This code runs after SIGINT/SIGTERM received:
fmt.Println("Server stopped")
```

---

### Shutdown

**Signature:**
```go
func (s *Server) Shutdown()
```

**Purpose:** Programmatically triggers graceful server shutdown.

**Behavior:**
```go
s.shutdownChannel <- syscall.SIGTERM
```

Sends `SIGTERM` signal to the shutdown channel, unblocking `Serve()` and initiating graceful shutdown sequence.

**Use Cases:**
1. **Health Check Failures:** Automatically shutdown unhealthy server
2. **Resource Exhaustion:** Gracefully stop server before OOM
3. **Testing:** Controlled shutdown in integration tests
4. **Coordinated Shutdown:** Multiple servers shutdown in sequence

**Example:**
```go
// Start server in background
go server.Serve()

// Later, programmatically stop:
server.Shutdown()  // Triggers graceful shutdown
time.Sleep(15 * time.Second)  // Wait for shutdown completion
```

**Thread Safety:**
- Safe to call from any goroutine
- Channel is buffered (size 1), won't block sender
- Multiple calls safe (channel read only once)

---

### collectTlsCertificates (Internal)

**Signature:**
```go
func collectTlsCertificates(directory string) ([]tls.Certificate, error)
```

**Purpose:** Discovers and loads TLS certificate-key pairs from a directory.

**Algorithm:**

```
INPUT: directory string

1. Initialize maps:
   certFiles := map[string]string{}  // filename → full path
   keyFiles := map[string]string{}

2. Walk directory recursively:
   fs.WalkDir(os.DirFS(directory), ".", walkFunc)
   
   walkFunc for each entry:
   a. Skip if not regular file
   b. IF filename ends with ".cert":
        certFiles[filename] = fullPath
   c. ELSE IF filename ends with ".key":
        keyFiles[filename] = fullPath

3. Pair and load certificates:
   certificates := []tls.Certificate{}
   
   FOR EACH (certName, certPath) IN certFiles:
       a. Compute keyName = replace(certName, ".cert", ".key")
       b. keyPath := keyFiles[keyName]
       c. IF keyPath not found:
            RETURN error "missing key for certificate: certName"
       d. cert := tls.LoadX509KeyPair(certPath, keyPath)
       e. IF error:
            RETURN error "failed to load certificate pair"
       f. APPEND cert to certificates

4. RETURN certificates
```

**Return Values:**
- `[]tls.Certificate`: Slice of loaded certificate-key pairs
- `error`: Directory walk error, missing key error, or load error

**Error Cases:**

| Error | Cause | Example |
|-------|-------|---------|
| Directory walk error | Permissions, non-existent dir | `permission denied` |
| Missing key error | .cert without matching .key | `missing key for certificate: server.cert` |
| Load error | Invalid cert/key format | `failed to load certificate pair server.cert: tls: failed to parse...` |

**Example Directory:**
```
/etc/hercules/tls/
├── server.cert       ← Paired with server.key
├── server.key
├── intermediate.cert ← Paired with intermediate.key
├── intermediate.key
└── root-ca.cert      ⚠️  ERROR: no root-ca.key
```

**Security Considerations:**
- Uses `os.DirFS` for sandboxed filesystem access
- Validates certificate-key pairing before loading
- Returns error if any pair fails to load (fail-fast)

---

## Configuration Management

### Configuration Layers

The engine supports multiple configuration approaches:

#### 1. Code-Based Configuration

Direct instantiation with `ServerOpts`:

```go
server := NewServer(
    "MyService",
    8080,
    os.Stdout,
    "/etc/tls",
    ServerOpts{
        EnableTls:         true,
        MaxHeaderBytes:    1 << 20,
        ReadHeaderTimeout: 5 * time.Second,
        WriteTimeout:      10 * time.Second,
        IdleTimeout:       120 * time.Second,
    },
)
```

#### 2. Environment Variable Configuration

Load configuration from environment:

```go
func LoadServerOptsFromEnv() ServerOpts {
    return ServerOpts{
        EnableTls:      os.Getenv("TLS_ENABLED") == "true",
        MaxHeaderBytes: getEnvInt("MAX_HEADER_BYTES", 1<<20),
        ReadHeaderTimeout: getEnvDuration("READ_HEADER_TIMEOUT", 5*time.Second),
        WriteTimeout:      getEnvDuration("WRITE_TIMEOUT", 10*time.Second),
        IdleTimeout:       getEnvDuration("IDLE_TIMEOUT", 120*time.Second),
    }
}

// Environment variables:
// TLS_ENABLED=true
// MAX_HEADER_BYTES=1048576
// READ_HEADER_TIMEOUT=5s
// WRITE_TIMEOUT=10s
// IDLE_TIMEOUT=120s
```

#### 3. Configuration File (JSON/YAML)

Load from structured config file:

```yaml
# config.yaml
server:
  name: GatewayServer
  port: 8080
  tls:
    enabled: true
    cert_dir: /etc/hercules/tls
  timeouts:
    read_header: 5s
    write: 10s
    idle: 120s
  limits:
    max_header_bytes: 1048576
  logging:
    colorized: false
```

```go
func LoadServerFromConfig(configPath string) (*Server, error) {
    data, _ := os.ReadFile(configPath)
    var cfg Config
    yaml.Unmarshal(data, &cfg)
    
    return NewServer(
        cfg.Server.Name,
        cfg.Server.Port,
        os.Stdout,
        cfg.Server.TLS.CertDir,
        ServerOpts{
            EnableTls:         cfg.Server.TLS.Enabled,
            MaxHeaderBytes:    cfg.Server.Limits.MaxHeaderBytes,
            ReadHeaderTimeout: cfg.Server.Timeouts.ReadHeader,
            WriteTimeout:      cfg.Server.Timeouts.Write,
            IdleTimeout:       cfg.Server.Timeouts.Idle,
            UseColorizedLogger: cfg.Server.Logging.Colorized,
        },
    ), nil
}
```

---

## TLS Support

### Certificate Management

#### Directory Structure

```
TlsConfigDir/
├── server.cert          # Server certificate
├── server.key           # Server private key (RSA/ECDSA)
├── intermediate.cert    # Intermediate CA certificate (optional)
├── intermediate.key     # Intermediate CA key
└── client-ca.cert       # Client CA for mutual TLS (optional)
```

#### Supported Certificate Types

- **Server Certificates:** RSA (2048/4096-bit), ECDSA (P-256/P-384)
- **Key Formats:** PEM-encoded PKCS#1, PKCS#8
- **Certificate Chains:** Multiple certs supported via multiple files

#### TLS Configuration

```go
s.server.TLSConfig = &tls.Config{
    Certificates:       certificates,           // Loaded cert-key pairs
    InsecureSkipVerify: false,                  // Always verify peer certs
    ClientAuth:         tls.VerifyClientCertIfGiven,  // Mutual TLS optional
}
```

**ClientAuth Modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| `NoClientCert` | No client cert required | Public APIs |
| `RequestClientCert` | Request but don't verify | Logging client identity |
| `RequireAnyClientCert` | Require cert (no verification) | Testing |
| `VerifyClientCertIfGiven` | Verify if provided | **Current setting** |
| `RequireAndVerifyClientCert` | Strict mutual TLS | Internal services |

**Security Hardening (Future):**

```go
TLSConfig: &tls.Config{
    Certificates:       certificates,
    MinVersion:         tls.VersionTLS12,  // No TLS 1.0/1.1
    CipherSuites: []uint16{
        tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
        tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
    },
    PreferServerCipherSuites: true,
    CurvePreferences: []tls.CurveID{
        tls.CurveP256,
        tls.X25519,
    },
}
```

---

### Generating Certificates

#### Development (Self-Signed)

```bash
# Generate private key
openssl genrsa -out server.key 2048

# Generate self-signed certificate
openssl req -new -x509 -sha256 -key server.key -out server.cert -days 365 \
    -subj "/C=US/ST=CA/L=SF/O=Hercules/CN=localhost"

# Move to TLS directory
mkdir -p /etc/hercules/tls
mv server.cert server.key /etc/hercules/tls/
```

#### Production (Let's Encrypt)

```bash
# Install certbot
sudo apt-get install certbot

# Obtain certificate
sudo certbot certonly --standalone -d hercules.example.com

# Copy to TLS directory
sudo cp /etc/letsencrypt/live/hercules.example.com/fullchain.pem /etc/hercules/tls/server.cert
sudo cp /etc/letsencrypt/live/hercules.example.com/privkey.pem /etc/hercules/tls/server.key

# Auto-renewal (cron)
0 0 * * * certbot renew --quiet && systemctl reload hercules-gateway
```

---

## Graceful Shutdown

### Shutdown Sequence Diagram

```
┌─────────┐                  ┌────────────┐                 ┌──────────┐
│ OS/User │                  │   Serve()  │                 │  Server  │
└────┬────┘                  └─────┬──────┘                 └────┬─────┘
     │                             │                             │
     │  SIGINT/SIGTERM             │                             │
     │────────────────────────────>│                             │
     │                             │                             │
     │                             │ Log: "Caught SIGINT"        │
     │                             │────────────────────────────>│
     │                             │                             │
     │                             │ server.Shutdown(ctx)        │
     │                             │────────────────────────────>│
     │                             │                             │
     │                             │         Stop accepting new connections
     │                             │         Wait for active requests (max 10s)
     │                             │                             │
     │                             │<────────────────────────────│
     │                             │  Return (nil or timeout err)
     │                             │                             │
     │                             │ <-ctx.Done()                │
     │                             │  (blocks until complete)    │
     │                             │                             │
     │                             │ Log: "Server terminated"    │
     │                             │                             │
     │<────────────────────────────│                             │
     │  Serve() returns            │                             │
     │                             │                             │
```

### Shutdown Timeout Behavior

**Scenario 1: Clean Shutdown (within 10s)**

```
T+0s:   SIGINT received
T+0s:   server.Shutdown(ctx) called
T+0s:   Stop accepting new connections
T+1s:   3 active requests still processing
T+2s:   2 active requests remaining
T+3s:   1 active request remaining
T+4s:   All requests complete
T+4s:   Shutdown returns nil
T+4s:   Log: "Server terminated successfully"
T+4s:   Serve() returns
```

**Scenario 2: Timeout Shutdown (>10s)**

```
T+0s:   SIGTERM received
T+0s:   server.Shutdown(ctx) called
T+0s:   Stop accepting new connections
T+1s:   5 active requests (long-running queries)
...
T+9s:   Still 2 active requests
T+10s:  Context timeout exceeded
T+10s:  Shutdown returns context.DeadlineExceeded
T+10s:  Active connections forcibly closed
T+10s:  Log: "Could not shutdown server properly: context deadline exceeded"
T+10s:  Serve() returns
```

### Best Practices

1. **Configure WriteTimeout:** Ensure requests complete before 10s shutdown deadline
2. **Implement Health Checks:** Stop receiving traffic before shutdown
3. **Database Connection Pools:** Close pools in deferred cleanup
4. **Background Workers:** Use context cancellation to stop goroutines

```go
func main() {
    server := NewServer(...)
    defer cleanupResources()  // Close DB, cache connections
    
    // Register cleanup on signal
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
    
    go func() {
        <-c
        server.Shutdown()  // Trigger graceful shutdown
    }()
    
    server.Serve()  // Blocks until shutdown
}
```

---

## Logging Strategy

### Dual Logger Architecture

The engine maintains two separate loggers for different audiences:

#### 1. ExternalLogger (Structured JSON)

**Purpose:** Machine-readable logs for aggregation/analysis (ELK, Splunk, CloudWatch)

**Format:**
```json
{"level":"info","time":"2026-02-04T10:30:00Z","message":"Starting server on :8080"}
{"level":"error","time":"2026-02-04T10:35:12Z","message":"Could not shutdown server properly: context deadline exceeded"}
```

**Configuration:**
```go
ExternalLogger: zerolog.New(logger)  // logger is io.Writer (file, stdout, etc.)
```

#### 2. ColorizedLogger (Human-Readable)

**Purpose:** Developer-friendly console output during local development

**Format:**
```
2026-02-04T10:30:00Z | INFO   | Starting server on :8080
2026-02-04T10:35:12Z | ERROR  | Could not shutdown server properly: context deadline exceeded
```

**Configuration:**
```go
colorizedLogger := zerolog.NewConsoleWriter()
colorizedLogger.NoColor = false
colorizedLogger.FormatLevel = func(i interface{}) string {
    return strings.ToUpper(fmt.Sprintf("| %-6s|", i))
}
server.ColorizedLogger = zerolog.New(colorizedLogger).With().Timestamp().Logger()
```

### Log Levels

| Level | Use Case | Example |
|-------|----------|---------|
| **Info** | Server lifecycle events | "Starting server on :8080" |
| **Error** | Failures requiring attention | "Could not start server engine" |
| **Debug** | (Not currently used) | Internal state inspection |
| **Warn** | (Not currently used) | TLS cert expiration warnings |

### Structured Logging Example

```go
// Add contextual fields:
logger.Info().
    Str("server", s.ServerName).
    Str("address", string(s.Address)).
    Bool("tls", s.Opts.EnableTls).
    Msg("Server started")

// Output (JSON):
// {"level":"info","server":"Gateway","address":":8080","tls":true,"message":"Server started"}
```

---

## Error Handling

### Error Categories

#### 1. Startup Errors

**TLS Certificate Loading:**
```go
certificates, err := collectTlsCertificates(s.TlsConfigDir)
if err != nil {
    logger.Error().Msgf("error occurred loading tls certificate: %v", err)
    // Execution continues - will fail at ListenAndServeTLS
}
```

**Issue:** Error is logged but not returned. Server will fail at `ListenAndServeTLS` with cryptic error.

**Recommendation:** Return error from `Serve()` or panic:
```go
if err != nil {
    logger.Fatal().Msgf("Failed to load TLS certificates: %v", err)
    // Or: return err
}
```

#### 2. Runtime Errors

**Server Listen Failure:**
```go
err := s.server.ListenAndServe()
if err != nil && !errors.Is(err, http.ErrServerClosed) {
    logger.Error().Msg("Could not start server engine")
    // Goroutine exits, main thread still blocked on shutdownChannel
}
```

**Issue:** Silent failure - main thread never knows server failed to start.

**Recommendation:** Use error channel:
```go
errChan := make(chan error, 1)
go func() {
    if err := s.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
        errChan <- err
    }
}()

select {
case err := <-errChan:
    logger.Fatal().Msgf("Server failed to start: %v", err)
case sig := <-s.shutdownChannel:
    // Normal shutdown
}
```

#### 3. Shutdown Errors

**Timeout Exceeded:**
```go
if err := s.server.Shutdown(ctx); err != nil {
    logger.Error().Msgf("Could not shutdown server properly: %v", err)
    // Logged but not propagated
}
```

**Issue:** Caller doesn't know shutdown failed.

**Recommendation:** Return error from `Serve()`:
```go
func (s *Server) Serve() error {
    // ... shutdown logic ...
    return s.server.Shutdown(ctx)
}
```

---

## Testing Strategy

### Unit Testing

#### Test Structure (from server_test.go)

```go
func TestServerWithMux(t *testing.T) {
    // 1. Setup
    server := setupTestServer()
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    
    // 2. Start server
    go server.Serve()
    
    // 3. Schedule shutdown
    go func() {
        <-ctx.Done()
        server.Shutdown()
    }()
    
    // 4. Wait for server to start
    time.Sleep(100 * time.Millisecond)
    
    // 5. Make request
    resp, err := http.Get("http://localhost:8082/user")
    assert.NoError(t, err)
    defer resp.Body.Close()
    
    // 6. Verify response
    assert.Equal(t, http.StatusOK, resp.StatusCode)
    var receivedData []User
    json.NewDecoder(resp.Body).Decode(&receivedData)
    assert.Equal(t, testData, receivedData)
}
```

#### Test Coverage Areas

1. **Server Lifecycle:**
   - Start server (HTTP mode)
   - Start server (HTTPS mode)
   - Graceful shutdown via Shutdown()
   - Signal-based shutdown

2. **Request Handling:**
   - HTTP GET/POST requests
   - Header size limits (MaxHeaderBytes)
   - Timeout enforcement (WriteTimeout, ReadHeaderTimeout)

3. **TLS Configuration:**
   - Certificate loading (valid pairs)
   - Missing key files (error case)
   - Invalid certificate format (error case)

4. **Logging:**
   - ExternalLogger output verification
   - ColorizedLogger formatting
   - Error log capture

### Integration Testing

```go
func TestServerIntegration(t *testing.T) {
    // 1. Create temporary TLS certificates
    tmpDir := t.TempDir()
    generateTestCerts(tmpDir)
    
    // 2. Setup HTTPS server
    server := NewServer(
        "TestServer",
        8443,
        os.Stdout,
        tmpDir,
        ServerOpts{EnableTls: true, ...},
    )
    server.Mux = router
    
    // 3. Start server
    go server.Serve()
    defer server.Shutdown()
    
    // 4. Create HTTPS client
    client := &http.Client{
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{
                InsecureSkipVerify: true,  // Accept self-signed cert
            },
        },
    }
    
    // 5. Make HTTPS request
    resp, err := client.Get("https://localhost:8443/health")
    assert.NoError(t, err)
    assert.Equal(t, http.StatusOK, resp.StatusCode)
}
```

### Benchmark Testing

```go
func BenchmarkServerThroughput(b *testing.B) {
    server := setupTestServer()
    go server.Serve()
    defer server.Shutdown()
    
    time.Sleep(100 * time.Millisecond)
    
    client := &http.Client{
        Transport: &http.Transport{
            MaxIdleConnsPerHost: 100,
        },
    }
    
    b.ResetTimer()
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            resp, _ := client.Get("http://localhost:8082/health")
            resp.Body.Close()
        }
    })
}
```

---

## Performance Considerations

### Connection Pooling

**Default Behavior:** Go HTTP server reuses connections for keep-alive requests.

**Configuration:**
```go
IdleTimeout: 120 * time.Second  // How long to keep idle connections open
```

**Tuning:**
- **High Traffic:** Short IdleTimeout (30s) to reclaim resources
- **Low Traffic:** Long IdleTimeout (300s) to reduce handshake overhead

### Header Size Limits

**Purpose:** Prevent DoS attacks via large headers

**Configuration:**
```go
MaxHeaderBytes: 1 << 20  // 1 MB (default in Go: 1 MB)
```

**Attack Scenario:**
```
Client sends: GET / HTTP/1.1
Cookie: <1GB of data>

Without limit: Server allocates 1GB memory → OOM
With limit (1MB): Request rejected, 431 Request Header Fields Too Large
```

### Timeout Tuning

**ReadHeaderTimeout:**
```go
ReadHeaderTimeout: 5 * time.Second
```
- **Too Short:** Legitimate slow clients rejected
- **Too Long:** Vulnerable to Slowloris attacks

**WriteTimeout:**
```go
WriteTimeout: 10 * time.Second
```
- **Too Short:** Large responses truncated for slow clients
- **Too Long:** Slow clients hold connections indefinitely

**Recommended Values:**

| Service Type | ReadHeaderTimeout | WriteTimeout | IdleTimeout |
|--------------|-------------------|--------------|-------------|
| API Gateway | 5s | 30s | 120s |
| File Upload | 10s | 300s | 60s |
| Streaming | 5s | 0 (no limit) | 300s |
| Admin Panel | 30s | 30s | 600s |

### Memory Usage

**Per-Connection Overhead:** ~10-20 KB (buffers, goroutine stack)

**Calculation:**
```
10,000 concurrent connections × 15 KB = 150 MB base overhead
+ application memory (request processing)
```

**Monitoring:**
```go
// Add metrics to Server struct:
func (s *Server) GetStats() ServerStats {
    return ServerStats{
        ActiveConnections: runtime.NumGoroutine() - baseGoroutines,
        MemoryUsage:       getMemStats(),
    }
}
```

---

## Security

### Threat Model

#### 1. Slowloris Attack (Slow Headers)

**Attack:** Client sends headers byte-by-byte to hold connections open

**Mitigation:**
```go
ReadHeaderTimeout: 5 * time.Second  // Force header completion within 5s
```

**Result:** Malicious clients disconnected after 5s, freeing resources.

#### 2. Large Header Attack

**Attack:** Send massive headers to exhaust server memory

**Mitigation:**
```go
MaxHeaderBytes: 1 << 20  // Limit headers to 1 MB
```

**Result:** Request rejected with 431 status code.

#### 3. TLS Downgrade Attack

**Attack:** MITM forces HTTP connection instead of HTTPS

**Mitigation:**
```go
// Redirect HTTP → HTTPS (separate HTTP server):
httpServer := NewServer("Redirector", 80, os.Stdout, "", opts)
httpServer.Mux = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    httpsURL := "https://" + r.Host + r.RequestURI
    http.Redirect(w, r, httpsURL, http.StatusMovedPermanently)
})
go httpServer.Serve()
```

#### 4. Certificate Validation Bypass

**Current Issue:**
```go
ClientAuth: tls.VerifyClientCertIfGiven  // Optional mutual TLS
```

**For Internal Services:** Use strict verification:
```go
ClientAuth: tls.RequireAndVerifyClientCert
```

### Security Checklist

- [ ] Enable TLS in production (`EnableTls: true`)
- [ ] Set `ReadHeaderTimeout` to prevent Slowloris (recommended: 5-10s)
- [ ] Limit `MaxHeaderBytes` to prevent memory exhaustion (recommended: 1-4 MB)
- [ ] Configure `WriteTimeout` to prevent slow-read attacks (recommended: 30s)
- [ ] Use strong TLS ciphers (add `CipherSuites` configuration)
- [ ] Set `MinVersion: tls.VersionTLS12` (no TLS 1.0/1.1)
- [ ] Implement rate limiting (external middleware)
- [ ] Validate certificate expiration dates (monitoring)
- [ ] Rotate TLS certificates regularly (Let's Encrypt auto-renewal)
- [ ] Use Mutual TLS for internal services (`RequireAndVerifyClientCert`)

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
    // 1. Create Gin router
    router := gin.Default()
    
    router.POST("/upload", handleUpload)
    router.GET("/download/:fileID", handleDownload)
    router.DELETE("/delete/:fileID", handleDelete)
    
    // 2. Create engine server
    server := engine.NewServer(
        "GatewayServer",
        8080,
        os.Stdout,
        "/etc/hercules/tls",
        engine.ServerOpts{
            EnableTls:         true,
            MaxHeaderBytes:    4 << 20,  // 4 MB
            ReadHeaderTimeout: 10 * time.Second,
            WriteTimeout:      300 * time.Second,  // Large file uploads
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: false,
        },
    )
    
    // 3. Inject router
    server.Mux = router
    
    // 4. Start server (blocks until SIGINT/SIGTERM)
    server.Serve()
}
```

### Example 2: Master Server with Chi

```go
package main

import (
    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/caleberi/hercules-dfs/engine"
)

func main() {
    r := chi.NewRouter()
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    
    r.Get("/metadata/{path}", getMetadata)
    r.Post("/create", createFile)
    r.Put("/rename", renameFile)
    
    server := engine.NewServer(
        "MasterServer",
        9000,
        os.Stdout,
        "",  // HTTP only for internal communication
        engine.ServerOpts{
            EnableTls:         false,
            MaxHeaderBytes:    1 << 20,
            ReadHeaderTimeout: 5 * time.Second,
            WriteTimeout:      10 * time.Second,
            IdleTimeout:       120 * time.Second,
            UseColorizedLogger: true,  // Development mode
        },
    )
    
    server.Mux = r
    server.Serve()
}
```

### Example 3: Health Check Endpoint

```go
func setupHealthCheckServer() *engine.Server {
    mux := http.NewServeMux()
    
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status":"healthy","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`))
    })
    
    mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
        // Check dependencies (DB, cache, etc.)
        if allDependenciesReady() {
            w.WriteHeader(http.StatusOK)
        } else {
            w.WriteHeader(http.StatusServiceUnavailable)
        }
    })
    
    server := engine.NewServer(
        "HealthCheck",
        8081,
        os.Stdout,
        "",
        engine.ServerOpts{
            EnableTls:      false,
            MaxHeaderBytes: 1024,  // Tiny headers for health checks
            ReadHeaderTimeout: 1 * time.Second,
            WriteTimeout:      1 * time.Second,
            IdleTimeout:       10 * time.Second,
        },
    )
    
    server.Mux = mux
    return server
}
```

---

## Future Enhancements

### 1. HTTP/2 Support

```go
type ServerOpts struct {
    // ... existing fields ...
    EnableHTTP2 bool  // Enable HTTP/2 support
}

// In Serve():
if s.Opts.EnableHTTP2 {
    http2.ConfigureServer(s.server, &http2.Server{})
}
```

### 2. Metrics Middleware

```go
type ServerMetrics struct {
    RequestCount  atomic.Int64
    ErrorCount    atomic.Int64
    ResponseTimes []time.Duration
}

func (s *Server) MetricsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        s.metrics.RequestCount.Add(1)
        s.metrics.ResponseTimes = append(s.metrics.ResponseTimes, time.Since(start))
    })
}
```

### 3. Dynamic Certificate Reloading

```go
func (s *Server) WatchCertificates() {
    watcher, _ := fsnotify.NewWatcher()
    watcher.Add(s.TlsConfigDir)
    
    for {
        select {
        case event := <-watcher.Events:
            if event.Op&fsnotify.Write == fsnotify.Write {
                s.reloadCertificates()
            }
        }
    }
}

func (s *Server) reloadCertificates() {
    certificates, _ := collectTlsCertificates(s.TlsConfigDir)
    s.server.TLSConfig.Certificates = certificates
    log.Println("Certificates reloaded")
}
```

### 4. Request ID Tracing

```go
func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestID := r.Header.Get("X-Request-ID")
        if requestID == "" {
            requestID = uuid.New().String()
        }
        
        ctx := context.WithValue(r.Context(), "request_id", requestID)
        w.Header().Set("X-Request-ID", requestID)
        
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### 5. Connection Draining

```go
func (s *Server) DrainConnections(timeout time.Duration) {
    s.server.SetKeepAlivesEnabled(false)  // Stop accepting new keep-alive requests
    time.Sleep(timeout)  // Allow existing requests to complete
    s.Shutdown()
}
```

### 6. Custom Error Pages

```go
type ServerOpts struct {
    // ... existing fields ...
    ErrorPageHandler func(w http.ResponseWriter, r *http.Request, status int)
}

// Custom 404/500 pages:
func customErrorHandler(w http.ResponseWriter, r *http.Request, status int) {
    w.WriteHeader(status)
    fmt.Fprintf(w, "<html><body><h1>Error %d</h1></body></html>", status)
}
```

---

## Conclusion

The **Engine** package provides a robust, production-ready HTTP server framework with:

✅ **Security:** TLS support, timeout protection, header limits  
✅ **Reliability:** Graceful shutdown, signal handling, error logging  
✅ **Observability:** Dual logging (structured + colorized)  
✅ **Flexibility:** Works with any HTTP router (Gin, Chi, stdlib)  
✅ **Simplicity:** Minimal API surface, sensible defaults  

**Key Strengths:**
- Clean abstraction over `net/http`
- Graceful shutdown with configurable timeout
- TLS certificate auto-discovery
- Dual logging for dev and prod

**Areas for Improvement:**
- TLS error handling (fail-fast vs. continue)
- Server start failure propagation (error channel)
- Shutdown error return (expose to caller)
- HTTP/2 support
- Metrics/tracing middleware

This design provides a solid foundation for all HTTP services in Hercules DFS, balancing simplicity with production requirements.
