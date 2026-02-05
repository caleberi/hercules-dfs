package shared

import (
	"errors"
	"fmt"
	"net"
	"net/rpc"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type MockService struct {
	mu           sync.Mutex
	callCount    int32
	failUntil    int32
	shouldFail   bool
	responseData string
}

type EchoArgs struct {
	Message string
}

type EchoReply struct {
	Message string
	Counter int
}

func (m *MockService) Echo(args *EchoArgs, reply *EchoReply) error {
	count := atomic.AddInt32(&m.callCount, 1)

	m.mu.Lock()
	shouldFail := m.shouldFail
	failUntil := m.failUntil
	m.mu.Unlock()

	if failUntil > 0 && count <= failUntil {
		return fmt.Errorf("transient error on attempt %d", count)
	}

	if shouldFail {
		return errors.New("permanent error")
	}

	reply.Message = args.Message
	reply.Counter = int(count)
	return nil
}

func (m *MockService) SlowEcho(args *EchoArgs, reply *EchoReply) error {
	time.Sleep(2 * time.Second)
	return m.Echo(args, reply)
}

func (m *MockService) GetCallCount() int {
	return int(atomic.LoadInt32(&m.callCount))
}

func (m *MockService) Reset() {
	atomic.StoreInt32(&m.callCount, 0)
}

func startMockServer(t *testing.T) (string, *MockService, func()) {
	service := &MockService{}
	server := rpc.NewServer()
	err := server.Register(service)
	if err != nil {
		t.Fatalf("Failed to register service: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start listener: %v", err)
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go server.ServeConn(conn)
		}
	}()

	addr := listener.Addr().String()
	cleanup := func() {
		listener.Close()
	}

	return addr, service, cleanup
}

func TestUnicastSuccess(t *testing.T) {
	addr, service, cleanup := startMockServer(t)
	defer cleanup()

	args := EchoArgs{Message: "Hello"}
	var reply EchoReply

	err := UnicastToRPCServer(addr, "MockService.Echo", &args, &reply, DefaultRetryConfig)

	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	if reply.Message != "Hello" {
		t.Errorf("Expected message 'Hello', got '%s'", reply.Message)
	}

	if service.GetCallCount() != 1 {
		t.Errorf("Expected 1 call, got %d", service.GetCallCount())
	}
}

func TestUnicastRetrySuccess(t *testing.T) {
	addr, service, cleanup := startMockServer(t)
	defer cleanup()

	service.mu.Lock()
	service.failUntil = 1
	service.mu.Unlock()

	args := EchoArgs{Message: "Retry test"}
	var reply EchoReply

	err := UnicastToRPCServer(addr, "MockService.Echo", &args, &reply, DefaultRetryConfig)

	if err != nil {
		t.Errorf("Expected success after retry, got error: %v", err)
	}

	if reply.Message != "Retry test" {
		t.Errorf("Expected message 'Retry test', got '%s'", reply.Message)
	}

	if service.GetCallCount() != 2 {
		t.Errorf("Expected 2 calls (1 retry), got %d", service.GetCallCount())
	}
}

func TestUnicastMaxRetriesExhausted(t *testing.T) {
	addr, service, cleanup := startMockServer(t)
	defer cleanup()

	service.mu.Lock()
	service.shouldFail = true
	service.mu.Unlock()

	args := EchoArgs{Message: "Fail test"}
	var reply EchoReply

	err := UnicastToRPCServer(addr, "MockService.Echo", &args, &reply, DefaultRetryConfig)

	if err == nil {
		t.Error("Expected error after max retries, got success")
	}

	if service.GetCallCount() != 3 {
		t.Errorf("Expected 3 attempts, got %d", service.GetCallCount())
	}
}

func TestUnicastConnectionFailure(t *testing.T) {
	args := EchoArgs{Message: "Test"}
	var reply EchoReply

	err := UnicastToRPCServer("127.0.0.1:1", "MockService.Echo", &args, &reply, DefaultRetryConfig)

	if err == nil {
		t.Error("Expected connection error, got success")
	}
}

func TestUnicastMethodNotFound(t *testing.T) {
	addr, _, cleanup := startMockServer(t)
	defer cleanup()

	args := EchoArgs{Message: "Test"}
	var reply EchoReply

	err := UnicastToRPCServer(addr, "MockService.NonExistentMethod", &args, &reply, DefaultRetryConfig)

	if err == nil {
		t.Error("Expected method not found error, got success")
	}
}

func TestBroadcastAllSucceed(t *testing.T) {

	addr1, service1, cleanup1 := startMockServer(t)
	defer cleanup1()
	addr2, service2, cleanup2 := startMockServer(t)
	defer cleanup2()
	addr3, service3, cleanup3 := startMockServer(t)
	defer cleanup3()

	addrs := []string{addr1, addr2, addr3}
	args := EchoArgs{Message: "Broadcast test"}

	replies := make([]any, len(addrs))
	for i := range replies {
		replies[i] = &EchoReply{}
	}

	errs := BroadcastToRPCServers(addrs, "MockService.Echo", &args, replies, DefaultRetryConfig)
	if len(errs) != 0 {
		t.Errorf("Expected no errors, got %d: %v", len(errs), errs)
	}

	services := []*MockService{service1, service2, service3}
	for i, svc := range services {
		if svc.GetCallCount() != 1 {
			t.Errorf("Server %d: expected 1 call, got %d", i, svc.GetCallCount())
		}
	}

	for i, replyInterface := range replies {
		reply := replyInterface.(*EchoReply)
		if reply.Message != "Broadcast test" {
			t.Errorf("Server %d: expected message 'Broadcast test', got '%s'", i, reply.Message)
		}
	}
}

func TestBroadcastPartialFailure(t *testing.T) {

	addr1, service1, cleanup1 := startMockServer(t)
	defer cleanup1()
	addr2, service2, cleanup2 := startMockServer(t)
	defer cleanup2()
	addr3, service3, cleanup3 := startMockServer(t)
	defer cleanup3()

	service2.mu.Lock()
	service2.shouldFail = true
	service2.mu.Unlock()

	addrs := []string{addr1, addr2, addr3}
	args := EchoArgs{Message: "Partial failure test"}

	replies := make([]any, len(addrs))
	for i := range replies {
		replies[i] = &EchoReply{}
	}

	errs := BroadcastToRPCServers(addrs, "MockService.Echo", &args, replies, DefaultRetryConfig)
	if len(errs) != 1 {
		t.Errorf("Expected 1 error, got %d: %v", len(errs), errs)
	}

	if service1.GetCallCount() != 1 {
		t.Errorf("Server 1: expected 1 call, got %d", service1.GetCallCount())
	}
	if service3.GetCallCount() != 1 {
		t.Errorf("Server 3: expected 1 call, got %d", service3.GetCallCount())
	}

	if service2.GetCallCount() != 3 {
		t.Errorf("Server 2: expected 3 attempts, got %d", service2.GetCallCount())
	}

	reply1 := replies[0].(*EchoReply)
	if reply1.Message != "Partial failure test" {
		t.Errorf("Server 1 reply incorrect: %s", reply1.Message)
	}

	reply3 := replies[2].(*EchoReply)
	if reply3.Message != "Partial failure test" {
		t.Errorf("Server 3 reply incorrect: %s", reply3.Message)
	}
}

func TestBroadcastAllFail(t *testing.T) {
	addr1, service1, cleanup1 := startMockServer(t)
	defer cleanup1()
	addr2, service2, cleanup2 := startMockServer(t)
	defer cleanup2()

	service1.mu.Lock()
	service1.shouldFail = true
	service1.mu.Unlock()

	service2.mu.Lock()
	service2.shouldFail = true
	service2.mu.Unlock()

	addrs := []string{addr1, addr2}
	args := EchoArgs{Message: "All fail test"}

	replies := make([]any, len(addrs))
	for i := range replies {
		replies[i] = &EchoReply{}
	}

	errs := BroadcastToRPCServers(addrs, "MockService.Echo", &args, replies, DefaultRetryConfig)

	if len(errs) != 2 {
		t.Errorf("Expected 2 errors, got %d: %v", len(errs), errs)
	}

	if service1.GetCallCount() != 3 {
		t.Errorf("Server 1: expected 3 attempts, got %d", service1.GetCallCount())
	}
	if service2.GetCallCount() != 3 {
		t.Errorf("Server 2: expected 3 attempts, got %d", service2.GetCallCount())
	}
}

func TestBroadcastEmptyServerList(t *testing.T) {
	addrs := []string{}
	args := EchoArgs{Message: "Empty test"}
	replies := make([]any, 0)

	errs := BroadcastToRPCServers(addrs, "MockService.Echo", &args, replies, DefaultRetryConfig)

	if len(errs) != 0 {
		t.Errorf("Expected no errors for empty list, got %d", len(errs))
	}
}

func TestBroadcastSingleServer(t *testing.T) {
	addr, service, cleanup := startMockServer(t)
	defer cleanup()

	addrs := []string{addr}
	args := EchoArgs{Message: "Single server"}

	replies := make([]any, 1)
	replies[0] = &EchoReply{}

	errs := BroadcastToRPCServers(addrs, "MockService.Echo", &args, replies, DefaultRetryConfig)

	if len(errs) != 0 {
		t.Errorf("Expected no errors, got %d: %v", len(errs), errs)
	}

	if service.GetCallCount() != 1 {
		t.Errorf("Expected 1 call, got %d", service.GetCallCount())
	}

	reply := replies[0].(*EchoReply)
	if reply.Message != "Single server" {
		t.Errorf("Expected 'Single server', got '%s'", reply.Message)
	}
}

func BenchmarkUnicast(b *testing.B) {
	addr, _, cleanup := startMockServer(&testing.T{})
	defer cleanup()

	args := EchoArgs{Message: "Benchmark"}
	var reply EchoReply

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		UnicastToRPCServer(addr, "MockService.Echo", &args, &reply, DefaultRetryConfig)
	}
}

func TestRetryTiming(t *testing.T) {
	addr, service, cleanup := startMockServer(t)
	defer cleanup()

	service.mu.Lock()
	service.failUntil = 2
	service.mu.Unlock()

	args := EchoArgs{Message: "Timing test"}
	var reply EchoReply

	start := time.Now()
	err := UnicastToRPCServer(addr, "MockService.Echo", &args, &reply, DefaultRetryConfig)
	elapsed := time.Since(start)

	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}

	expectedMinDuration := 1 * time.Second
	if elapsed < expectedMinDuration {
		t.Errorf("Expected at least %v, took %v", expectedMinDuration, elapsed)
	}

	expectedMaxDuration := 4 * time.Second
	if elapsed > expectedMaxDuration {
		t.Errorf("Expected at most %v, took %v", expectedMaxDuration, elapsed)
	}
}
