package gateway

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"sync"
	"time"

	"github.com/caleberi/distributed-system/common"
	"github.com/caleberi/distributed-system/engine"
	sdk "github.com/caleberi/distributed-system/hercules"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
)

// HerculesHTTPGateway provides an HTTP interface for the Hercules distributed file system.
// It translates HTTP requests into HerculesClient RPC calls, following GFS specifications.
type HerculesHTTPGateway struct {
	client *sdk.HerculesClient
	server *engine.Server
	ctx    context.Context
	cancel context.CancelFunc
	logger zerolog.Logger
	mu     sync.RWMutex
}

// GatewayConfig defines configuration options for the HTTP gateway.
type GatewayConfig struct {
	ServerName     string        // Server name for logging
	Address        int           // Server port
	Logger         io.Writer     // Logger writer
	TlsDir         string        // TLS certificate directory
	EnableTLS      bool          // Enable TLS
	MaxHeaderBytes int           // Maximum header size
	ReadTimeout    time.Duration // HTTP read timeout
	WriteTimeout   time.Duration // HTTP write timeout
	IdleTimeout    time.Duration // HTTP idle timeout
}

// DefaultGatewayConfig returns sensible default configuration values.
func DefaultGatewayConfig() GatewayConfig {
	return GatewayConfig{
		ServerName:     "hercules-gateway",
		Address:        8080,
		Logger:         zerolog.Nop(),
		TlsDir:         "",
		EnableTLS:      false,
		MaxHeaderBytes: 1 << 20, // 1 MB
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    120 * time.Second,
	}
}

// NewHerculesHTTPGateway creates a new HTTP gateway for the Hercules file system.
func NewHerculesHTTPGateway(
	ctx context.Context, client *sdk.HerculesClient, config GatewayConfig) (*HerculesHTTPGateway, error) {
	actx, cancel := context.WithCancel(ctx)

	router := gin.New(func(e *gin.Engine) {
		e.Use(gin.Logger())
		e.Use(gin.Recovery())
		e.Use(cors.New(cors.Config{
			AllowOrigins: []string{"*"},
			AllowMethods: []string{"PUT", "PATCH", "GET", "POST", "DELETE", "OPTIONS"},
			AllowHeaders: []string{
				"Content-Type", "Content-Length",
				"accept", "origin", "Cache-Control",
			},
			ExposeHeaders:    []string{"Content-Length"},
			AllowCredentials: true,
			AllowWildcard:    false,
			MaxAge:           12 * time.Hour,
		}))
		e.RemoveExtraSlash = true
		e.UnescapePathValues = false
		e.RedirectTrailingSlash = false
	})

	gateway := &HerculesHTTPGateway{
		client: client,
		ctx:    actx,
		cancel: cancel,
		mu:     sync.RWMutex{},
	}

	loggerWriter := config.Logger
	if loggerWriter == nil {
		loggerWriter = zerolog.Nop()
	}

	var err error
	gateway.server, err = engine.NewServer(
		config.ServerName,
		config.Address,
		loggerWriter,
		config.TlsDir,
		engine.ServerOpts{
			EnableTls:                    config.EnableTLS,
			MaxHeaderBytes:               config.MaxHeaderBytes,
			ReadHeaderTimeout:            config.ReadTimeout,
			WriteTimeout:                 config.WriteTimeout,
			IdleTimeout:                  config.IdleTimeout,
			DisableGeneralOptionsHandler: false,
			UseColorizedLogger:           true,
		},
	)
	if err != nil {
		return nil, err
	}

	gateway.registerRoutes(router)
	gateway.server.Mux = router

	if config.Logger != nil {
		gateway.logger = zerolog.New(config.Logger).With().Timestamp().Logger()
	} else {
		gateway.logger = zerolog.Nop()
	}

	return gateway, nil
}

// registerRoutes sets up all HTTP endpoints following GFS operations.
func (g *HerculesHTTPGateway) registerRoutes(router *gin.Engine) {
	// Chunk operations
	router.GET("/api/v1/chunk/handle", g.handleGetChunkHandle)
	router.GET("/api/v1/chunk/servers", g.handleGetChunkServers)

	// File system operations
	router.POST("/api/v1/mkdir", g.handleMkDir)
	router.POST("/api/v1/create", g.handleCreateFile)
	router.DELETE("/api/v1/delete", g.handleDeleteFile)
	router.PATCH("/api/v1/rename", g.handleRenameFile)
	router.GET("/api/v1/list", g.handleList)
	router.GET("/api/v1/fileinfo", g.handleGetFileInfo)

	// Data operations
	router.GET("/api/v1/read", g.handleRead)
	router.POST("/api/v1/write", g.handleWrite)
	router.PATCH("/api/v1/append", g.handleAppend)

	// Health check
	router.GET("/health", g.handleHealth)
}

// Start begins listening for HTTP requests using engine.Server.
func (g *HerculesHTTPGateway) Start() {
	g.logger.Info().
		Str("address", string(g.server.Address)).
		Str("server_name", g.server.ServerName).
		Msg("Starting Hercules HTTP Gateway")

	go g.server.Serve()
}

// Shutdown gracefully stops the HTTP server using engine.Server's shutdown.
func (g *HerculesHTTPGateway) Shutdown() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.cancel()

	if g.server == nil {
		return nil
	}

	g.logger.Info().Msg("Shutting down Hercules HTTP Gateway")
	g.server.Shutdown()

	return nil
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type SuccessResponse struct {
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func (g *HerculesHTTPGateway) respondJSON(c *gin.Context, status int, data interface{}) {
	c.JSON(status, data)
}

func (g *HerculesHTTPGateway) respondError(c *gin.Context, status int, err error) {
	g.logger.Error().Err(err).Int("status", status).Msg("Request error")
	code := ""
	if cerr, ok := err.(common.Error); ok {
		code = fmt.Sprint(cerr.Code)
	}
	c.JSON(status, ErrorResponse{
		Error:   err.Error(),
		Code:    code,
		Message: "Operation failed",
	})
}

func (g *HerculesHTTPGateway) handleMkDir(c *gin.Context) {

	var req struct {
		Path string `json:"path"`
	}

	if err := c.BindJSON(&req); err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	if req.Path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	g.mu.RLock()
	err := g.client.MkDir(common.Path(req.Path))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "Directory created successfully",
		Data:    map[string]string{"path": req.Path},
	})
}

func (g *HerculesHTTPGateway) handleCreateFile(c *gin.Context) {

	var req struct {
		Path string `json:"path"`
	}

	if err := c.BindJSON(&req); err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	if req.Path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	dirPath := path.Dir(req.Path)
	var err error
	if dirPath != "/" && dirPath != "." {
		g.mu.Lock()
		err = g.client.MkDir(common.Path(dirPath))
		g.mu.Unlock()
		if err != nil {
			g.respondError(c, http.StatusInternalServerError, err)
			return
		}
	}

	g.mu.Lock()
	err = g.client.CreateFile(common.Path(req.Path))
	g.mu.Unlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "File created successfully",
		Data:    map[string]string{"path": req.Path},
	})
}

func (g *HerculesHTTPGateway) handleDeleteFile(c *gin.Context) {

	var req struct {
		Path string `json:"path"`
	}

	if err := c.BindJSON(&req); err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	if req.Path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	g.mu.RLock()
	info, infoErr := g.client.GetFile(common.Path(req.Path))
	g.mu.RUnlock()
	if infoErr != nil {
		g.respondError(c, http.StatusInternalServerError, infoErr)
		return
	}

	if info.IsDir {
		g.mu.RLock()
		err := g.client.RemoveDir(common.Path(req.Path))
		g.mu.RUnlock()
		if err != nil {
			g.respondError(c, http.StatusInternalServerError, err)
			return
		}

		g.respondJSON(c, http.StatusOK, SuccessResponse{
			Success: true,
			Message: "Directory deleted successfully",
			Data:    map[string]string{"path": req.Path},
		})
		return
	}

	g.mu.RLock()
	err := g.client.DeleteFile(common.Path(req.Path), false)
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "File deleted successfully",
		Data:    map[string]string{"path": req.Path},
	})
}

func (g *HerculesHTTPGateway) handleRenameFile(c *gin.Context) {
	var req struct {
		Source string `json:"source"`
		Target string `json:"target"`
	}

	if err := c.BindJSON(&req); err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	if req.Source == "" || req.Target == "" {
		g.respondError(
			c, http.StatusBadRequest,
			fmt.Errorf("source and target paths are required"))
		return
	}

	g.mu.RLock()
	err := g.client.RenameFile(common.Path(req.Source), common.Path(req.Target))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "File renamed successfully",
		Data: map[string]string{
			"source": req.Source,
			"target": req.Target,
		},
	})
}

func (g *HerculesHTTPGateway) handleList(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		path = "/"
	}

	g.mu.RLock()
	entries, err := g.client.List(common.Path(path))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Data: map[string]any{
			"path":    path,
			"entries": entries,
		},
	})
}

func (g *HerculesHTTPGateway) handleGetFileInfo(c *gin.Context) {

	path := c.Query("path")
	if path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	g.mu.RLock()
	fileInfo, err := g.client.GetFile(common.Path(path))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Data: map[string]any{
			"path":   path,
			"is_dir": fileInfo.IsDir,
			"length": fileInfo.Length,
			"chunks": fileInfo.Chunks,
		},
	})
}

func (g *HerculesHTTPGateway) handleRead(c *gin.Context) {

	path := c.Query("path")
	offsetStr := c.Query("offset")
	lengthStr := c.Query("length")

	if path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	offset, err := strconv.ParseInt(offsetStr, 10, 64)
	if err != nil {
		offset = 0
	}

	length, err := strconv.ParseInt(lengthStr, 10, 64)
	if err != nil || length <= 0 {
		length = 4096
	}

	data := make([]byte, length)

	g.mu.RLock()
	n, err := g.client.Read(common.Path(path), common.Offset(offset), data)
	g.mu.RUnlock()

	if err != nil && err != io.EOF {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	c.Header("X-Bytes-Read", strconv.Itoa(n))
	c.Data(http.StatusOK, "application/octet-stream", data[:n])
}

func (g *HerculesHTTPGateway) handleWrite(c *gin.Context) {

	path := c.Query("path")
	offsetStr := c.Query("offset")

	if path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	offset, err := strconv.ParseInt(offsetStr, 10, 64)
	if err != nil {
		offset = 0
	}

	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	g.mu.RLock()
	n, err := g.client.Write(common.Path(path), common.Offset(offset), data)
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "Data written successfully",
		Data: map[string]any{
			"bytes_written": n,
			"offset":        offset,
		},
	})
}

func (g *HerculesHTTPGateway) handleAppend(c *gin.Context) {

	path := c.Query("path")
	if path == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}

	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		g.respondError(c, http.StatusBadRequest, err)
		return
	}

	g.mu.RLock()
	offset, err := g.client.Append(common.Path(path), data)
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Message: "Data appended successfully",
		Data: map[string]any{
			"offset":      offset,
			"bytes_added": len(data),
		},
	})
}

func (g *HerculesHTTPGateway) handleGetChunkHandle(c *gin.Context) {

	path := c.Query("path")
	indexStr := c.Query("index")

	if path == "" || indexStr == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("path and index are required"))
		return
	}

	index, err := strconv.ParseInt(indexStr, 10, 64)
	if err != nil {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("invalid index"))
		return
	}

	g.mu.RLock()
	handle, err := g.client.GetChunkHandle(common.Path(path), common.ChunkIndex(index))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Data: map[string]any{
			"handle": handle,
			"path":   path,
			"index":  index,
		},
	})
}

func (g *HerculesHTTPGateway) handleGetChunkServers(c *gin.Context) {

	handleStr := c.Query("handle")
	if handleStr == "" {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("handle is required"))
		return
	}

	handle, err := strconv.ParseInt(handleStr, 10, 64)
	if err != nil {
		g.respondError(c, http.StatusBadRequest, fmt.Errorf("invalid handle"))
		return
	}

	g.mu.RLock()
	lease, err := g.client.GetChunkServers(common.ChunkHandle(handle))
	g.mu.RUnlock()

	if err != nil {
		g.respondError(c, http.StatusInternalServerError, err)
		return
	}

	g.respondJSON(c, http.StatusOK, SuccessResponse{
		Success: true,
		Data: map[string]any{
			"handle":      lease.Handle,
			"primary":     lease.Primary,
			"secondaries": lease.Secondaries,
			"expire":      lease.Expire,
		},
	})
}

func (g *HerculesHTTPGateway) handleHealth(c *gin.Context) {
	g.respondJSON(c, http.StatusOK, map[string]any{
		"status":  "healthy",
		"service": "hercules-http-gateway",
		"time":    time.Now().Unix(),
	})
}
