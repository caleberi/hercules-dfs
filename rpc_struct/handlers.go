package rpc_struct

// RPC handler names used with Go's net/rpc.
//
// These constants must exactly match the exported receiver method names on the
// relevant server types (e.g. MasterServer, ChunkServer). Centralizing them
// avoids string-typos at call-sites and makes handler renames explicit.
const (
	MRPCGetChunkHandleHandler                    = "MasterServer.RPCGetChunkHandleHandler"
	MRPCGetPrimaryAndSecondaryServersInfoHandler = "MasterServer.RPCGetPrimaryAndSecondaryServersInfoHandler"
	MRPCListHandler                              = "MasterServer.RPCListHandler"
	MRPCMkdirHandler                             = "MasterServer.RPCMkdirHandler"
	MRPCCreateFileHandler                        = "MasterServer.RPCCreateFileHandler"
	MRPCDeleteFileHandler                        = "MasterServer.RPCDeleteFileHandler"
	MRPCRemoveDirHandler                         = "MasterServer.RPCRemoveDirHandler"
	MRPCRenameHandler                            = "MasterServer.RPCRenameHandler"
	MRPCGetFileInfoHandler                       = "MasterServer.RPCGetFileInfoHandler"
	MRPCGetReplicasHandler                       = "MasterServer.RPCGetReplicasHandler"
	MRPCHeartBeatHandler                         = "MasterServer.RPCHeartBeatHandler"
	MRPCUpdateFileMetadataHandler                = "MasterServer.RPCUpdateFileMetadataHandler"

	CRPCReadChunkHandler         = "ChunkServer.RPCReadChunkHandler"
	CRPCForwardDataHandler       = "ChunkServer.RPCForwardDataHandler"
	CRPCWriteChunkHandler        = "ChunkServer.RPCWriteChunkHandler"
	CRPCAppendChunkHandler       = "ChunkServer.RPCAppendChunkHandler"
	CRPCSysReportHandler         = "ChunkServer.RPCSysReportHandler"
	CRPCCheckChunkVersionHandler = "ChunkServer.RPCCheckChunkVersionHandler"
	CRPCCreateChunkHandler       = "ChunkServer.RPCCreateChunkHandler"
	CRPCApplyMutationHandler     = "ChunkServer.RPCApplyMutationHandler"
	CRPCApplyCopyHandler         = "ChunkServer.RPCApplyCopyHandler"
	CRPCGetSnapshotHandler       = "ChunkServer.RPCGetSnapshotHandler"
	CRPCGrantLeaseHandler        = "ChunkServer.RPCGrantLeaseHandler"
	CRPCHeartBeatHandler         = "ChunkServer.RPCHeartBeatHandler"
)
