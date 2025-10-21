import React, { useState, useEffect,useRef} from 'react';
import { Upload, Image, Folder, Trash2, Grid, List, Search, X, ChevronRight, Home, RefreshCw } from 'lucide-react';

const API_BASE = 'http://localhost:8089/api/v1';

export default function PhotoLibrary() {
  const [photos, setPhotos] = useState([]);
  const [currentPath, setCurrentPath] = useState('/photos');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [notification, setNotification] = useState(null);
  const [photoCache, setPhotoCache] = useState({});

  const isInitialMount = useRef(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 const loadPhotos = async () => {
  if (photoCache[currentPath]) {
    setPhotos(photoCache[currentPath]);
    setLoading(false);
    return;
  }

  setLoading(true);
  try {
    const response = await fetch(`${API_BASE}/list?path=${encodeURIComponent(currentPath)}`);
    const result = await response.json();
    
    if (result.success && result.data.entries) {
      const photoEntries = result.data.entries.map(entry => ({
        name: entry.Name || entry,
        isDir: entry.IsDir || false,
        path: `${currentPath}/${entry.Name || entry}`.replace(/\/+/g, '/')
      }));
      setPhotos(photoEntries);
      setPhotoCache(prev => ({ ...prev, [currentPath]: photoEntries }));
    } else {
      setPhotos([]);
    }
  // eslint-disable-next-line no-unused-vars
  } catch (err) {
    showNotification('Failed to load photos', 'error');
    setPhotos([]);
  } finally {
    setLoading(false);
  }
};

  useEffect(() => {
  if (isInitialMount.current) {
    // Skip the artificial second render in StrictMode
    isInitialMount.current = false;
    initializeLibrary()
    return;
  }
  loadPhotos();
}, [currentPath, loadPhotos]);


  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const initializeLibrary = async () => {
    try {
      await fetch(`${API_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/photos' })
      });
    // eslint-disable-next-line no-unused-vars
    } catch (err) {
      console.log('Photos directory may already exist');
    }
  };

  const handleUpload = async (files) => {
    setUploadProgress({ current: 0, total: files.length });
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const fileName = `${currentPath}/${file.name}`.replace(/\/+/g, '/');
        
        await fetch(`${API_BASE}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fileName })
        });

        const reader = new FileReader();
        reader.onload = async (e) => {
          const data = e.target.result;
          await fetch(`${API_BASE}/write?path=${encodeURIComponent(fileName)}&offset=0`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data
          });
        };
        reader.readAsArrayBuffer(file);
        
        setUploadProgress({ current: i + 1, total: files.length });
      // eslint-disable-next-line no-unused-vars
      } catch (err) {
        showNotification(`Failed to upload ${file.name}`, 'error');
      }
    }
    setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
    });

    setTimeout(() => {
      setUploadProgress(null);
      setShowUploadModal(false);
      loadPhotos();
      showNotification(`${files.length} file(s) uploaded successfully`);
    }, 1000);
  };

  const handleDelete = async (photoPath) => {
    try {
      await fetch(`${API_BASE}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: photoPath })
      });
      showNotification('Photo deleted successfully');
      setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
      });
      loadPhotos();
    // eslint-disable-next-line no-unused-vars
    } catch (err) {
      showNotification('Failed to delete photo', 'error');
    }
  };

  const handleCreateFolder = async () => {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;
    
    try {
      const folderPath = `${currentPath}/${folderName}`.replace(/\/+/g, '/');
      await fetch(`${API_BASE}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      showNotification('Folder created successfully');
      setPhotoCache(prev => {
        const newCache = { ...prev };
        delete newCache[currentPath];
        return newCache;
       });
      loadPhotos();
    // eslint-disable-next-line no-unused-vars
    } catch (err) {
      showNotification('Failed to create folder', 'error');
    }
  };

  const navigateToFolder = (path) => {
    setCurrentPath(path);
    setSelectedPhotos([]);
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    setCurrentPath('/' + parts.join('/') || '/photos');
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Image className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Hercules Photo Library</h1>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={loadPhotos}
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                {viewMode === 'grid' ? <List className="w-5 h-5" /> : <Grid className="w-5 h-5" />}
              </button>
              <button
                onClick={handleCreateFolder}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <Folder className="w-5 h-5" />
                <span>New Folder</span>
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <Upload className="w-5 h-5" />
                <span>Upload</span>
              </button>
            </div>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center space-x-2 text-sm">
            <button
              onClick={() => navigateToFolder('/photos')}
              className="text-purple-300 hover:text-white transition-colors"
            >
              <Home className="w-4 h-4" />
            </button>
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={index}>
                <ChevronRight className="w-4 h-4 text-gray-500" />
                <button
                  onClick={() => navigateToFolder('/' + breadcrumbs.slice(0, index + 1).join('/'))}
                  className="text-purple-300 hover:text-white transition-colors"
                >
                  {crumb}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search photos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
          notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          {notification.message}
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Image className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">No photos yet</p>
            <p className="text-sm">Upload your first photo to get started</p>
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
                <Folder className="w-6 h-6" />
                <span>..</span>
              </button>
            )}
            
            {filteredPhotos.map((photo, index) => (
              <div
                key={index}
                className={`relative group ${
                  viewMode === 'grid' ? 'aspect-square' : 'flex items-center space-x-3 p-3'
                } bg-white/10 hover:bg-white/20 rounded-lg transition-all cursor-pointer ${
                  selectedPhotos.includes(photo.path) ? 'ring-2 ring-purple-500' : ''
                }`}
                onClick={() => photo.isDir ? navigateToFolder(photo.path) : togglePhotoSelection(photo)}
              >
                {viewMode === 'grid' ? (
                  <>
                    <div className="w-full h-full flex items-center justify-center">
                      {photo.isDir ? (
                        <Folder className="w-16 h-16 text-purple-400" />
                      ) : (
                        <Image className="w-16 h-16 text-purple-400" />
                      )}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                      <p className="text-white text-sm truncate">{photo.name}</p>
                    </div>
                    {!photo.isDir && (
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
                      <Folder className="w-8 h-8 text-purple-400 flex-shrink-0" />
                    ) : (
                      <Image className="w-8 h-8 text-purple-400 flex-shrink-0" />
                    )}
                    <span className="text-white flex-1 truncate">{photo.name}</span>
                    {!photo.isDir && (
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
              <h3 className="text-xl font-bold text-white">Upload Photos</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            
            {uploadProgress ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Uploading...</span>
                  <span>{uploadProgress.current} / {uploadProgress.total}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block w-full p-8 border-2 border-dashed border-white/20 rounded-lg text-center cursor-pointer hover:border-purple-500 transition-colors">
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-white mb-1">Click to upload photos</p>
                  <p className="text-sm text-gray-400">or drag and drop</p>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => handleUpload(Array.from(e.target.files))}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}