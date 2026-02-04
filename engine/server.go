package engine

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rs/zerolog"
)

// ServerAddress represents the network address for an HTTP server.
type ServerAddress string

// ServerOpts defines configuration options for the HTTP server.
type ServerOpts struct {
	EnableTls                    bool          // Whether to enable TLS for secure connections
	MaxHeaderBytes               int           // Maximum size of request headers in bytes
	ReadHeaderTimeout            time.Duration // Timeout for reading request headers
	WriteTimeout                 time.Duration // Timeout for writing responses
	IdleTimeout                  time.Duration // Timeout for idle connections
	DisableGeneralOptionsHandler bool          // Whether to disable the default OPTIONS handler
	UseColorizedLogger           bool          // Whether to use a colorized console logger
	ShutdownTimeout              time.Duration
}

// Server represents an HTTP server with support for TLS and graceful shutdown.
type Server struct {
	server          *http.Server   // Underlying HTTP server instance
	shutdownChannel chan os.Signal // Channel for receiving shutdown signals
	errorLogger     *log.Logger    // Logger for server errors
	ServerName      string         // Name of the server for logging purposes
	Opts            ServerOpts     // Server configuration options
	Address         ServerAddress  // Network address to listen on
	TlsConfigDir    string         // Directory containing TLS certificate and key files
	ExternalLogger  zerolog.Logger // External logger for server events
	ColorizedLogger zerolog.Logger // Colorized console logger (used if enabled)
	Mux             http.Handler   // HTTP request multiplexer
	shutdownOnce    sync.Once
}

// NewServer creates a new Server instance with the specified configuration.
//
// It initializes the server with a name, address, logger, TLS directory, and options.
// If UseColorizedLogger is enabled in opts, a colorized console logger is configured.
// A shutdown channel is created to handle graceful shutdown signals (SIGINT, SIGTERM).
//
// Parameters:
//   - serverName: The name of the server, used in logs.
//   - address: The network address to listen on (e.g., ":8080").
//   - logger: The io.Writer for the external zerolog logger.
//   - tlsDir: The directory containing TLS certificate (.cert) and key (.key) files.
//   - opts: The ServerOpts configuration for the server.
//
// Returns:
//   - A pointer to a new Server instance.
func NewServer(
	serverName string, address int, logger io.Writer, tlsDir string, opts ServerOpts) (*Server, error) {

	if serverName == "" {
		return nil, fmt.Errorf("serverName cannot be empty")
	}

	if address < 1 || address > 65535 {
		return nil, fmt.Errorf("address must be between 1-65535, got %d", address)
	}

	if logger == nil {
		return nil, fmt.Errorf("logger cannot be nil")
	}

	if opts.EnableTls && tlsDir == "" {
		return nil, fmt.Errorf("tlsDir required when EnableTls is true")
	}

	if opts.MaxHeaderBytes < 0 {
		return nil, fmt.Errorf("MaxHeaderBytes cannot be negative")
	}

	server := &Server{
		ServerName:      serverName,
		Address:         ServerAddress(fmt.Sprintf(":%d", address)),
		Opts:            opts,
		TlsConfigDir:    tlsDir,
		ExternalLogger:  zerolog.New(logger),
		shutdownChannel: make(chan os.Signal, 1),
		errorLogger: log.New(
			os.Stderr,
			fmt.Sprintf("[%s] ", serverName),
			log.Ldate|log.Llongfile|log.Ltime,
		),
	}

	if opts.UseColorizedLogger {
		colorizedLogger := zerolog.NewConsoleWriter()
		{
			colorizedLogger.NoColor = false
			colorizedLogger.FormatLevel = func(i interface{}) string {
				return strings.ToUpper(fmt.Sprintf("| %-6s|", i))
			}
		}
		server.ColorizedLogger = zerolog.New(colorizedLogger).With().Timestamp().Logger()
	}

	return server, nil
}

// Serve starts the HTTP server and listens for incoming requests.
//
// It configures the server with the provided options (e.g., MaxHeaderBytes, TLS settings)
// and starts listening on the specified address. If EnableTls is true, it loads TLS certificates
// from TlsConfigDir and serves over HTTPS. The server runs in a background goroutine and
// listens for shutdown signals (SIGINT, SIGTERM). On receiving a signal, it performs a graceful
// shutdown with a 10-second timeout. Errors during startup or shutdown are logged using the
// configured logger (colorized if enabled).
func (s *Server) Serve() error {
	logger := s.ColorizedLogger
	if !s.Opts.UseColorizedLogger {
		logger = s.ExternalLogger
	}
	s.server = &http.Server{
		MaxHeaderBytes:               s.Opts.MaxHeaderBytes,
		Addr:                         string(s.Address),
		Handler:                      s.Mux,
		DisableGeneralOptionsHandler: s.Opts.DisableGeneralOptionsHandler,
		ErrorLog:                     s.errorLogger,
	}

	if s.Opts.EnableTls {
		certificates, err := collectTlsCertificates(s.TlsConfigDir)
		if err != nil {
			logger.Error().Msgf("error occurred loading tls certificate: %v", err)
			panic(fmt.Sprintf("TLS certificate loading failed: %v", err))
		}

		s.server.TLSConfig = &tls.Config{
			Certificates:       certificates,
			InsecureSkipVerify: false,
			ClientAuth:         tls.VerifyClientCertIfGiven,
			MinVersion:         tls.VersionTLS12,
			CipherSuites: []uint16{
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
				tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			},
			PreferServerCipherSuites: true,
			CurvePreferences: []tls.CurveID{
				tls.CurveP256,
				tls.X25519,
			},
		}
	}

	signal.Notify(s.shutdownChannel, syscall.SIGINT, syscall.SIGTERM)

	errChan := make(chan error, 1)

	go func(s *Server, logger zerolog.Logger) {
		logger.Info().Msgf("Starting server on %v", s.server.Addr)
		var err error
		if !s.Opts.EnableTls {
			err = s.server.ListenAndServe()
		} else {
			err = s.server.ListenAndServeTLS("", "")
		}

		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errChan <- fmt.Errorf("server start failed: %w", err)
		}
	}(s, logger)

	timeout := s.Opts.ShutdownTimeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	select {
	case err := <-errChan:
		return err
	case sig := <-s.shutdownChannel:
		logger.Info().Msgf("=> Caught %v", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		if err := s.server.Shutdown(ctx); err != nil {
			logger.Error().Msgf("Could not shutdown server properly: %v", err)
			return err
		}

		<-ctx.Done()
		logger.Info().Msg("Server terminated successfully")
	}
	return nil
}

// Shutdown initiates a graceful shutdown of the server by sending a SIGTERM signal.
//
// It triggers the server's shutdown process, which is handled by the Serve method.
func (s *Server) Shutdown() {
	s.shutdownOnce.Do(func() {
		s.shutdownChannel <- syscall.SIGTERM
	})
}

// collectTlsCertificates loads TLS certificate and key pairs from the specified directory.
//
// It walks the directory to find files with ".cert" and ".key" extensions, pairing them by name
// (e.g., "server.cert" with "server.key"). Each pair is loaded into a tls.Certificate.
//
// Parameters:
//   - directory: The directory containing TLS certificate (.cert) and key (.key) files.
//
// Returns:
//   - A slice of tls.Certificate objects for the loaded certificate-key pairs.
//   - An error if the directory cannot be read, a key is missing, or a certificate pair fails to load.
func collectTlsCertificates(directory string) ([]tls.Certificate, error) {
	certFiles := make(map[string]string)
	keyFiles := make(map[string]string)

	err := fs.WalkDir(
		os.DirFS(directory), ".",
		func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if !d.Type().IsRegular() {
				return nil
			}

			fullPath := filepath.Join(directory, path)
			switch {
			case strings.HasSuffix(d.Name(), ".cert"):
				certFiles[d.Name()] = fullPath
			case strings.HasSuffix(d.Name(), ".key"):
				keyFiles[d.Name()] = fullPath
			}
			return nil
		})

	if err != nil {
		return nil, fmt.Errorf("error walking directory: %w", err)
	}

	var missingKeys []string
	certificates := make([]tls.Certificate, 0, len(certFiles))

	for certName := range certFiles {
		keyName := strings.TrimSuffix(certName, ".cert") + ".key"
		if _, ok := keyFiles[keyName]; !ok {
			missingKeys = append(missingKeys, certName)
		}
	}

	if len(missingKeys) > 0 {
		return nil, fmt.Errorf("missing keys for certificates: %v", missingKeys)
	}

	for certName, certPath := range certFiles {
		keyName := strings.TrimSuffix(certName, ".cert") + ".key"
		keyPath := keyFiles[keyName]

		cert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load certificate pair %s: %w", certName, err)
		}

		certificates = append(certificates, cert)
	}

	return certificates, nil
}
