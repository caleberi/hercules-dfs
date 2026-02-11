package master_server

import (
	"net"
	"net/rpc"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/caleberi/distributed-system/common"
	"github.com/caleberi/distributed-system/rpc_struct"
)

type testChunkServer struct {
	mu            sync.Mutex
	heartbeatHits int
	createHits    int
	snapshotHits  int
}

func (tcs *testChunkServer) RPCHeartBeatHandler(
	args rpc_struct.ChunkServerHeartBeatArgs,
	reply *rpc_struct.ChunkServerHeartBeatReply,
) error {
	tcs.mu.Lock()
	tcs.heartbeatHits++
	tcs.mu.Unlock()
	return nil
}

func (tcs *testChunkServer) RPCCreateChunkHandler(
	args rpc_struct.CreateChunkArgs,
	reply *rpc_struct.CreateChunkReply,
) error {
	tcs.mu.Lock()
	tcs.createHits++
	tcs.mu.Unlock()
	reply.ErrorCode = common.Success
	return nil
}

func (tcs *testChunkServer) RPCGetSnapshotHandler(
	args rpc_struct.GetSnapshotArgs,
	reply *rpc_struct.GetSnapshotReply,
) error {
	tcs.mu.Lock()
	tcs.snapshotHits++
	tcs.mu.Unlock()
	reply.ErrorCode = common.Success
	return nil
}

func startTestChunkServer(t *testing.T, srv *testChunkServer) (net.Listener, *sync.WaitGroup) {
	t.Helper()

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}

	server := rpc.NewServer()
	if err := server.RegisterName("ChunkServer", srv); err != nil {
		l.Close()
		t.Fatalf("failed to register RPC server: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go server.ServeConn(conn)
		}
	}()

	return l, &wg
}

func TestServerHeartBeat_RequeuesOnReplicationFailure(t *testing.T) {
	listener, wg := startTestChunkServer(t, &testChunkServer{})
	defer func() {
		listener.Close()
		wg.Wait()
	}()

	addr := common.ServerAddr(listener.Addr().String())
	manager := NewChunkServerManager()
	manager.servers[addr] = &chunkServerInfo{
		lastHeartBeat: time.Now(),
		chunks:        make(map[common.ChunkHandle]bool),
		garbages:      make([]common.ChunkHandle, 0),
	}

	handle := common.ChunkHandle(12)
	manager.chunks[handle] = &chunkInfo{}
	manager.replicaMigration = []common.ChunkHandle{handle}

	master := &MasterServer{
		chunkServerManager: manager,
		detector:           nil,
	}

	if err := master.serverHeartBeat(); err != nil {
		t.Fatalf("serverHeartBeat returned error: %v", err)
	}

	manager.Lock()
	defer manager.Unlock()
	if len(manager.replicaMigration) != 1 || manager.replicaMigration[0] != handle {
		t.Fatalf("expected handle %v to be requeued, got %v", handle, manager.replicaMigration)
	}
}

func TestServerHeartBeat_ReplicatesChunkToTarget(t *testing.T) {
	fromSrv := &testChunkServer{}
	fromListener, fromWg := startTestChunkServer(t, fromSrv)
	defer func() {
		fromListener.Close()
		fromWg.Wait()
	}()

	toSrv := &testChunkServer{}
	toListener, toWg := startTestChunkServer(t, toSrv)
	defer func() {
		toListener.Close()
		toWg.Wait()
	}()

	fromAddr := common.ServerAddr(fromListener.Addr().String())
	toAddr := common.ServerAddr(toListener.Addr().String())

	manager := NewChunkServerManager()
	manager.servers[fromAddr] = &chunkServerInfo{
		lastHeartBeat: time.Now(),
		chunks:        make(map[common.ChunkHandle]bool),
		garbages:      make([]common.ChunkHandle, 0),
	}
	manager.servers[toAddr] = &chunkServerInfo{
		lastHeartBeat: time.Now(),
		chunks:        make(map[common.ChunkHandle]bool),
		garbages:      make([]common.ChunkHandle, 0),
	}

	handle := common.ChunkHandle(12)
	manager.chunks[handle] = &chunkInfo{locations: []common.ServerAddr{fromAddr}}
	manager.replicaMigration = []common.ChunkHandle{handle}

	master := &MasterServer{
		chunkServerManager: manager,
		detector:           nil,
	}

	if err := master.serverHeartBeat(); err != nil {
		t.Fatalf("serverHeartBeat returned error: %v", err)
	}

	manager.chunkMutex.RLock()
	locations := append([]common.ServerAddr(nil), manager.chunks[handle].locations...)
	manager.chunkMutex.RUnlock()

	if !containsAddr(locations, toAddr) {
		t.Fatalf("expected replica to include %v, got %v", toAddr, locations)
	}

	fromSrv.mu.Lock()
	fromSnapshotHits := fromSrv.snapshotHits
	fromSrv.mu.Unlock()

	toSrv.mu.Lock()
	toCreateHits := toSrv.createHits
	toSrv.mu.Unlock()

	if fromSnapshotHits == 0 {
		t.Fatalf("expected snapshot RPC to be called on source")
	}
	if toCreateHits == 0 {
		t.Fatalf("expected create chunk RPC to be called on target")
	}
}

func containsAddr(addrs []common.ServerAddr, target common.ServerAddr) bool {
	return slices.Contains(addrs, target)
}
