// main.go is the entry point for the Hercules distributed system, launching either a MasterServer
// or a ChunkServer based on command-line flags. It sets up signal handling for graceful shutdown
// and initializes the server with configurable parameters for address, root directory, and logging.
//
// Usage:
//
//	go run main.go [-isMaster] [-serverAddress <address>] [-masterAddr <address>] [-rootDir <directory>] [-logLevel <level>]
//
// Example:
//
//	# Run as MasterServer
//	go run main.go -isMaster -serverAddress 127.0.0.1:9090 -rootDir mroot
//	# Run as ChunkServer
//	go run main.go -serverAddress 127.0.0.1:8085 -masterAddr 127.0.0.1:9090 -rootDir croot
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"
	"time"

	chunkserver "github.com/caleberi/distributed-system/chunkserver"
	"github.com/caleberi/distributed-system/common"
	"github.com/caleberi/distributed-system/gateway"
	"github.com/caleberi/distributed-system/hercules"
	masterserver "github.com/caleberi/distributed-system/master_server"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	ChunkServer    string = "chunk_server"
	MasterServer   string = "master_server"
	GatewayAddress string = "gateway_server"
)

type Config struct {
	ServerType     string
	RootDir        string
	LogLevel       string
	ServerAddress  common.ServerAddr
	MasterAddress  common.ServerAddr
	RedisAddress   common.ServerAddr
	GatewayAddress int
}

func parseConfig() (Config, error) {
	serverType := flag.String("ServerType", "chunk_server", "run as a particular server (default: chunk_server, master_server, gateway_server)")
	serverAddress := flag.String("serverAddr", "127.0.0.1:8085", "server address to listen on (host:port)")
	masterAddress := flag.String("masterAddr", "127.0.0.1:9090", "master server address (host:port)")
	redisAddress := flag.String("redisAddr", "127.0.0.1:9090", "redis server address (host:port)")
	gatewayAddress := flag.Int("gatewayAddr", 8089, "gateway http server address (host:port)")
	rootDir := flag.String("rootDir", "mroot", "root directory for file system storage")
	logLevel := flag.String("logLevel", "debug", "logging level (debug, info, warn, error)")

	flag.Parse()

	absRootDir, err := filepath.Abs(*rootDir)
	if err != nil {
		return Config{}, fmt.Errorf("failed to resolve root directory %s: %w", *rootDir, err)
	}

	switch *logLevel {
	case "debug", "info", "warn", "error":
	default:
		return Config{}, fmt.Errorf("invalid log level: %s; must be debug, info, warn, or error", *logLevel)
	}

	supportedServerType := []string{GatewayAddress, ChunkServer, MasterServer}
	if !slices.Contains(supportedServerType, *serverType) {
		return Config{}, fmt.Errorf("server type not supported")
	}
	return Config{
		ServerType:     *serverType,
		ServerAddress:  common.ServerAddr(*serverAddress),
		MasterAddress:  common.ServerAddr(*masterAddress),
		GatewayAddress: *gatewayAddress,
		RedisAddress:   common.ServerAddr(*redisAddress),
		RootDir:        absRootDir,
		LogLevel:       *logLevel,
	}, nil
}

func setupLogger(level string) error {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	switch level {
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	default:
		return fmt.Errorf("unsupported log level: %s", level)
	}
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	return nil
}

func main() {
	cfg, err := parseConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse configuration: %v\n", err)
		os.Exit(1)
	}

	if err := setupLogger(cfg.LogLevel); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to setup logger: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	switch cfg.ServerType {
	case ChunkServer:
		log.Info().Msgf("Starting ChunkServer on %s, connecting to master at %s, using root directory %s",
			cfg.ServerAddress, cfg.MasterAddress, cfg.RootDir)
		server, err := chunkserver.NewChunkServer(cfg.ServerAddress, cfg.MasterAddress, cfg.RedisAddress, cfg.RootDir)
		if err != nil {
			log.Error().Err(err).Msg("Failed to create ChunkServer")
			os.Exit(1)
		}
		go func() {
			<-quit
			log.Info().Msg("Received shutdown signal, stopping ChunkServer...")
			if err := server.Shutdown(); err != nil {
				log.Err(err).Msg("Error shutting down ChunkServer")
			}
			cancel()
		}()
		<-ctx.Done()
	case MasterServer:
		log.Info().Msgf("Starting MasterServer on %s with root directory %s", cfg.ServerAddress, cfg.RootDir)
		server := masterserver.NewMasterServer(ctx, cfg.ServerAddress, cfg.RootDir)
		go func() {
			<-quit
			log.Info().Msg("Received shutdown signal, stopping MasterServer...")
			server.Shutdown()
			cancel()
		}()
		<-ctx.Done()
	default:
		log.Info().Msgf("Starting GatewayServer on :%d", cfg.GatewayAddress)
		client := hercules.NewHerculesClient(ctx, cfg.MasterAddress, 5*time.Minute)
		server, err := gateway.NewHerculesHTTPGateway(
			ctx, client,
			gateway.GatewayConfig{
				ServerName:     "Gateway",
				Address:        cfg.GatewayAddress,
				Logger:         log.Logger,
				TlsDir:         "",
				EnableTLS:      false,
				MaxHeaderBytes: 1 << 20,
				IdleTimeout:    10 * time.Second,
				ReadTimeout:    15 * time.Second,
				WriteTimeout:   30 * time.Second,
			})
		if err != nil {
			log.Err(err).Msg("Error starting server")
			os.Exit(1)
		}
		server.Start()
		go func() {
			<-quit
			log.Info().Msg("Received shutdown signal, stopping Gateway Server...")
			if err := server.Shutdown(); err != nil {
				log.Err(err).Msg("Error shutting down Gateway Server")
			}
			cancel()
		}()
		<-ctx.Done()
	}

	log.Info().Msg("Server shutdown complete")
}
