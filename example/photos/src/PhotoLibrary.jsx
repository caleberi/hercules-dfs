import React, { useState, useEffect, useRef } from 'react';
import { Upload, Image, Folder, Trash2, Grid, List, Search, X, ChevronRight, Home, RefreshCw, Server, Download, AlertCircle, Video, Play, Pause, Volume2, VolumeX, Maximize, File } from 'lucide-react';

const API_BASE = 'http://localhost:8089/api/v1';
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB per chunk (matching common.ChunkMaxSizeInByte)
const APPEND_MAX = 16 * 1024 * 1024; // 16MB max for append
const MAX_TEXT_PREVIEW_BYTES = 200 * 1024;
const LEASE_EXPIRED_CODE = 8;

// Utility functions for file type detection
const isVideoFile = (filename) => {
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];
  return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
};

const isImageFile = (filename) => {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
  return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
};

const isPdfFile = (filename) => filename.toLowerCase().endsWith('.pdf');

const isTextFile = (filename) => {
  const textExtensions = ['.txt', '.md', '.log', '.csv', '.json', '.xml', '.yaml', '.yml'];
  return textExtensions.some(ext => filename.toLowerCase().endsWith(ext));
};

const isCodeFile = (filename) => {
  const codeExtensions = [
    '.go', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.rb', '.php',
    '.rs', '.cpp', '.cc', '.c', '.h', '.hpp', '.cs', '.swift', '.kt',
    '.m', '.mm', '.scala', '.sh', '.bash', '.zsh', '.ps1', '.sql',
    '.html', '.css', '.scss', '.sass', '.less', '.toml', '.ini', '.env',
    '.dockerfile', '.makefile', '.gradle', '.proto'
  ];
  const lower = filename.toLowerCase();
  if (lower.endsWith('makefile') || lower.endsWith('dockerfile')) {
    return true;
  }
  return codeExtensions.some(ext => lower.endsWith(ext));
};

// Video Player Component
const VideoPlayer = ({ src, srcKind, onClose, serverInfo }) => {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    video.pause();
    if (srcKind !== 'mse') {
      video.load();
    }
  }, [src, srcKind]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleEnded = () => setPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    if (playing) {
      videoRef.current?.pause();
    } else {
      videoRef.current?.play();
    }
    setPlaying(!playing);
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * duration;
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !muted;
      setMuted(!muted);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <div className="relative bg-black rounded-lg overflow-hidden group">
        <video
          ref={videoRef}
          src={src}
          className="w-full max-h-[60vh] object-contain"
          onClick={togglePlay}
        />
        
        {/* Video Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Progress Bar */}
          <div 
            className="w-full h-1 bg-gray-600 rounded-full mb-3 cursor-pointer"
            onClick={handleSeek}
          >
            <div 
              className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={togglePlay}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
              >
                {playing ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white" />}
              </button>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleMute}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                >
                  {muted ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    if (videoRef.current) videoRef.current.volume = val;
                  }}
                  className="w-20 h-1"
                />
              </div>

              <span className="text-white text-sm font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <button
              onClick={toggleFullscreen}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Maximize className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Server Info */}
      {serverInfo && (
        <div className="space-y-3">
          <div className="p-4 bg-slate-800/50 rounded-lg border border-white/10">
            <div className="flex items-center space-x-2 mb-3">
              <Server className="w-5 h-5 text-teal-300" />
              <span className="text-sm font-semibold text-amber-200">Streaming Information</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-green-500/10 rounded border border-green-500/20">
                  <span className="text-gray-400">Streaming Server:</span>
                  <span className="font-mono text-green-300">{serverInfo.selectedForRead}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                  <span className="text-gray-400">Primary:</span>
                  <span className="font-mono text-gray-300">{serverInfo.primary}</span>
                </div>
                {serverInfo.secondaries && serverInfo.secondaries.length > 0 && (
                  <div className="p-2 bg-slate-900/60 rounded">
                    <span className="text-gray-400 block mb-1">Replicas ({serverInfo.secondaries.length}):</span>
                    {serverInfo.secondaries.map((sec, idx) => (
                      <div key={idx} className="font-mono text-gray-300 text-xs ml-2">• {sec}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                  <span className="text-gray-400">Chunk Handle:</span>
                  <span className="font-mono text-gray-300">{serverInfo.handle}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                  <span className="text-gray-400">Total Chunks:</span>
                  <span className="font-mono text-gray-300">{serverInfo.totalChunks}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                  <span className="text-gray-400">File Size:</span>
                  <span className="font-mono text-gray-300">{(serverInfo.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                  <span className="text-gray-400">Replication:</span>
                  <span className="font-mono text-amber-200">{1 + (serverInfo.secondaries?.length || 0)}x</span>
                </div>
              </div>
            </div>
          </div>

          {serverInfo.allChunkLocations && serverInfo.allChunkLocations.length > 1 && (
            <div className="p-3 bg-slate-800/30 rounded-lg border border-white/5">
              <div className="text-xs text-gray-400 mb-2">Chunk Distribution:</div>
              <div className="flex flex-wrap gap-2">
                {serverInfo.allChunkLocations.map((loc, idx) => (
                  <div key={idx} className="px-2 py-1 bg-teal-400/10 rounded border border-teal-400/20 text-xs">
                    <span className="text-gray-400">#{idx}</span>
                    <span className="text-teal-200 ml-1">×{loc.replicas}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function PhotoLibrary() {
  const [photos, setPhotos] = useState([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [notification, setNotification] = useState(null);
  const [photoCache, setPhotoCache] = useState({});
  const [leaseCache, setLeaseCache] = useState({});
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [mediaSrc, setMediaSrc] = useState(null);
  const [mediaSrcKind, setMediaSrcKind] = useState('blob');
  const [currentMediaPath, setCurrentMediaPath] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [streamProgress, setStreamProgress] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [docPreviewType, setDocPreviewType] = useState('none');
  const [docPreviewText, setDocPreviewText] = useState('');

  const isInitialMount = useRef(true);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  /**
   * STEP 1: Get chunk handle for a file path and chunk index
   * This retrieves the unique identifier for where data is stored
   */
  const getChunkHandle = async (path, chunkIndex = 0) => {
    try {
      const url = `${API_BASE}/chunk/handle?path=${encodeURIComponent(path)}&index=${chunkIndex}`;
      console.log(`[GET HANDLE] Request: ${url}`);
      
      const response = await fetch(url);
      const result = await response.json();
      
      console.log(`[GET HANDLE] Response:`, result);
      
      if (!result.success || !result.data || typeof result.data.handle === 'undefined') {
        throw new Error(result.error || 'Failed to get chunk handle');
      }
      
      console.log(`✓ Got chunk handle for ${path}[${chunkIndex}]: ${result.data.handle}`);
      return result.data.handle;
    } catch (err) {
      console.error('[GET HANDLE] Error:', err);
      throw err;
    }
  };

  /**
   * STEP 2: Obtain lease for the chunk handle
   * This retrieves server locations and lease information:
   * - Primary server (for coordinating writes)
   * - Secondary servers (replicas for reads and redundancy)
   * - Lease expiry time (for cache validity)
   */
  const obtainLease = async (path, chunkIndex = 0) => {
    const cacheKey = `${path}:${chunkIndex}`;
    
    // Check cache for valid lease
    if (leaseCache[cacheKey]) {
      const cached = leaseCache[cacheKey];
      if (cached.expire && new Date(cached.expire) > new Date()) {
        console.log(`✓ Using cached lease for ${path}[${chunkIndex}]`);
        return cached;
      }
    }

    try {
      // Get chunk handle first
      const handle = await getChunkHandle(path, chunkIndex);
      
      // Get server locations (lease) for this chunk handle
      const url = `${API_BASE}/chunk/servers?handle=${encodeURIComponent(handle)}`;
      console.log(`[GET LEASE] Request: ${url}`);
      
      const response = await fetch(url);
      const result = await response.json();
      
      console.log(`[GET LEASE] Response:`, result);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to obtain lease');
      }
      
      const lease = {
        handle: result.data.handle,
        primary: result.data.primary,
        secondaries: result.data.secondaries || [],
        expire: result.data.expire
      };
      
      // Cache the lease for future use
      setLeaseCache(prev => ({ ...prev, [cacheKey]: lease }));
      
      console.log(`✓ Obtained lease for ${path}[${chunkIndex}]:`, lease);
      return lease;
    } catch (err) {
      console.error(`[GET LEASE] Error for ${path}[${chunkIndex}]:`, err);
      throw err;
    }
  };

  /**
   * STEP 3a: Select server for READ operations
   * Can use any replica (primary or secondaries) for load balancing
   * Randomly selects from all available servers
   */
  const selectServerForRead = (lease) => {
    if (!lease) return null;
    
    // Combine all available servers (primary + secondaries)
    const allServers = [lease.primary, ...(lease.secondaries || [])].filter(Boolean);
    
    if (allServers.length === 0) {
      console.warn('No servers available in lease');
      return null;
    }
    
    // Random selection for load balancing
    const selectedServer = allServers[Math.floor(Math.random() * allServers.length)];
    console.log(`Selected server for read: ${selectedServer} (from ${allServers.length} replicas)`);
    
    return selectedServer;
  };

  /**
   * STEP 3b: Select server for WRITE operations
   * MUST use primary server for consistency
   * Primary coordinates write to all replicas
   */
  const selectServerForWrite = (lease) => {
    if (!lease || !lease.primary) {
      console.warn('No primary server available in lease');
      return null;
    }
    
    console.log(`Selected primary for write: ${lease.primary}`);
    return lease.primary;
  };

  /**
   * Get file metadata (size, chunk count, directory status)
   */
  const getFileInfo = async (path) => {
    const url = `${API_BASE}/fileinfo?path=${encodeURIComponent(path)}`;
    console.log(`[GET FILE INFO] Request: ${url}`);
    
    const response = await fetch(url);
    const result = await response.json();
    
    console.log(`[GET FILE INFO] Response:`, result);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to get file info');
    }
    
    return {
      isDir: result.data.is_dir,
      length: result.data.length,
      chunks: result.data.chunks
    };
  };

  /**
   * Load directory contents (photos and subdirectories)
   */
  const loadPhotos = async () => {
    // Use cache if available
    if (photoCache[currentPath]) {
      setPhotos(photoCache[currentPath]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const url = `${API_BASE}/list?path=${encodeURIComponent(currentPath)}`;
      console.log(`[LIST] Request: ${url}`);
      
      const response = await fetch(url);
      const result = await response.json();
      
      console.log(`[LIST] Response:`, result);

      if (result.success && result.data.entries) {
        const photoEntries = result.data.entries.map(entry => ({
          name: entry.Name || entry,
          isDir: entry.IsDir || false,
          path: `${currentPath}/${entry.Name || entry}`.replace(/\/+/g, '/')
        }));
        
        setPhotos(photoEntries);
        setPhotoCache(prev => ({ ...prev, [currentPath]: photoEntries }));
        console.log(`✓ Loaded ${photoEntries.length} items from ${currentPath}`);
      } else {
        setPhotos([]);
      }
    } catch (err) {
      console.error('[LIST] Error:', err);
      showNotification('Failed to load photos', 'error');
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      initializeLibrary();
      return;
    }
    loadPhotos();
  }, [currentPath]);

  const initializeLibrary = async () => {
    try {
      console.log('[INIT] Creating photos directory...');
      const response = await fetch(`${API_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/photos' })
      });
      const result = await response.json();
      console.log('[INIT] Response:', result);
      console.log('✓ Initialized photos directory');
    } catch (err) {
      console.log('[INIT] Photos directory may already exist');
    }
    loadPhotos();
  };

  /**
   * UPLOAD WORKFLOW (IMPROVED):
   * 1. Create file in namespace (master server)
  * 2. Write full chunks (up to 64MB) with explicit offsets
  * 3. Append only the final tail (<= 16MB) to avoid chunk fragmentation
  * 4. File length is tracked automatically by the system
   */
  const handleUpload = async (files) => {
    setUploadProgress({ current: 0, total: files.length, currentFile: '', bytesUploaded: 0, totalBytes: 0 });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = `${currentPath}/${file.name}`.replace(/\/+/g, '/');
      
      setUploadProgress(prev => ({ ...prev, currentFile: file.name, totalBytes: file.size }));
      
      try {
        console.log(`\n=== UPLOADING ${file.name} (${file.size} bytes) ===`);
        
        // Step 1: Create file in namespace
        console.log('[UPLOAD] Step 1: Creating file in namespace...');
        const createResponse = await fetch(`${API_BASE}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fileName })
        });

        const createResult = await createResponse.json();
        console.log('[UPLOAD] Create response:', createResult);

        if (!createResponse.ok) {
          throw new Error('Failed to create file in namespace');
        }
        console.log(`✓ Created file in namespace: ${fileName}`);

        console.log(`[UPLOAD] Streaming with constraints:`);
        console.log(`  - CHUNK_SIZE: ${CHUNK_SIZE} bytes`);
        console.log(`  - APPEND_MAX: ${APPEND_MAX} bytes`);

        let filePosition = 0;
        const fullChunks = Math.floor(file.size / CHUNK_SIZE);

        for (let chunkIndex = 0; chunkIndex < fullChunks; chunkIndex++) {
          const offset = chunkIndex * CHUNK_SIZE;
          const blobSlice = file.slice(offset, offset + CHUNK_SIZE);
          const chunkData = new Uint8Array(await blobSlice.arrayBuffer());

          let leaseRetry = 0;
          while (true) {
            const writeUrl = `${API_BASE}/write?path=${encodeURIComponent(fileName)}&offset=${offset}`;
            console.log(`[UPLOAD] POST ${writeUrl} (${chunkData.length} bytes)`);

            const writeResponse = await fetch(writeUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: chunkData
            });

            const writeResult = await writeResponse.json();
            if (!writeResponse.ok) {
              const errorCode = Number(writeResult.Code ?? writeResult.code ?? 0);
              if (errorCode === LEASE_EXPIRED_CODE && leaseRetry < 1) {
                leaseRetry += 1;
                showNotification('Lease refreshed, retrying...', 'info');
                continue;
              }
              throw new Error(`Failed to write: ${writeResult.Error || writeResult.error}`);
            }

            const reportedWritten = writeResult.data?.bytes_written;
            const bytesWritten = Math.min(chunkData.length, reportedWritten || chunkData.length);
            if (bytesWritten <= 0) {
              throw new Error('Write returned 0 bytes written');
            }
            filePosition = offset + bytesWritten;
            break;
          }

          setUploadProgress({
            current: i,
            total: files.length,
            currentFile: file.name,
            bytesUploaded: filePosition,
            totalBytes: file.size
          });
        }

        const remaining = file.size - filePosition;
        if (remaining > 0) {
          const blobSlice = file.slice(filePosition, filePosition + remaining);
          const chunkData = new Uint8Array(await blobSlice.arrayBuffer());

          if (remaining <= APPEND_MAX) {
            const appendUrl = `${API_BASE}/append?path=${encodeURIComponent(fileName)}`;
            console.log(`[UPLOAD] PATCH ${appendUrl} (${chunkData.length} bytes)`);

            const appendResponse = await fetch(appendUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: chunkData
            });

            const appendResult = await appendResponse.json();
            if (!appendResponse.ok) {
              throw new Error(`Failed to append: ${appendResult.error}`);
            }

            const bytesWritten = appendResult.data.bytes_added || chunkData.length;
            if (bytesWritten <= 0) {
              throw new Error('Append returned 0 bytes written');
            }
            filePosition += bytesWritten;
          } else {
            let leaseRetry = 0;
            while (true) {
              const writeUrl = `${API_BASE}/write?path=${encodeURIComponent(fileName)}&offset=${filePosition}`;
              console.log(`[UPLOAD] POST ${writeUrl} (${chunkData.length} bytes)`);

              const writeResponse = await fetch(writeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunkData
              });

              const writeResult = await writeResponse.json();
              if (!writeResponse.ok) {
                const errorCode = Number(writeResult.Code ?? writeResult.code ?? 0);
                if (errorCode === LEASE_EXPIRED_CODE && leaseRetry < 1) {
                  leaseRetry += 1;
                  showNotification('Lease refreshed, retrying...', 'info');
                  continue;
                }
                throw new Error(`Failed to write: ${writeResult.Error || writeResult.error}`);
              }

              const reportedWritten = writeResult.data?.bytes_written;
              const bytesWritten = Math.min(chunkData.length, reportedWritten || chunkData.length);
              if (bytesWritten <= 0) {
                throw new Error('Write returned 0 bytes written');
              }
              filePosition += bytesWritten;
              break;
            }
          }
        }

        setUploadProgress({
          current: i,
          total: files.length,
          currentFile: file.name,
          bytesUploaded: filePosition,
          totalBytes: file.size
        });

        console.log(`✓✓✓ Successfully uploaded ${file.name}: ${filePosition} bytes`);
        
        setUploadProgress({ 
          current: i + 1, 
          total: files.length, 
          currentFile: file.name,
          bytesUploaded: filePosition,
          totalBytes: file.size
        });
        
      } catch (err) {
        console.error(`[UPLOAD] Error for ${file.name}:`, err);
        showNotification(`Failed to upload ${file.name}: ${err.message}`, 'error');
      }
    }

    // Clear cache and reload
    setPhotoCache(prev => {
      const newCache = { ...prev };
      delete newCache[currentPath];
      return newCache;
    });

    setTimeout(() => {
      setUploadProgress(null);
      setShowUploadModal(false);
      loadPhotos();
      showNotification(`Upload complete!`);
    }, 800);
  };

  /**
   * READ AND STREAM WORKFLOW:
   * Handles both images and videos with chunked streaming
   */
  const readMedia = async (mediaPath) => {
    try {
      setServerInfo(null);
      setStreamProgress({ loaded: 0, total: 0, currentChunk: 0, totalChunks: 0 });
      
      // Determine media type
      const isVid = isVideoFile(mediaPath);
      const isImg = isImageFile(mediaPath);
      const isPdf = isPdfFile(mediaPath);
      const isText = isTextFile(mediaPath);
      const isCode = isCodeFile(mediaPath);
      setIsVideo(isVid);
      
      const mediaLabel = isVid ? 'VIDEO' : isImg ? 'IMAGE' : 'FILE';
      console.log(`\n=== READING ${mediaLabel}: ${mediaPath} ===`);
      
      // Step 1: Get file information
      console.log('[READ] Step 1: Getting file info...');
      const fileInfo = await getFileInfo(mediaPath);
      const fileLength = fileInfo.length;
      const numChunks = fileInfo.chunks;
      
      console.log(`[READ] File info:`);
      console.log(`  - Total file length: ${fileLength} bytes`);
      console.log(`  - Number of chunks: ${numChunks}`);
      console.log(`  - Chunk size: ${CHUNK_SIZE} bytes`);
      
      // Validate we have chunks
      if (numChunks === 0 || fileLength === 0) {
        throw new Error('File is empty or has no chunks');
      }
      
      setStreamProgress({ loaded: 0, total: fileLength, currentChunk: 0, totalChunks: numChunks });

      const readMediaAsBlob = async () => {
        console.log('\n[READ] Step 2: Obtaining leases for all chunks...');
        const chunkLeases = [];
        for (let i = 0; i < numChunks; i++) {
          try {
            const lease = await obtainLease(mediaPath, i);
            if (!lease) {
              throw new Error(`Failed to obtain lease for chunk ${i}`);
            }
            chunkLeases.push(lease);
            console.log(`✓ Lease ${i}: handle=${lease.handle}, primary=${lease.primary}, replicas=${lease.secondaries?.length || 0}`);
          } catch (err) {
            console.error(`[READ] Failed to get lease for chunk ${i}:`, err);
            throw err;
          }
        }

        const firstLease = chunkLeases[0];
        const selectedServer = selectServerForRead(firstLease);

        setServerInfo({
          primary: firstLease.primary,
          secondaries: firstLease.secondaries,
          selectedForRead: selectedServer,
          handle: firstLease.handle,
          totalChunks: numChunks,
          fileSize: fileLength,
          allChunkLocations: chunkLeases.map((lease, idx) => ({
            chunk: idx,
            handle: lease.handle,
            replicas: 1 + (lease.secondaries?.length || 0)
          }))
        });

        console.log(`\n[READ] Step 3: Reading ${numChunks} chunk(s)...`);

        const assembled = new Uint8Array(fileLength);
        let totalBytesRead = 0;

        for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
          console.log(`\n[READ] Processing chunk ${chunkIndex}/${numChunks - 1}:`);

          const lease = chunkLeases[chunkIndex];
          const server = selectServerForRead(lease);

          if (!server) {
            throw new Error(`No server available for chunk ${chunkIndex}`);
          }

          console.log(`  - Selected server: ${server}`);
          console.log(`  - Lease info: handle=${lease.handle}, primary=${lease.primary}`);

          const bytesReadSoFar = chunkIndex * CHUNK_SIZE;
          const bytesRemainingInFile = fileLength - bytesReadSoFar;
          const bytesToReadFromThisChunk = Math.min(CHUNK_SIZE, bytesRemainingInFile);

          console.log(`  - Bytes read so far: ${bytesReadSoFar}`);
          console.log(`  - Bytes remaining in file: ${bytesRemainingInFile}`);
          console.log(`  - Bytes to read from this chunk: ${bytesToReadFromThisChunk}`);

          if (bytesToReadFromThisChunk <= 0) {
            console.warn(`  - No bytes to read from chunk ${chunkIndex}, stopping`);
            break;
          }

          const offset = chunkIndex * CHUNK_SIZE;
          const readUrl = `${API_BASE}/read?path=${encodeURIComponent(mediaPath)}&offset=${offset}&length=${bytesToReadFromThisChunk}`;

          console.log(`[READ] Request: ${readUrl}`);

          const response = await fetch(readUrl);

          console.log(`[READ] Response status: ${response.status} ${response.statusText}`);

          if (!response.ok) {
            let error;
            try {
              error = await response.json();
            } catch {
              error = { error: response.statusText };
            }
            console.error(`[READ] Error response:`, error);
            throw new Error(`Failed to read chunk ${chunkIndex}: ${error.error || response.statusText}`);
          }

          const chunkData = await response.arrayBuffer();
          console.log(`[READ] Received chunk data: ${chunkData.byteLength} bytes`);

          if (chunkData.byteLength !== bytesToReadFromThisChunk) {
            console.warn(`[READ] WARNING: Expected ${bytesToReadFromThisChunk} bytes but got ${chunkData.byteLength} bytes`);
          }

          const chunkBytes = new Uint8Array(chunkData);
          assembled.set(chunkBytes, offset);
          totalBytesRead = Math.max(totalBytesRead, offset + chunkBytes.byteLength);

          setStreamProgress({
            loaded: totalBytesRead,
            total: fileLength,
            currentChunk: chunkIndex + 1,
            totalChunks: numChunks
          });

          console.log(`✓ Chunk ${chunkIndex}: ${chunkData.byteLength} bytes read`);
          console.log(`  - Progress: ${totalBytesRead}/${fileLength} bytes (${((totalBytesRead / fileLength) * 100).toFixed(1)}%)`);
        }

        console.log(`\n[READ] Step 4: Finalizing ${numChunks} chunk(s)...`);
        console.log(`  - Total assembled size: ${totalBytesRead} bytes`);
        const finalData = assembled.slice(0, Math.min(fileLength, totalBytesRead));

        console.log('[READ] Step 5: Creating blob and rendering...');
        const mimeType = isVid
          ? 'video/mp4'
          : isImg
          ? 'image/*'
          : isPdf
          ? 'application/pdf'
          : isText
          ? 'text/plain'
          : 'application/octet-stream';
        const blob = new Blob([finalData], { type: mimeType });
        const url = URL.createObjectURL(blob);

        console.log(`  - Blob size: ${blob.size} bytes`);
        console.log(`  - Blob type: ${blob.type}`);

        if (isVid || isImg) {
          setMediaSrc(url);
          setMediaSrcKind('blob');
          setCurrentMediaPath(mediaPath);
          setDocPreviewType('none');
          setDocPreviewText('');
          setShowMediaModal(true);
          console.log(`✓✓✓ ${isVid ? 'Video' : 'Photo'} loaded and rendered successfully`);
          showNotification(`${isVid ? 'Video' : 'Photo'} loaded successfully`);
        } else if (isPdf) {
          setMediaSrc(url);
          setMediaSrcKind('blob');
          setCurrentMediaPath(mediaPath);
          setDocPreviewType('pdf');
          setDocPreviewText('');
          setShowMediaModal(true);
          showNotification('PDF loaded successfully');
        } else if (isText || isCode) {
          const limited = finalData.slice(0, MAX_TEXT_PREVIEW_BYTES);
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(limited);
          setMediaSrc(null);
          setMediaSrcKind('blob');
          setCurrentMediaPath(mediaPath);
          setDocPreviewType(isCode ? 'code' : 'text');
          setDocPreviewText(text);
          setShowMediaModal(true);
          if (finalData.length > MAX_TEXT_PREVIEW_BYTES) {
            showNotification('Text preview truncated to 200KB');
          } else {
            showNotification('Text loaded successfully');
          }
        } else {
          const fileName = mediaPath.split('/').pop() || 'download';
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
          showNotification(`Downloaded ${fileName}`);
        }

        setStreamProgress(null);
      };

      if (isVid) {
        let firstLease = null;
        try {
          firstLease = await obtainLease(mediaPath, 0);
        } catch (err) {
          console.warn('[READ] Could not obtain initial lease for video:', err);
        }

        if (firstLease) {
          const selectedServer = selectServerForRead(firstLease);
          setServerInfo({
            primary: firstLease.primary,
            secondaries: firstLease.secondaries,
            selectedForRead: selectedServer,
            handle: firstLease.handle,
            totalChunks: numChunks,
            fileSize: fileLength,
            allChunkLocations: [{
              chunk: 0,
              handle: firstLease.handle,
              replicas: 1 + (firstLease.secondaries?.length || 0)
            }]
          });
        }

        const mimeCandidates = [
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
          'video/mp4'
        ];
        const mimeType = mimeCandidates.find(type => window.MediaSource?.isTypeSupported(type)) || 'video/mp4';

        const mediaSource = new MediaSource();
        const objectUrl = URL.createObjectURL(mediaSource);
        setMediaSrc(objectUrl);
        setMediaSrcKind('mse');
        setCurrentMediaPath(mediaPath);
        setDocPreviewType('none');
        setDocPreviewText('');
        setShowMediaModal(true);
        showNotification('Video streaming started');

        const streamChunks = async () => {
          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          let totalBytesRead = 0;

          const waitForUpdate = () => new Promise((resolve, reject) => {
            const handleEnd = () => {
              sourceBuffer.removeEventListener('updateend', handleEnd);
              sourceBuffer.removeEventListener('error', handleError);
              resolve();
            };
            const handleError = () => {
              sourceBuffer.removeEventListener('updateend', handleEnd);
              sourceBuffer.removeEventListener('error', handleError);
              reject(new Error('SourceBuffer error'));
            };
            sourceBuffer.addEventListener('updateend', handleEnd);
            sourceBuffer.addEventListener('error', handleError);
          });

          for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
            const bytesReadSoFar = chunkIndex * CHUNK_SIZE;
            const bytesRemainingInFile = fileLength - bytesReadSoFar;
            const bytesToReadFromThisChunk = Math.min(CHUNK_SIZE, bytesRemainingInFile);

            if (bytesToReadFromThisChunk <= 0) {
              break;
            }

            const offset = chunkIndex * CHUNK_SIZE;
            const readUrl = `${API_BASE}/read?path=${encodeURIComponent(mediaPath)}&offset=${offset}&length=${bytesToReadFromThisChunk}`;
            console.log(`[READ] Request: ${readUrl}`);

            const response = await fetch(readUrl);
            if (!response.ok) {
              let error;
              try {
                error = await response.json();
              } catch {
                error = { error: response.statusText };
              }
              throw new Error(`Failed to read chunk ${chunkIndex}: ${error.error || response.statusText}`);
            }

            const chunkData = await response.arrayBuffer();
            sourceBuffer.appendBuffer(new Uint8Array(chunkData));
            await waitForUpdate();

            totalBytesRead += chunkData.byteLength;
            setStreamProgress({
              loaded: totalBytesRead,
              total: fileLength,
              currentChunk: chunkIndex + 1,
              totalChunks: numChunks
            });
          }

          if (mediaSource.readyState === 'open') {
            mediaSource.endOfStream();
          }
          setStreamProgress(null);
        };

        mediaSource.addEventListener('sourceopen', () => {
          streamChunks().catch((err) => {
            console.error('[READ] Streaming error:', err);
            showNotification('Streaming failed, falling back to full download', 'error');
            if (mediaSource.readyState === 'open') {
              mediaSource.endOfStream('network');
            }
            setStreamProgress(null);
            readMediaAsBlob().catch((fallbackErr) => {
              console.error('[READ] Fallback error:', fallbackErr);
              showNotification(`Failed to stream video: ${fallbackErr.message}`, 'error');
            });
          });
        }, { once: true });

        return;
      }

      // Step 2: Obtain leases for all chunks (get all server locations first)
      await readMediaAsBlob();
      
    } catch (err) {
      console.error('[READ] Fatal error:', err);
      showNotification(`Failed to read media: ${err.message}`, 'error');
      setStreamProgress(null);
    }
  };

  /**
   * DELETE WORKFLOW:
   * 1. Delete file from namespace
   * 2. Master server coordinates deletion across all chunk replicas
   * 3. Clear caches
   */
  const handleDelete = async (photoPath) => {
    if (!confirm(`Are you sure you want to delete ${photoPath.split('/').pop()}?`)) {
      return;
    }

    try {
      console.log(`\n=== DELETING ${photoPath} ===`);
      
      const response = await fetch(`${API_BASE}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: photoPath })
      });

      const result = await response.json();
      console.log('[DELETE] Response:', result);

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete photo');
      }

      console.log(`✓ Deleted ${photoPath}`);
      showNotification('File deleted successfully');
      
      // Clear caches
      setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
      });
      
      setLeaseCache(prev => {
        const newCache = {};
        for (const key in prev) {
          if (!key.startsWith(photoPath + ':')) {
            newCache[key] = prev[key];
          }
        }
        return newCache;
      });
      
      loadPhotos();
    } catch (err) {
      console.error('[DELETE] Error:', err);
      showNotification(`Failed to delete file: ${err.message}`, 'error');
    }
  };

  const handleDeleteFolder = async (folderPath) => {
    if (!confirm(`Delete folder ${folderPath.split('/').pop()} and its contents?`)) {
      return;
    }

    try {
      console.log(`\n=== DELETING FOLDER ${folderPath} ===`);

      const response = await fetch(`${API_BASE}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });

      const result = await response.json();
      console.log('[DELETE FOLDER] Response:', result);

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete folder');
      }

      console.log(`✓ Deleted folder ${folderPath}`);
      showNotification('Folder deleted successfully');

      setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
      });

      loadPhotos();
    } catch (err) {
      console.error('[DELETE FOLDER] Error:', err);
      showNotification(`Failed to delete folder: ${err.message}`, 'error');
    }
  };

  /**
   * Create album (directory)
   */
  const handleCreateFolder = async () => {
    const folderName = prompt('Enter album name:');
    if (!folderName || !folderName.trim()) return;

    try {
      const folderPath = `${currentPath}/${folderName.trim()}`.replace(/\/+/g, '/');
      
      console.log(`[MKDIR] Creating album: ${folderPath}`);
      
      const response = await fetch(`${API_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });

      const result = await response.json();
      console.log('[MKDIR] Response:', result);

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create album');
      }

      console.log(`✓ Created album: ${folderPath}`);
      showNotification('Album created successfully');
      
      // Clear cache
      setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
      });
      
      loadPhotos();
    } catch (err) {
      console.error('[MKDIR] Error:', err);
      showNotification(`Failed to create album: ${err.message}`, 'error');
    }
  };

  const navigateToFolder = (path) => {
    console.log(`[NAV] Navigating to: ${path}`);
    setCurrentPath(path);
    setSelectedPhotos([]);
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(p => p);
    if (parts.length <= 1) return; // Don't go above root
    parts.pop();
    const newPath = '/' + parts.join('/');
    navigateToFolder(newPath);
  };

  const togglePhotoSelection = (photo) => {
    setSelectedPhotos(prev =>
      prev.includes(photo.path)
        ? prev.filter(p => p !== photo.path)
        : [...prev, photo.path]
    );
  };

  const filteredPhotos = photos.filter(photo =>
    photo.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const breadcrumbs = currentPath.split('/').filter(p => p);

  return (
    <div className="min-h-screen app-shell">
      {/* Header */}
      <div className="border-b border-white/5 bg-slate-950/70 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-teal-400 p-[2px]">
                <div className="h-full w-full rounded-[10px] bg-slate-950 flex items-center justify-center">
                  <Image className="w-6 h-6 text-amber-200" />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.35em] text-amber-200/70">Distributed vault</p>
                <h1 className="text-3xl font-semibold text-white font-display">Hercules Vault</h1>
                <p className="text-sm text-slate-300">Chunked storage for photos, videos, and files with replica awareness.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={loadPhotos}
                className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/15 text-slate-100 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/15 text-slate-100 transition-colors"
                title="Toggle view"
              >
                {viewMode === 'grid' ? <List className="w-5 h-5" /> : <Grid className="w-5 h-5" />}
              </button>
              <button
                onClick={handleCreateFolder}
                className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/15 text-slate-100 transition-colors flex items-center gap-2"
              >
                <Folder className="w-5 h-5" />
                <span>New Album</span>
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-400 to-teal-400 hover:from-amber-300 hover:to-teal-300 text-slate-900 font-semibold transition-colors flex items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                <span>Upload</span>
              </button>
            </div>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center space-x-2 text-sm mt-4">
            <button
              onClick={() => navigateToFolder('/photos')}
              className="text-amber-200 hover:text-white transition-colors"
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={index}>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => navigateToFolder('/' + breadcrumbs.slice(0, index + 1).join('/'))}
                  className="text-amber-200 hover:text-white transition-colors"
                >
                  {crumb}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search files, albums, and media..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 animate-slide-in ${
          notification.type === 'success' 
            ? 'bg-green-500' 
            : notification.type === 'error'
            ? 'bg-red-500'
            : 'bg-blue-500'
        } text-white`}>
          {notification.message}
        </div>
      )}

      {/* Stream Progress */}
      {streamProgress && (
        <div className="fixed top-20 right-4 bg-slate-900/80 p-4 rounded-lg shadow-lg z-50 border border-white/10 min-w-72">
          <div className="flex items-center space-x-2 mb-2">
            <Download className="w-4 h-4 text-teal-300 animate-bounce" />
            <span className="text-white text-sm font-semibold">Streaming chunks from replicas...</span>
          </div>
          <div className="text-xs text-slate-400 mb-2">
            Chunk {streamProgress.currentChunk} of {streamProgress.totalChunks}
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-teal-400 transition-all duration-300"
              style={{ width: `${streamProgress.total > 0 ? (streamProgress.loaded / streamProgress.total) * 100 : 0}%` }}
            ></div>
          </div>
          <div className="text-xs text-slate-400 text-right">
            {(streamProgress.loaded / 1024).toFixed(1)} KB / {(streamProgress.total / 1024).toFixed(1)} KB
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-slate-400 text-sm">Loading from distributed file system...</p>
            </div>
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Image className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">No files yet</p>
            <p className="text-sm">Upload your first file, photo, or video to get started</p>
          </div>
        ) : (
          <div className={viewMode === 'grid'
            ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
            : 'space-y-2'
          }>
            {currentPath !== '/photos' && (
              <button
                onClick={navigateUp}
                className="p-4 bg-white/10 hover:bg-white/20 rounded-lg transition-colors flex items-center space-x-3 text-white"
              >
                <Folder className="w-6 h-6 text-gray-400" />
                <span>..</span>
              </button>
            )}

            {filteredPhotos.map((photo, index) => (
              <div
                key={index}
                className={`relative group ${
                  viewMode === 'grid' ? 'aspect-square' : 'flex items-center space-x-3 p-3'
                } bg-white/5 hover:bg-white/15 rounded-lg border border-white/5 transition-all cursor-pointer ${
                  selectedPhotos.includes(photo.path) ? 'ring-2 ring-amber-300/80' : ''
                }`}
                onClick={() => photo.isDir ? navigateToFolder(photo.path) : togglePhotoSelection(photo)}
              >
                {viewMode === 'grid' ? (
                  <>
                    <div className="w-full h-full flex items-center justify-center">
                      {photo.isDir ? (
                        <Folder className="w-16 h-16 text-amber-300" />
                      ) : isVideoFile(photo.name) ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                          className="w-full h-full flex items-center justify-center hover:scale-110 transition-transform"
                        >
                          <Video className="w-16 h-16 text-teal-300" />
                        </button>
                      ) : isImageFile(photo.name) ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                          className="w-full h-full flex items-center justify-center hover:scale-110 transition-transform"
                        >
                          <Image className="w-16 h-16 text-amber-300" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                          className="w-full h-full flex items-center justify-center hover:scale-110 transition-transform"
                        >
                          <File className="w-16 h-16 text-cyan-300" />
                        </button>
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                      <p className="text-white text-sm truncate">{photo.name}</p>
                    </div>
                    {photo.isDir && photo.path !== '/photos' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(photo.path);
                        }}
                        className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete folder"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : !photo.isDir && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(photo.path);
                        }}
                        className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {photo.isDir ? (
                      <Folder className="w-8 h-8 text-amber-300 flex-shrink-0" />
                    ) : isVideoFile(photo.name) ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                        className="flex items-center space-x-3"
                      >
                        <Video className="w-8 h-8 text-teal-300 flex-shrink-0" />
                      </button>
                    ) : isImageFile(photo.name) ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                        className="flex items-center space-x-3"
                      >
                        <Image className="w-8 h-8 text-amber-300 flex-shrink-0" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); readMedia(photo.path); }}
                        className="flex items-center space-x-3"
                      >
                        <File className="w-8 h-8 text-cyan-300 flex-shrink-0" />
                      </button>
                    )}
                    <span className="text-white flex-1 truncate">{photo.name}</span>
                    {photo.isDir && photo.path !== '/photos' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(photo.path);
                        }}
                        className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete folder"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : !photo.isDir && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(photo.path);
                        }}
                        className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Upload Files</h3>
              <button
                onClick={() => !uploadProgress && setShowUploadModal(false)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                disabled={!!uploadProgress}
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {uploadProgress ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Uploading to replicas...</span>
                  <span className="text-amber-200 font-mono">{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <div className="text-xs text-gray-400 truncate">
                  Current: {uploadProgress.currentFile}
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-teal-400 transition-all duration-300"
                    style={{
                      width: `${uploadProgress.totalBytes > 0
                        ? (uploadProgress.bytesUploaded / uploadProgress.totalBytes) * 100
                        : (uploadProgress.current / uploadProgress.total) * 100}%`
                    }}
                  ></div>
                </div>
                <div className="text-xs text-gray-400 text-right">
                  {(uploadProgress.bytesUploaded / 1024 / 1024).toFixed(2)} MB / {(uploadProgress.totalBytes / 1024 / 1024).toFixed(2)} MB
                </div>
                <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-300">
                      Files are being replicated across multiple chunk servers for redundancy and fault tolerance.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block w-full p-8 border-2 border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:border-teal-300 transition-colors">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-white mb-1">Click to upload files, photos, or videos</p>
                  <p className="text-sm text-gray-400">or drag and drop</p>
                  <p className="text-xs text-gray-500 mt-2">Large files are split into 64MB chunks; tails use 16MB append</p>
                  <input
                    type="file"
                    multiple
                    accept="*/*"
                    onChange={(e) => handleUpload(Array.from(e.target.files))}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Media Preview Modal */}
      {showMediaModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl p-4 max-w-6xl w-full shadow-2xl border border-white/10 max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div className="flex-1">
                <p className="text-white font-semibold truncate">{currentMediaPath?.split('/').pop()}</p>
                <p className="text-xs text-gray-400 truncate">{currentMediaPath}</p>
              </div>
              <button 
                onClick={() => { 
                  setShowMediaModal(false); 
                  if (mediaSrc) {
                    URL.revokeObjectURL(mediaSrc);
                  }
                  setMediaSrc(null);
                  setMediaSrcKind('blob');
                  setCurrentMediaPath(null);
                  setServerInfo(null);
                  setIsVideo(false);
                  setDocPreviewType('none');
                  setDocPreviewText('');
                }} 
                className="p-2 hover:bg-white/10 rounded-lg transition-colors ml-4"
              >
                <X className="w-6 h-6 text-gray-300" />
              </button>
            </div>
            
            {isVideo ? (
              <VideoPlayer src={mediaSrc} srcKind={mediaSrcKind} onClose={() => setShowMediaModal(false)} serverInfo={serverInfo} />
            ) : (
              <>
                <div className="flex items-center justify-center bg-black/50 rounded-lg p-4 mb-4">
                  {docPreviewType === 'pdf' && mediaSrc ? (
                    <iframe
                      title="Document preview"
                      src={mediaSrc}
                      className="w-full h-[60vh] rounded"
                    />
                  ) : docPreviewType === 'text' || docPreviewType === 'code' ? (
                    <pre className={`w-full max-h-[60vh] overflow-auto rounded bg-slate-950/70 p-4 text-xs text-slate-200 ${docPreviewType === 'code' ? 'font-mono' : ''} whitespace-pre-wrap`}>
                      {docPreviewText}
                    </pre>
                  ) : mediaSrc ? (
                    <img 
                      src={mediaSrc} 
                      alt="preview" 
                      className="max-h-[60vh] max-w-full object-contain rounded" 
                    />
                  ) : (
                    <div className="flex items-center justify-center h-64">
                      <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
                
                {serverInfo && (
                  <div className="space-y-3">
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-white/10">
                      <div className="flex items-center space-x-2 mb-3">
                        <Server className="w-5 h-5 text-teal-300" />
                        <span className="text-sm font-semibold text-amber-200">Distributed Storage Information</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2 bg-green-500/10 rounded border border-green-500/20">
                            <span className="text-gray-400">Read Server:</span>
                            <span className="font-mono text-green-300">{serverInfo.selectedForRead}</span>
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                            <span className="text-gray-400">Primary:</span>
                            <span className="font-mono text-gray-300">{serverInfo.primary}</span>
                          </div>
                          {serverInfo.secondaries && serverInfo.secondaries.length > 0 && (
                            <div className="p-2 bg-slate-900/60 rounded">
                              <span className="text-gray-400 block mb-1">Replicas ({serverInfo.secondaries.length}):</span>
                              {serverInfo.secondaries.map((sec, idx) => (
                                <div key={idx} className="font-mono text-gray-300 text-xs ml-2">• {sec}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                            <span className="text-gray-400">Chunk Handle:</span>
                            <span className="font-mono text-gray-300">{serverInfo.handle}</span>
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                            <span className="text-gray-400">Total Chunks:</span>
                            <span className="font-mono text-gray-300">{serverInfo.totalChunks}</span>
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                            <span className="text-gray-400">File Size:</span>
                            <span className="font-mono text-gray-300">{(serverInfo.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-900/60 rounded">
                            <span className="text-gray-400">Replication:</span>
                            <span className="font-mono text-amber-200">{1 + (serverInfo.secondaries?.length || 0)}x</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {serverInfo.allChunkLocations && serverInfo.allChunkLocations.length > 1 && (
                      <div className="p-3 bg-slate-800/30 rounded-lg border border-white/5">
                        <div className="text-xs text-gray-400 mb-2">Chunk Distribution:</div>
                        <div className="flex flex-wrap gap-2">
                          {serverInfo.allChunkLocations.map((loc, idx) => (
                            <div key={idx} className="px-2 py-1 bg-teal-400/10 rounded border border-teal-400/20 text-xs">
                              <span className="text-gray-400">#{idx}</span>
                              <span className="text-teal-200 ml-1">×{loc.replicas}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}