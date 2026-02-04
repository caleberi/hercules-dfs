package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type User struct {
	Id   int
	Name string
}

var testData = []User{
	{Id: 23, Name: "test2"},
	{Id: 12, Name: "test34"},
}

func setupTestServer(t *testing.T, port int) *Server {
	router := gin.Default()

	router.GET("/user", func(c *gin.Context) {
		c.JSON(http.StatusOK, testData)
	})
	server, err := NewServer(
		"Sami",
		port,
		os.Stdout,
		"",
		ServerOpts{
			EnableTls:         false,
			MaxHeaderBytes:    4 * (1 << 20),
			IdleTimeout:       30 * time.Second,
			ReadHeaderTimeout: 1 * time.Second,
			WriteTimeout:      1 * time.Second,
		})

	assert.NoError(t, err)
	server.Mux = router
	return server
}

func TestServerWithMux(t *testing.T) {
	server := setupTestServer(t, 8082)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go server.Serve()
	go func() {
		<-ctx.Done()
		server.Shutdown()
	}()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:8082/user")
	assert.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var receivedData = []User{}
	err = json.NewDecoder(resp.Body).Decode(&receivedData)
	assert.NoError(t, err)
	assert.Equal(t, testData, receivedData)
}

func TestServerStartFailure_PortInUse(t *testing.T) {
	server1 := setupTestServer(t, 8083)
	go server1.Serve()
	defer server1.Shutdown()

	time.Sleep(100 * time.Millisecond)

	server2 := setupTestServer(t, 8083)
	err := make(chan error, 1)

	go func() {
		err <- server2.Serve()
	}()

	select {
	case err := <-err:
		assert.Error(t, err)
	case <-time.After(2 * time.Second):
	}
}
