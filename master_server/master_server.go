package master_server

import (
	"context"
	"encoding/gob"
	"errors"
	"fmt"
	"io"
	"net"
	"net/rpc"
	"os"
	"os/signal"
	"path/filepath"
	"reflect"
	"sync"
	"syscall"
	"time"

	"github.com/caleberi/distributed-system/common"
	detector "github.com/caleberi/distributed-system/detector"
	filesystem "github.com/caleberi/distributed-system/file_system"
	namespacemanager "github.com/caleberi/distributed-system/namespace_manager"
	"github.com/caleberi/distributed-system/rpc_struct"
	"github.com/caleberi/distributed-system/shared"
	"github.com/caleberi/distributed-system/utils"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

type chunkServerInfo struct {
	sync.RWMutex
	lastHeatBeat time.Time
	chunks       map[common.ChunkHandle]bool
	garbages     []common.ChunkHandle
	serverInfo   common.MachineInfo
}

type chunkInfo struct {
	sync.RWMutex
	locations []common.ServerAddr
	primary   common.ServerAddr
	expire    time.Time // ??
	version   common.ChunkVersion
	checksum  common.Checksum
	path      common.Path
}

func (chkInfo *chunkInfo) isExpired(u time.Time) bool {
	return chkInfo.expire.Before(u)
}

type fileInfo struct {
	sync.RWMutex
	handles []common.ChunkHandle
}

type serialChunkInfo struct {
	Path common.Path
	Info []common.PersistedChunkInfo
}

type PesistentMeta struct {
	Namespace []namespacemanager.SerializedNsTreeNode
	ChunkInfo []serialChunkInfo
}

type MasterServerConfig struct {
	RootDir       string
	ServerAddress common.ServerAddr

	RedisAddr  string
	WindowSize int

	EntryExpiryTime time.Duration
	SuspicionLevel  detector.SuspicionLevel
}

type MasterServer struct {
	sync.RWMutex
	ServerAddr         common.ServerAddr
	rootDir            *filesystem.FileSystem
	listener           net.Listener
	namespaceManager   *namespacemanager.NamespaceManager
	chunkServerManager *ChunkServerManager
	detector           *detector.FailureDetector
	isDead             bool
	shutdownChan       chan os.Signal
}

func NewMasterServer(ctx context.Context, config MasterServerConfig) *MasterServer {
	failureDetector, err := detector.NewFailureDetector(
		string(config.ServerAddress),
		config.WindowSize,
		&redis.Options{Addr: config.RedisAddr},
		config.EntryExpiryTime,
		config.SuspicionLevel,
	)

	if err != nil {
		log.Err(err).Stack().Send()
		return nil
	}

	ma := &MasterServer{
		ServerAddr:         config.ServerAddress,
		rootDir:            filesystem.NewFileSystem(config.RootDir),
		namespaceManager:   namespacemanager.NewNameSpaceManager(ctx, 10*time.Hour),
		detector:           failureDetector,
		chunkServerManager: NewChunkServerManager(),
		shutdownChan:       make(chan os.Signal, 1),
	}

	// register rpc server
	server := rpc.NewServer()
	err = server.Register(ma)

	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return nil
	}
	l, err := net.Listen("tcp", string(ma.ServerAddr))
	if err != nil {
		log.Err(err).Stack().Msg(fmt.Sprintf("cannot start a listener on %s", ma.ServerAddr))
		return nil
	}

	ma.listener = l
	err = ma.rootDir.MkDir(".")
	if err != nil {
		log.Err(err).Stack().Send()
		log.Fatal().Msg(fmt.Sprintf("cannot create root directory (%s)\n", config.RootDir))
		return nil
	}
	// load metadata that will be replicated to another backup server <to avoid SOF>
	err = ma.loadMetadata()
	if err != nil {
		log.Err(err).Stack().Send()
		log.Fatal().Msg(fmt.Sprintf("cannot load metadata due to error (%s)\n", err))
		return nil
	}

	// create server listener
	go func(listener net.Listener) {
		defer func(listener net.Listener) {
			err := listener.Close()
			if err != nil {
				log.Err(err).Stack().Send()
			}
		}(listener)
		for {
			select {
			case <-ma.shutdownChan:
				err := failureDetector.Shutdown()
				if err != nil {
					log.Err(err).Stack().Msg(err.Error())
				}
				return
			default:
			}
			conn, err := listener.Accept()
			if err != nil {
				if ma.isDead {
					log.Err(err).Stack().Msgf("Server [%s] died\n", ma.ServerAddr)
				}
				continue
			}

			// server each connection concurrently
			go func() {
				server.ServeConn(conn)
				err := conn.Close()
				if err != nil {
					return
				}
			}()
		}
	}(ma.listener)

	signal.Notify(ma.shutdownChan, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	// background task
	// for doing heartbeat checks, server disconnection,
	// garbage collection, stale replica removal & detection
	go func() {
		persistMetadataCheck := time.NewTicker(common.MasterPersistMetaInterval)
		serverHealthCheck := time.NewTicker(common.ServerHealthCheckInterval)
		failurePredictionCheck := time.NewTicker(common.FailurePredictionInterval)

		defer persistMetadataCheck.Stop()
		defer serverHealthCheck.Stop()
		defer failurePredictionCheck.Stop()

		for {
			var branchInfo common.BranchInfo
			select {
			case <-ma.shutdownChan:
				return
			case <-serverHealthCheck.C:
				branchInfo.Event = string(common.MasterHeartBeat)
				branchInfo.Err = ma.serverHeartBeat()
			case <-persistMetadataCheck.C:
				branchInfo.Event = string(common.PersistMetaData)
				branchInfo.Err = ma.persistMetaData()
			case <-failurePredictionCheck.C:
				branchInfo.Event = string(common.FailurePrediction)
				prediction, err := ma.detector.PredictFailure()
				if err != nil {
					branchInfo.Err = err
				} else if !reflect.DeepEqual(prediction, detector.Prediction{}) {
					log.Warn().Msgf(">>> Failure Prediction: Server %s is suspected to fail with suspicion level %f",
						prediction.Message, prediction.Phi)
				}
			}

			if branchInfo.Err != nil {
				log.Err(branchInfo.Err).Stack().Msg(fmt.Sprintf("Error (%s) - from background event (%s)", branchInfo.Err, branchInfo.Event))
			}
		}
	}()

	log.Info().Msg(fmt.Sprintf("Master is running now. Address = [%s] ", string(ma.ServerAddr)))
	return ma
}

func (ma *MasterServer) serverHeartBeat() error {
	deadServers := ma.chunkServerManager.detectDeadServer()
	for _, addr := range deadServers {
		log.Info().Msgf(">> Removing Server %v from Master's servers list", addr)
		handles, err1 := ma.chunkServerManager.removeServer(addr)
		err2 := ma.chunkServerManager.removeChunks(handles, addr)
		if err := errors.Join(err1, err2); err != nil {
			return err
		}
	}

	//  deadserver have nothing to do with the replication logic
	handles := ma.chunkServerManager.replicationMigration()
	utils.ForEachInSlice(handles, func(handle common.ChunkHandle) {
		if ck, ok := ma.chunkServerManager.getChunk(handle); ok {
			if ck.expire.Before(time.Now()) {
				ck.Lock() // don't grant lease during copy
				log.Info().Msgf("Replication in progress >>> for handle [%v] chunk [%v]", handle, ck)
				err := ma.performReplication(handle)
				if err != nil {
					log.Err(err).Stack().Msg(err.Error())
					ck.Unlock()
					return
				}
				ck.Unlock()
			}
			return
		}

	})

	// perform a broadcast to all servers to get there health status for failure detection
	allServers := utils.TransformSlice(
		ma.chunkServerManager.GetLiveServers(),
		func(v common.ServerAddr) string { return string(v) },
	)
	if len(allServers) == 0 {
		return nil
	}

	var errs []error
	for _, addr := range allServers {
		args := rpc_struct.ChunkServerHeartBeatArgs{}
		args.NetworkData.ForwardTrip.SentAt = time.Now()

		reply := &rpc_struct.ChunkServerHeartBeatReply{}
		err := shared.UnicastToRPCServer(
			addr, rpc_struct.CRPCHeartBeatHandler, args,
			reply, shared.DefaultRetryConfig,
		)
		if err != nil {
			errs = append(errs, err)
			continue
		}

		reply.NetworkData.BackwardTrip.ReceivedAt = time.Now()
		if err := ma.detector.RecordSample(reply.NetworkData); err != nil {
			log.Err(err).Stack().Msg("err storing network data for prediction")
		}
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}

	return nil
}

func (ma *MasterServer) performReplication(handle common.ChunkHandle) error {
	from, to, err := ma.chunkServerManager.chooseReplicationServer(handle)
	log.Info().Msgf(">>> Moving handle[%v] from %s to %s", handle, from, to)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	log.Warn().Msg(fmt.Sprintf("allocate new chunk %v from %v to %v", handle, from, to))

	var cr rpc_struct.CreateChunkReply
	err = shared.UnicastToRPCServer(
		string(to), rpc_struct.CRPCCreateChunkHandler,
		rpc_struct.CreateChunkArgs{Handle: handle}, &cr,
		shared.DefaultRetryConfig,
	)
	if err != nil {
		return err
	}

	// CONTINUE FROM HERE  LATER
	var sr rpc_struct.GetSnapshotReply
	err = shared.UnicastToRPCServer(
		string(from), rpc_struct.CRPCGetSnapshotHandler,
		rpc_struct.GetSnapshotArgs{Handle: handle, Replicas: to}, &sr,
		shared.DefaultRetryConfig,
	)
	if err != nil {
		return err
	}

	err = ma.chunkServerManager.registerReplicas(handle, to, false)
	if err != nil {
		return err
	}
	ma.chunkServerManager.addChunk([]common.ServerAddr{to}, handle)
	return nil
}

func (ma *MasterServer) loadMetadata() error {
	file, err := ma.rootDir.GetFile(common.MasterMetaDataFileName, os.O_RDONLY, common.FileMode)
	if err != nil {
		var pathError *os.PathError
		if errors.As(err, &pathError) {
			err = ma.rootDir.CreateFile(common.MasterMetaDataFileName)
			if err != nil {
				return err
			}
		}
		file, err = ma.rootDir.GetFile(common.MasterMetaDataFileName, os.O_RDONLY, common.FileMode)
		if err != nil {
			return err
		}
	}

	defer func(file *os.File) {
		err := file.Close()
		if err != nil {
			log.Err(err).Stack().Send()
		}
	}(file)

	var meta PesistentMeta
	decoder := gob.NewDecoder(file)
	err = decoder.Decode(&meta)
	if err != nil {
		if !errors.Is(err, io.EOF) {
			log.Printf("error occurred while loading metadata (%v); attempting recovery", err)
			corruptName := fmt.Sprintf("%s.corrupt.%d", common.MasterMetaDataFileName, time.Now().Unix())
			if renameErr := ma.rootDir.Rename(common.MasterMetaDataFileName, corruptName); renameErr != nil {
				log.Err(renameErr).Stack().Msg("failed to rename corrupt master metadata")
				return err
			}
			if createErr := ma.rootDir.CreateFile(common.MasterMetaDataFileName); createErr != nil {
				return createErr
			}
			return nil
		}
	}

	if len(meta.Namespace) != 0 {
		ma.namespaceManager.Deserialize(meta.Namespace)
	}
	if len(meta.ChunkInfo) != 0 {
		ma.chunkServerManager.DeserializeChunks(meta.ChunkInfo)
	}
	return nil
}

func (ma *MasterServer) Shutdown() {
	ma.Lock()
	if ma.isDead {
		ma.Unlock()
		log.Printf("Server [%s] is dead\n", ma.ServerAddr)
		return
	}
	ma.Unlock()

	if err := ma.listener.Close(); err != nil {
		log.Err(err).Stack().Send()
	}

	if err := ma.persistMetaData(); err != nil {
		log.Err(err).Stack().Send()
	}

	close(ma.shutdownChan)
}

func (ma *MasterServer) persistMetaData() error {

	file, err := ma.rootDir.GetFile(common.MasterMetaDataFileName, os.O_RDWR, common.FileMode)
	if err != nil {
		var pathError *os.PathError
		if errors.As(err, &pathError) {
			err = ma.rootDir.CreateFile(common.MasterMetaDataFileName)
			if err != nil {
				return err
			}
		}
		file, err = ma.rootDir.GetFile(common.MasterMetaDataFileName, os.O_RDWR, common.FileMode)
		if err != nil {
			return err
		}
	}
	if _, err := file.Seek(0, 0); err != nil {
		return err
	}
	if err := file.Truncate(0); err != nil {
		return err
	}
	defer func(file *os.File) {
		err := file.Close()
		if err != nil {
			log.Err(err).Stack().Send()
		}
	}(file)

	var meta PesistentMeta
	meta.Namespace = ma.namespaceManager.Serialize()
	meta.ChunkInfo = ma.chunkServerManager.SerializeChunks()
	encoder := gob.NewEncoder(file)
	return encoder.Encode(&meta)
}

// ///////////////////////////////////
//
//	RPC METHODS
//
// /////////////////////////////////
func (ma *MasterServer) RPCHeartBeatHandler(args rpc_struct.HeartBeatArgs, reply *rpc_struct.HeartBeatReply) error {
	firstHeartBeat := ma.chunkServerManager.HeartBeat(args.Address, args.MachineInfo, reply)
	reply.NetworkData = args.NetworkData
	reply.NetworkData.ForwardTrip.ReceivedAt = time.Now()
	defer func() { reply.NetworkData.BackwardTrip.SentAt = time.Now() }()

	if args.ExtendLease {
		var newLeases []*common.Lease
		for _, lease := range reply.LeaseExtensions {
			chk, err := ma.chunkServerManager.extendLease(lease.Handle, lease.Primary)
			if err != nil {
				log.Err(err).Stack().Msg(err.Error())
				continue
			}

			newLeases = append(newLeases, &common.Lease{
				Expire:      chk.expire,
				Handle:      lease.Handle,
				InUse:       false,
				Primary:     lease.Primary,
				Secondaries: lease.Secondaries,
			})
		}

		reply.LeaseExtensions = newLeases
	}

	if !firstHeartBeat {
		utils.ForEachInSlice(
			reply.Garbage,
			func(handle common.ChunkHandle) {
				log.Info().Msgf(">> Forwarding Handle[%v] For Removal", handle)

			})
		return nil
	}

	systemReportArg := rpc_struct.SysReportInfoArgs{}
	systemReportReply := rpc_struct.SysReportInfoReply{}
	err := shared.UnicastToRPCServer(
		string(args.Address), rpc_struct.CRPCSysReportHandler,
		systemReportArg, &systemReportReply, shared.DefaultRetryConfig)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	if len(systemReportReply.Chunks) == 0 {
		return nil
	}

	utils.ForEachInSlice(systemReportReply.Chunks, func(chunkInfo common.PersistedChunkInfo) {
		chk, ok := ma.chunkServerManager.getChunk(chunkInfo.Handle)
		if !ok {
			log.Info().Msg(fmt.Sprintf("=> requesting chunkserver %v to  record as garbage", args.Address))
			reply.Garbage = append(reply.Garbage, chunkInfo.Handle)
			return
		}

		if chk.version != chunkInfo.Version {
			log.Info().Msg(fmt.Sprintf("* handle : %v version on master server is different ", chunkInfo.Handle))
			log.Info().Msg(fmt.Sprintf("* verifying possible stale chunk %v on chunkserver %v", chunkInfo.Handle, args.Address))

			var (
				chunkVersionArg   rpc_struct.CheckChunkVersionArgs
				chunkVersionReply rpc_struct.CheckChunkVersionReply
			)
			chunkVersionArg.Handle = chunkInfo.Handle
			chunkVersionArg.Version = chunkInfo.Version

			if chk.primary != "" {
				err := shared.UnicastToRPCServer(
					string(chk.primary),
					rpc_struct.CRPCCheckChunkVersionHandler,
					chunkVersionArg, &chunkVersionReply, shared.DefaultRetryConfig)
				if err != nil {
					log.Err(err).Stack().Msg(err.Error())
					return
				}
				if chunkVersionReply.Stale {
					log.Info().Msg(fmt.Sprintf("=> requesting chunkserver %v to record as garbage since chunk is stale", args.Address))
					reply.Garbage = append(reply.Garbage, chunkInfo.Handle)
					return
				}
				return
			}
			log.Info().Msg("Missing chunk primary server so version verification failed")
			if len(chk.locations) == 0 {
				reply.Garbage = append(reply.Garbage, chunkInfo.Handle)
				return
			}
		}

		if err := ma.chunkServerManager.registerReplicas(chunkInfo.Handle, args.Address, false); err != nil {
			log.Err(err).Stack().Msg(err.Error())
		}
		ma.chunkServerManager.addChunk([]common.ServerAddr{args.Address}, chunkInfo.Handle)

		// Synchronize namespace metadata with actual chunk data
		if chk.path != "" && chunkInfo.Length > 0 {
			file, err := ma.namespaceManager.Get(chk.path)
			if err != nil {
				if mkErr := ma.namespaceManager.MkDirAll(chk.path); mkErr != nil {
					log.Warn().Err(mkErr).Msgf("Cannot create directory for %s during heartbeat sync", chk.path)
					return
				}
				if createErr := ma.namespaceManager.Create(chk.path); createErr != nil {
					log.Warn().Err(createErr).Msgf("Cannot create file %s during heartbeat sync", chk.path)
					return
				}
				file, err = ma.namespaceManager.Get(chk.path)
				if err != nil {
					log.Warn().Err(err).Msgf("Cannot get file %s after recreate during heartbeat sync", chk.path)
					return
				}
			}

			file.Lock()
			currentLength := file.Length
			file.Unlock()

			// Calculate the expected file length based on this chunk's contribution
			// The chunk handle maps to an index, and we need to figure out the total file size
			handles, err := ma.chunkServerManager.GetChunkHandles(chk.path)
			if err != nil {
				log.Warn().Err(err).Msgf("Cannot get handles for %s during heartbeat sync", chk.path)
				return
			}

			// Find this chunk's index in the file
			var chunkIndex int64 = -1
			for i, h := range handles {
				if h == chunkInfo.Handle {
					chunkIndex = int64(i)
					break
				}
			}

			if chunkIndex >= 0 {
				// Calculate minimum file length based on this chunk
				// File length = (chunkIndex * CHUNK_SIZE) + chunk.Length
				minFileLength := (chunkIndex * common.ChunkMaxSizeInByte) + int64(chunkInfo.Length)

				// Only update if the calculated length is greater than current
				if minFileLength > currentLength {
					err := ma.namespaceManager.UpdateFileMetadata(chk.path, minFileLength, int64(len(handles)))
					if err != nil {
						log.Warn().Err(err).Msgf("Failed to sync file metadata for %s during heartbeat", chk.path)
					} else {
						log.Info().Msgf("Synced file metadata for %s: length=%d, chunks=%d (from heartbeat)",
							chk.path, minFileLength, len(handles))
					}
				}
			}
		}
	})

	return nil
}

func (ma *MasterServer) RPCGetPrimaryAndSecondaryServersInfoHandler(
	args rpc_struct.PrimaryAndSecondaryServersInfoArg,
	reply *rpc_struct.PrimaryAndSecondaryServersInfoReply) error {
	lease, staleServers, err := ma.chunkServerManager.getLeaseHolder(args.Handle)
	if err != nil {
		log.Debug().Msg("Tried get a lease here")
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	utils.ForEachInSlice(staleServers, func(v common.ServerAddr) {
		ma.chunkServerManager.addGarbage(v, args.Handle)
	})
	reply.Expire = lease.Expire
	reply.SecondaryServers = lease.Secondaries
	reply.Primary = lease.Primary
	return nil
}

func (ma *MasterServer) RPCGetChunkHandleHandler(
	args rpc_struct.GetChunkHandleArgs,
	reply *rpc_struct.GetChunkHandleReply) error {
	filename := filepath.Base(string(args.Path))
	err := utils.ValidateFilename(filename, args.Path)
	if err != nil {
		return err
	}
	err = ma.namespaceManager.MkDirAll(common.Path(args.Path))
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	// Try to create the path if it created before it err
	// We then try to get it instead
	err = ma.namespaceManager.Create(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	file, err := ma.namespaceManager.Get(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	file.Lock()
	defer file.Unlock()
	if args.Index == common.ChunkIndex(file.Chunks) {
		file.Chunks++
		// Note: since one of the servers on creating chunk should be the
		//  primary, the other 3 should be a replica.
		addrs, err := ma.chunkServerManager.chooseServers(common.MinimumReplicationFactor + 1) // sample out of the servers we have
		if err != nil {
			return err
		}
		addrs = utils.FilterSlice(addrs, func(addr common.ServerAddr) bool { return addr != common.ServerAddr("") })
		reply.Handle, addrs, err = ma.chunkServerManager.createChunk(args.Path, addrs)
		if err != nil {
			return err
		}
		ma.chunkServerManager.addChunk(addrs, reply.Handle)
	} else {
		reply.Handle, err = ma.chunkServerManager.getChunkHandle(args.Path, args.Index)
		if err != nil {
			return err
		}
	}
	return err
}

func (ma *MasterServer) RPCListHandler(
	args rpc_struct.GetPathInfoArgs,
	reply *rpc_struct.GetPathInfoReply) error {
	entries, err := ma.namespaceManager.List(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	reply.Entries = entries
	return nil
}

func (ma *MasterServer) RPCMkdirHandler(args rpc_struct.MakeDirectoryArgs,
	reply *rpc_struct.MakeDirectoryReply) error {
	err := ma.namespaceManager.MkDirAll(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	return nil
}

func (ma *MasterServer) RPCRenameHandler(args rpc_struct.RenameFileArgs,
	reply *rpc_struct.RenameFileReply) error {
	err := ma.namespaceManager.Rename(args.Source, args.Target)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	return ma.chunkServerManager.UpdateFilePath(args.Source, args.Target)
}

func (ma *MasterServer) RPCCreateFileHandler(args rpc_struct.CreateFileArgs,
	reply *rpc_struct.CreateFileReply) error {
	err := ma.namespaceManager.Create(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	return nil
}

func (ma *MasterServer) RPCDeleteFileHandler(
	args rpc_struct.DeleteFileArgs,
	reply *rpc_struct.DeleteFileReply) error {

	err := ma.namespaceManager.Delete(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	if args.DeleteHandle {
		handles, err := ma.chunkServerManager.GetChunkHandles(args.Path)
		if err != nil {
			log.Err(err).Stack().Msg(err.Error())
			return err
		}

		utils.ForEachInSlice(handles, func(handle common.ChunkHandle) {
			// Get all replicas for this chunk
			replicas, err := ma.chunkServerManager.getReplicas(handle)
			if err != nil {
				log.Warn().Err(err).Msgf("Failed to get replicas for chunk %v during delete", handle)
			} else {
				// Add to garbage list of each server holding this chunk
				utils.ForEachInSlice(replicas, func(addr common.ServerAddr) {
					ma.chunkServerManager.addGarbage(addr, handle)
					log.Info().Msgf("Added chunk %v to garbage list of server %v", handle, addr)
				})
			}

			// Remove from master's chunk metadata
			ma.chunkServerManager.deleteChunk(handle)
		})
	}
	return nil
}

func (ma *MasterServer) RPCRemoveDirHandler(
	args rpc_struct.RemoveDirArgs,
	reply *rpc_struct.RemoveDirReply) error {
	err := ma.namespaceManager.RemoveDir(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}
	return nil
}

func (ma *MasterServer) RPCGetFileInfoHandler(
	args rpc_struct.GetFileInfoArgs, reply *rpc_struct.GetFileInfoReply) error {
	file, err := ma.namespaceManager.Get(args.Path)
	if err != nil {
		log.Err(err).Stack().Msg(err.Error())
		return err
	}

	file.Lock()
	defer file.Unlock()
	reply.Chunks = file.Chunks
	reply.IsDir = file.IsDir
	reply.Length = file.Length
	return nil
}

func (ma *MasterServer) RPCGetReplicasHandler(
	args rpc_struct.RetrieveReplicasArgs,
	reply *rpc_struct.RetrieveReplicasReply) error {
	servers, err := ma.chunkServerManager.getReplicas(args.Handle)
	if err != nil {
		return err
	}
	utils.ForEachInSlice(servers, func(v common.ServerAddr) {
		reply.Locations = append(reply.Locations, v)
	})
	return nil
}

func (ma *MasterServer) RPCUpdateFileMetadataHandler(
	args rpc_struct.UpdateFileMetadataArgs, reply *rpc_struct.UpdateFileMetadataReply) error {
	err := ma.namespaceManager.UpdateFileMetadata(args.Path, args.Length, args.Chunks)
	if err != nil {
		log.Err(err).Stack().Msgf("failed to update file metadata for %s", args.Path)
		return err
	}
	log.Info().Msgf("Updated file metadata for %s: length=%d, chunks=%d", args.Path, args.Length, args.Chunks)
	return nil
}
