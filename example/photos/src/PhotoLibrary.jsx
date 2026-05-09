import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Upload,
  Image,
  Folder,
  Trash2,
  Search,
  X,
  ChevronRight,
  Home,
  RefreshCw,
  Server,
  Download,
  AlertCircle,
  Video,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  File,
  FolderOpen,
  Settings,
  GraduationCap,
  Star,
  ChevronLeft,
  ArrowRight,
  Sparkles,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { LearningStatsChart } from '@/components/LearningStatsChart';
import { scanVaultTree, chartSeriesFromScan } from '@/lib/vaultScan';

const API_BASE = 'http://localhost:8089/api/v1';
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB per chunk (matching common.ChunkMaxSizeInByte)
const APPEND_MAX = 16 * 1024 * 1024; // 16MB max for append
const MAX_TEXT_PREVIEW_BYTES = 200 * 1024;
const LEASE_EXPIRED_CODE = 8;

function SegmentedProgress({ filled, segments = 12 }) {
  const safe = Math.max(0, Math.min(segments, filled));
  return (
    <div className="flex gap-1">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-2 min-w-[6px] flex-1 rounded-[4px]',
            i < safe ? 'bg-[#3B82F6]' : 'bg-white/10'
          )}
        />
      ))}
    </div>
  );
}

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
const VideoPlayer = ({ src, srcKind, serverInfo }) => {
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
  const [vaultScan, setVaultScan] = useState(null);
  const [vaultScanLoading, setVaultScanLoading] = useState(false);
  const [chartData, setChartData] = useState(() => chartSeriesFromScan(null));
  const [replicaLease, setReplicaLease] = useState(null);
  const [imageThumbs, setImageThumbs] = useState({});
  /** Click Photos/Videos/Documents cards to filter the grid; null shows all. */
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState(null);

  const isInitialMount = useRef(true);
  const thumbInFlightRef = useRef(new Set());

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const copyReplicaAddr = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showNotification('Address copied');
    } catch {
      showNotification('Could not copy', 'error');
    }
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
  const _selectServerForWrite = (lease) => {
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

  const refreshVaultInsights = async () => {
    setVaultScanLoading(true);
    try {
      const scan = await scanVaultTree(API_BASE, '/photos');
      setVaultScan(scan);
      setChartData(chartSeriesFromScan(scan));

      if (scan.sampleFilePath) {
        try {
          const handle = await getChunkHandle(scan.sampleFilePath, 0);
          const response = await fetch(
            `${API_BASE}/chunk/servers?handle=${encodeURIComponent(handle)}`
          );
          const result = await response.json();
          if (result.success && result.data) {
            setReplicaLease({
              primary: result.data.primary,
              secondaries: result.data.secondaries || [],
              handle: result.data.handle,
              expire: result.data.expire,
              samplePath: scan.sampleFilePath,
            });
          } else {
            setReplicaLease(null);
          }
        } catch {
          setReplicaLease(null);
        }
      } else {
        setReplicaLease(null);
      }
    } catch (err) {
      console.error('[VAULT SCAN]', err);
      setVaultScan(null);
      setChartData(chartSeriesFromScan(null));
      setReplicaLease(null);
    } finally {
      setVaultScanLoading(false);
    }
  };

  /**
   * Load directory contents (photos and subdirectories)
   */
  const loadPhotos = async () => {
    // Use cache if available
    if (photoCache[currentPath]) {
      setPhotos(photoCache[currentPath]);
      setLoading(false);
      void refreshVaultInsights();
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
      void refreshVaultInsights();
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

  useEffect(() => {
    setLibraryCategoryFilter(null);
  }, [currentPath]);

  useEffect(() => {
    thumbInFlightRef.current = new Set();
    setImageThumbs((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
  }, [currentPath]);

  useEffect(() => {
    let cancelled = false;
    const q = searchQuery.toLowerCase();
    let filtered = photos.filter((photo) =>
      photo.name.toLowerCase().includes(q)
    );
    if (libraryCategoryFilter === 'image') {
      filtered = filtered.filter((p) => p.isDir || isImageFile(p.name));
    } else if (libraryCategoryFilter === 'video') {
      filtered = filtered.filter((p) => p.isDir || isVideoFile(p.name));
    } else if (libraryCategoryFilter === 'document') {
      filtered = filtered.filter(
        (p) =>
          p.isDir ||
          (!isImageFile(p.name) && !isVideoFile(p.name))
      );
    }
    const targets = filtered
      .filter((p) => !p.isDir && isImageFile(p.name))
      .slice(0, 48);

    (async () => {
      for (const p of targets) {
        if (cancelled) break;
        if (thumbInFlightRef.current.has(p.path)) continue;
        thumbInFlightRef.current.add(p.path);
        try {
          const fiRes = await fetch(
            `${API_BASE}/fileinfo?path=${encodeURIComponent(p.path)}`
          );
          const fi = await fiRes.json();
          if (!fi.success || cancelled) continue;
          const len = fi.data.length;
          const readLen = Math.min(Math.max(len, 1), 512 * 1024);
          const rd = await fetch(
            `${API_BASE}/read?path=${encodeURIComponent(p.path)}&offset=0&length=${readLen}`
          );
          if (!rd.ok || cancelled) continue;
          const buf = await rd.arrayBuffer();
          const blob = new Blob([buf], { type: 'image/*' });
          const url = URL.createObjectURL(blob);
          setImageThumbs((prev) => {
            if (prev[p.path]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [p.path]: url };
          });
        } catch {
          /* skip thumbnail */
        } finally {
          thumbInFlightRef.current.delete(p.path);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photos, searchQuery, viewMode, currentPath, libraryCategoryFilter]);

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
    } catch {
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

  const filteredPhotos = useMemo(
    () =>
      photos.filter((photo) =>
        photo.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [photos, searchQuery]
  );

  const libraryEntries = useMemo(() => {
    if (!libraryCategoryFilter) return filteredPhotos;
    return filteredPhotos.filter((p) => {
      if (p.isDir) return true;
      if (libraryCategoryFilter === 'image') return isImageFile(p.name);
      if (libraryCategoryFilter === 'video') return isVideoFile(p.name);
      return !isImageFile(p.name) && !isVideoFile(p.name);
    });
  }, [filteredPhotos, libraryCategoryFilter]);

  const breadcrumbs = currentPath.split('/').filter(p => p);

  const filesOnly = filteredPhotos.filter((p) => !p.isDir);
  const imageCount = filesOnly.filter((p) => isImageFile(p.name)).length;
  const videoCount = filesOnly.filter((p) => isVideoFile(p.name)).length;
  const docCount = filesOnly.filter(
    (p) => !isImageFile(p.name) && !isVideoFile(p.name)
  ).length;
  const folderEntries = photos.filter((p) => p.isDir);
  const GOAL = 30;
  /** Capacity toward GOAL; ceil so 1 file still fills ≥1 segment. */
  const CARD_SEGMENTS = 10;
  const segTowardGoal = (n) => {
    if (n <= 0) return 0;
    return Math.min(
      CARD_SEGMENTS,
      Math.ceil((Math.min(n, GOAL) / GOAL) * CARD_SEGMENTS)
    );
  };
  const pctTowardGoal = (n) =>
    Math.min(100, Math.round((Math.min(n, GOAL) / GOAL) * 100));

  const onUploadDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const fl = Array.from(e.dataTransfer?.files || []);
    if (fl.length) handleUpload(fl);
  };

  return (
    <div className="min-h-screen app-shell text-white">
      {notification && (
        <div
          className={`fixed top-4 right-4 z-[60] rounded-xl px-5 py-3 text-sm shadow-xl animate-slide-in ${
            notification.type === 'success'
              ? 'bg-emerald-600'
              : notification.type === 'error'
                ? 'bg-red-600'
                : 'bg-[#3B82F6]'
          } text-white`}
        >
          {notification.message}
        </div>
      )}

      {streamProgress && (
        <div className="fixed top-20 right-4 z-[60] min-w-72 rounded-xl border border-white/10 bg-[#1D1F2B]/95 p-4 shadow-xl backdrop-blur-md">
          <div className="mb-2 flex items-center gap-2">
            <Download className="size-4 animate-bounce text-[#60A5FA]" />
            <span className="text-sm font-semibold">
              Streaming chunks from replicas...
            </span>
          </div>
          <div className="mb-2 text-xs text-slate-400">
            Chunk {streamProgress.currentChunk} of {streamProgress.totalChunks}
          </div>
          <Progress
            value={
              streamProgress.total > 0
                ? (streamProgress.loaded / streamProgress.total) * 100
                : 0
            }
          />
          <div className="mt-2 text-right text-xs text-slate-400">
            {(streamProgress.loaded / 1024).toFixed(1)} KB /{' '}
            {(streamProgress.total / 1024).toFixed(1)} KB
          </div>
        </div>
      )}

      <div className="flex min-h-screen">
        <aside className="flex w-[72px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#161824]/90 py-6 backdrop-blur-md">
          <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3B82F6] via-[#EC4899] to-orange-400 shadow-lg shadow-[#3B82F6]/20">
            <GraduationCap className="size-5 text-white" />
          </div>
          <nav className="flex flex-1 flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl bg-[#3B82F6]/20 text-[#93C5FD] ring-1 ring-[#3B82F6]/30"
                  asChild
                >
                  <Link to="/">
                    <FolderOpen className="size-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Media library</TooltipContent>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"
                  asChild
                >
                  <Link to="/settings">
                    <Settings className="size-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          </nav>
          <Avatar className="mt-4 ring-2 ring-orange-400/40">
            <AvatarFallback className="bg-[#252836] text-xs font-semibold">
              HV
            </AvatarFallback>
          </Avatar>
        </aside>

        <div className="hidden w-[200px] shrink-0 flex-col border-r border-white/[0.06] bg-[#141622]/95 py-8 pl-4 pr-3 backdrop-blur-md lg:flex xl:w-[220px]">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">
            Albums
          </p>
          <div className="flex max-h-[calc(100vh-8rem)] flex-col gap-1 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => navigateToFolder('/photos')}
              className={cn(
                'flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors',
                currentPath === '/photos'
                  ? 'bg-[#3B82F6]/15 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
            >
              <span className="truncate">Photos</span>
              {currentPath === '/photos' && (
                <ChevronRight className="size-4 shrink-0 text-[#3B82F6]" />
              )}
            </button>
            {folderEntries.map((folder) => (
              <button
                key={folder.path}
                type="button"
                onClick={() => navigateToFolder(folder.path)}
                className={cn(
                  'flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors',
                  currentPath === folder.path
                    ? 'bg-[#3B82F6]/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                )}
              >
                <span className="truncate">{folder.name}</span>
                {currentPath === folder.path && (
                  <ChevronRight className="size-4 shrink-0 text-[#3B82F6]" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
          <main className="min-w-0 flex-1 px-4 pb-10 pt-6 md:px-8">
            <header className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                  Hello!
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  You&apos;re making great progress—vault replication is ready.
                </p>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-3 xl:max-w-xl xl:flex-initial xl:justify-end">
                <div className="relative min-w-[200px] flex-1 xl:flex-initial xl:min-w-[320px]">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    className="rounded-full border-white/10 bg-[#1D1F2B]/90 pl-11 text-sm uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal"
                    placeholder="Search by keywords or courses"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="rounded-full px-6 font-bold uppercase tracking-wide"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload now
                </Button>
              </div>
            </header>

            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => navigateToFolder('/photos')}
                className="flex items-center gap-1 text-[#93C5FD] hover:text-white"
              >
                <Home className="size-3.5" />
              </button>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={index}>
                  <ChevronRight className="size-3.5 text-slate-600" />
                  <button
                    type="button"
                    onClick={() =>
                      navigateToFolder('/' + breadcrumbs.slice(0, index + 1).join('/'))
                    }
                    className="truncate text-[#93C5FD] hover:text-white"
                  >
                    {crumb}
                  </button>
                </React.Fragment>
              ))}
            </div>

            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                  Media library
                </h1>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 rounded-full border-white/10"
                    type="button"
                    onClick={() =>
                      setViewMode((m) => (m === 'grid' ? 'list' : 'grid'))
                    }
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 rounded-full border-white/10"
                    type="button"
                    onClick={() =>
                      setViewMode((m) => (m === 'grid' ? 'list' : 'grid'))
                    }
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" type="button" onClick={loadPhotos}>
                  <RefreshCw className="size-4" />
                  Refresh
                </Button>
                <Button variant="outline" type="button" onClick={handleCreateFolder}>
                  <Folder className="size-4" />
                  New album
                </Button>
                <Button variant="outline" type="button" onClick={() => setShowUploadModal(true)}>
                  <Upload className="size-4" />
                  Upload
                </Button>
              </div>
            </div>

            <div className="hide-scrollbar mb-8 flex gap-4 overflow-x-auto pb-2">
              {[
                {
                  title: 'Photos',
                  subtitle: 'Images & renders',
                  Icon: Image,
                  count: imageCount,
                  filterKey: 'image',
                  tint: 'from-[#F97316]/30 to-[#EC4899]/20',
                  star: true,
                },
                {
                  title: 'Videos',
                  subtitle: 'Streams & clips',
                  Icon: Video,
                  count: videoCount,
                  filterKey: 'video',
                  tint: 'from-[#3B82F6]/35 to-cyan-500/15',
                  star: false,
                },
                {
                  title: 'Documents',
                  subtitle: 'PDFs & files',
                  Icon: File,
                  count: docCount,
                  filterKey: 'document',
                  tint: 'from-violet-500/25 to-[#3B82F6]/10',
                  star: false,
                },
              ].map((item) => {
                const selected = libraryCategoryFilter === item.filterKey;
                return (
                <Card
                  key={item.title}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setLibraryCategoryFilter((prev) =>
                      prev === item.filterKey ? null : item.filterKey
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setLibraryCategoryFilter((prev) =>
                        prev === item.filterKey ? null : item.filterKey
                      );
                    }
                  }}
                  className={cn(
                    'min-w-[260px] flex-1 cursor-pointer border-white/[0.07] transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/60',
                    item.star && !selected && 'ring-1 ring-[#FBBF24]/35',
                    selected && 'ring-2 ring-[#3B82F6]',
                    'hover:border-[#3B82F6]/35'
                  )}
                  title={
                    selected
                      ? 'Click to show all file types'
                      : `Show only ${item.title.toLowerCase()} in this folder`
                  }
                >
                  <CardHeader className="relative pb-2">
                    {item.star && (
                      <Star className="absolute right-5 top-5 size-4 fill-[#FBBF24] text-[#FBBF24]" />
                    )}
                    <div
                      className={cn(
                        'mb-4 flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br',
                        item.tint
                      )}
                    >
                      <item.Icon className="size-14 text-white/90 drop-shadow-lg" />
                    </div>
                    <CardTitle>{item.title}</CardTitle>
                    <CardDescription>{item.subtitle}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <span>
                        Progress {Math.min(item.count, GOAL)}/{GOAL}
                      </span>
                      <span className="text-[#93C5FD]">{pctTowardGoal(item.count)}%</span>
                    </div>
                    <SegmentedProgress
                      filled={segTowardGoal(item.count)}
                      segments={CARD_SEGMENTS}
                    />
                  </CardContent>
                </Card>
              );
              })}
            </div>

            <Card className="border-white/[0.07]">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">Vault inventory</CardTitle>
                  <CardDescription>
                    Open previews stream from chunk replicas; uploads accept any file type.
                  </CardDescription>
                </div>
                <Badge variant="outline">Live</Badge>
              </CardHeader>
              <CardContent className="space-y-6">
                {loading ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-3">
                    <div className="size-10 animate-spin rounded-full border-2 border-[#3B82F6] border-t-transparent" />
                    <p className="text-sm text-slate-400">Loading from filesystem...</p>
                  </div>
                ) : libraryEntries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                    <Image className="mb-4 size-14 opacity-40" />
                    <p className="text-lg font-medium text-slate-300">Nothing here yet</p>
                    <p className="mt-1 max-w-sm text-sm">
                      {libraryCategoryFilter
                        ? 'Nothing matches this filter in the current folder. Clear the card filter or pick another album.'
                        : 'Upload documents, video, images—large files use 64MB chunks with a 16MB tail append.'}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {libraryCategoryFilter && (
                        <Button
                          type="button"
                          variant="outline"
                          className="uppercase tracking-wide"
                          onClick={() => setLibraryCategoryFilter(null)}
                        >
                          Clear filter
                        </Button>
                      )}
                      <Button
                        type="button"
                        className="uppercase tracking-wide"
                        onClick={() => setShowUploadModal(true)}
                      >
                        Upload assets
                      </Button>
                    </div>
                  </div>
                ) : viewMode === 'list' ? (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.06] hover:bg-transparent">
                        <TableHead>Course name</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead className="text-right">Storage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentPath !== '/photos' && (
                        <TableRow>
                          <TableCell colSpan={3}>
                            <button
                              type="button"
                              onClick={navigateUp}
                              className="flex items-center gap-2 text-[#93C5FD] hover:text-white"
                            >
                              <Folder className="size-4" />
                              <span>Parent folder</span>
                            </button>
                          </TableCell>
                        </TableRow>
                      )}
                      {libraryEntries.map((photo, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#252836]">
                                {photo.isDir ? (
                                  <Folder className="size-5 text-orange-300" />
                                ) : isVideoFile(photo.name) ? (
                                  <Video className="size-5 text-cyan-300" />
                                ) : isImageFile(photo.name) && imageThumbs[photo.path] ? (
                                  <img
                                    src={imageThumbs[photo.path]}
                                    alt=""
                                    className="size-full object-cover"
                                  />
                                ) : isImageFile(photo.name) ? (
                                  <Image className="size-5 text-orange-200" />
                                ) : (
                                  <File className="size-5 text-[#93C5FD]" />
                                )}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    photo.isDir
                                      ? navigateToFolder(photo.path)
                                      : readMedia(photo.path)
                                  }
                                  className="text-left font-medium text-white hover:text-[#93C5FD]"
                                >
                                  {photo.name}
                                </button>
                                <p className="text-xs text-slate-500">
                                  {photo.isDir ? 'Album' : 'Replica-aware media'}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {photo.isDir ? (
                              <Badge variant="outline">Folder</Badge>
                            ) : selectedPhotos.includes(photo.path) ? (
                              <Badge>Selected</Badge>
                            ) : (
                              <Badge variant="accent">Ready</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm font-medium text-[#93C5FD]">
                              Hercules DFS
                            </span>
                            <div className="mt-2 flex justify-end gap-2">
                              {!photo.isDir && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-lg"
                                  type="button"
                                  onClick={() => readMedia(photo.path)}
                                >
                                  Open
                                </Button>
                              )}
                              {!photo.isDir && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                  type="button"
                                  onClick={() => handleDelete(photo.path)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                              {photo.isDir && photo.path !== '/photos' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-red-400 hover:bg-red-500/10"
                                  type="button"
                                  onClick={() => handleDeleteFolder(photo.path)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {currentPath !== '/photos' && (
                      <button
                        type="button"
                        onClick={navigateUp}
                        className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] transition-colors hover:bg-white/[0.08]"
                      >
                        <Folder className="size-10 text-slate-400" />
                        <span className="text-sm text-slate-300">..</span>
                      </button>
                    )}
                    {libraryEntries.map((photo, index) => (
                      <div
                        key={index}
                        role="presentation"
                        className={cn(
                          'group relative aspect-square cursor-pointer overflow-hidden rounded-2xl border border-white/[0.06] bg-[#1D1F2B]/80 transition-all hover:border-[#3B82F6]/30',
                          selectedPhotos.includes(photo.path) &&
                            'ring-2 ring-[#3B82F6]/60'
                        )}
                        onClick={() =>
                          photo.isDir ? navigateToFolder(photo.path) : togglePhotoSelection(photo)
                        }
                      >
                        <div className="flex h-full w-full items-center justify-center">
                          {photo.isDir ? (
                            <Folder className="size-16 text-orange-300" />
                          ) : isVideoFile(photo.name) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                readMedia(photo.path);
                              }}
                              className="flex size-full items-center justify-center hover:scale-105"
                            >
                              <Video className="size-16 text-cyan-300" />
                            </button>
                          ) : isImageFile(photo.name) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                readMedia(photo.path);
                              }}
                              className="relative flex size-full items-center justify-center hover:scale-[1.02]"
                            >
                              {imageThumbs[photo.path] ? (
                                <img
                                  src={imageThumbs[photo.path]}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              ) : (
                                <Image className="size-16 text-orange-200 opacity-60" />
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                readMedia(photo.path);
                              }}
                              className="flex size-full items-center justify-center hover:scale-105"
                            >
                              <File className="size-16 text-[#93C5FD]" />
                            </button>
                          )}
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
                          <p className="truncate text-sm font-medium">{photo.name}</p>
                        </div>
                        {photo.isDir && photo.path !== '/photos' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFolder(photo.path);
                            }}
                            className="absolute right-2 top-2 rounded-lg bg-red-600/90 p-2 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                          >
                            <Trash2 className="size-4 text-white" />
                          </button>
                        ) : (
                          !photo.isDir && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(photo.path);
                              }}
                              className="absolute right-2 top-2 rounded-lg bg-red-600/90 p-2 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                            >
                              <Trash2 className="size-4 text-white" />
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </main>

          <aside className="w-full shrink-0 border-t border-white/[0.06] bg-[#12141D]/50 p-5 lg:w-[300px] lg:border-l lg:border-t-0 xl:w-[320px]">
            <Card className="border-white/[0.07] bg-[#1D1F2B]/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vault stats</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Recursive{' '}
                  <span className="font-mono text-slate-400">GET /api/v1/list</span> under{' '}
                  <span className="font-mono text-slate-400">/photos</span>
                  {vaultScan != null && (
                    <span className="mt-1 block text-slate-400">
                      {vaultScan.totalFiles} files · {vaultScan.totalFolders} folders ·{' '}
                      {(vaultScan.totalBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LearningStatsChart data={chartData} loading={vaultScanLoading} />
              </CardContent>
            </Card>

            <Card className="mt-4 border-white/[0.07] bg-[#1D1F2B]/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Chunk replicas</CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Lease from first vault file (
                  <span className="font-mono text-[10px] text-slate-400">
                    GET /chunk/handle · /chunk/servers
                  </span>
                  ). Click an address to copy.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0">
                {!replicaLease && (
                  <p className="text-xs text-slate-500">
                    No files under /photos yet—upload something to resolve chunkservers.
                  </p>
                )}
                {replicaLease?.primary != null && replicaLease.primary !== '' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-auto flex-col items-start gap-1 border-white/10 px-3 py-2 text-left font-mono text-[11px] text-[#93C5FD] hover:bg-white/10"
                        onClick={() => copyReplicaAddr(String(replicaLease.primary))}
                      >
                        <span className="font-sans text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Primary
                        </span>
                        <span className="line-clamp-2 break-all text-white">
                          {String(replicaLease.primary)}
                        </span>
                        <span className="flex items-center gap-1 font-sans text-[10px] text-slate-500">
                          <Copy className="size-3" /> Copy
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Copy primary address</TooltipContent>
                  </Tooltip>
                )}
                {(replicaLease?.secondaries || []).map((sec, i) => (
                  <Tooltip key={`${sec}-${i}`}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto flex-col items-start gap-1 px-3 py-2 text-left font-mono text-[11px] text-slate-300 hover:bg-white/10"
                        onClick={() => copyReplicaAddr(String(sec))}
                      >
                        <span className="font-sans text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Secondary {i + 1}
                        </span>
                        <span className="line-clamp-2 break-all">{String(sec)}</span>
                        <span className="flex items-center gap-1 font-sans text-[10px] text-slate-500">
                          <Copy className="size-3" /> Copy
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Copy replica address</TooltipContent>
                  </Tooltip>
                ))}
              </CardContent>
            </Card>

            <Card className="relative mt-4 overflow-hidden border-white/[0.07] bg-gradient-to-br from-[#1D1F2B] to-[#141622]">
              <div className="absolute right-4 top-4 opacity-10">
                <Sparkles className="size-24 text-[#3B82F6]" />
              </div>
              <CardHeader className="relative flex-row items-center justify-between">
                <CardTitle className="max-w-[85%] text-base leading-snug">
                  Chunked uploads—keep originals safe across replicas
                </CardTitle>
                <button type="button" className="text-[10px] font-bold uppercase tracking-wider text-[#93C5FD] hover:text-white">
                  Popular
                </button>
              </CardHeader>
              <CardContent className="relative space-y-4">
                <div className="flex gap-2">
                  <Badge variant="outline">Vault</Badge>
                  <Badge variant="accent">DFS</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <FolderOpen className="size-3.5" /> Multi-part
                  </span>
                  <span className="flex items-center gap-1">
                    <Upload className="size-3.5" /> Any MIME
                  </span>
                </div>
                <Button
                  type="button"
                  className="w-full rounded-xl uppercase tracking-wide"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload files
                  <ArrowRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md border-white/10 shadow-2xl">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Upload assets</CardTitle>
                <CardDescription>
                  Documents, video, images, archives—same chunked pipeline as before.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full"
                disabled={!!uploadProgress}
                onClick={() => !uploadProgress && setShowUploadModal(false)}
              >
                <X className="size-5 text-slate-400" />
              </Button>
            </CardHeader>
            <CardContent>
              {uploadProgress ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">Uploading to replicas...</span>
                    <span className="font-mono text-[#93C5FD]">
                      {uploadProgress.current} / {uploadProgress.total}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    Current: {uploadProgress.currentFile}
                  </div>
                  <Progress
                    value={
                      uploadProgress.totalBytes > 0
                        ? (uploadProgress.bytesUploaded / uploadProgress.totalBytes) * 100
                        : (uploadProgress.current / uploadProgress.total) * 100
                    }
                  />
                  <div className="text-right text-xs text-slate-500">
                    {(uploadProgress.bytesUploaded / 1024 / 1024).toFixed(2)} MB /{' '}
                    {(uploadProgress.totalBytes / 1024 / 1024).toFixed(2)} MB
                  </div>
                  <div className="rounded-xl border border-[#3B82F6]/25 bg-[#3B82F6]/10 p-3">
                    <div className="flex gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#93C5FD]" />
                      <p className="text-xs text-slate-300">
                        Files replicate across chunkservers for redundancy and fault tolerance.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <label
                  className="block cursor-pointer rounded-2xl border-2 border-dashed border-white/15 bg-[#141622]/60 p-10 text-center transition-colors hover:border-[#3B82F6]/50"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={onUploadDrop}
                >
                  <Upload className="mx-auto mb-3 size-12 text-slate-500" />
                  <p className="mb-1 font-medium text-white">
                    Drop files here or click to browse
                  </p>
                  <p className="text-sm text-slate-400">
                    PDF, Office, video, images, code—accepts all MIME types (
                    <span className="font-mono text-xs">*/*</span>)
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Large files: 64MB writes + ≤16MB append tail
                  </p>
                  <input
                    type="file"
                    multiple
                    accept="*/*"
                    onChange={(e) =>
                      handleUpload(Array.from(e.target.files || []))
                    }
                    className="hidden"
                  />
                </label>
              )}
            </CardContent>
          </Card>
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
              <VideoPlayer src={mediaSrc} srcKind={mediaSrcKind} serverInfo={serverInfo} />
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