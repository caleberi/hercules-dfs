const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|xml|yaml|yml)$/i;

/**
 * Recursively walks the vault via GET /list (same gateway as the UI).
 */
export async function scanVaultTree(apiBase, rootPath = '/photos') {
  const acc = {
    totalFiles: 0,
    totalFolders: 0,
    totalBytes: 0,
    images: 0,
    videos: 0,
    documents: 0,
    other: 0,
    sampleFilePath: null,
  };

  async function walk(dirPath) {
    const url = `${apiBase}/list?path=${encodeURIComponent(dirPath)}`;
    const response = await fetch(url);
    const result = await response.json();
    if (!result.success || !result.data?.entries) return;

    for (const entry of result.data.entries) {
      const name = entry.Name ?? entry.name;
      const isDir = entry.IsDir ?? entry.isDir ?? false;
      const length = Number(entry.Length ?? entry.length ?? 0);
      const fullPath = `${dirPath}/${name}`.replace(/\/+/g, '/');

      if (isDir) {
        acc.totalFolders += 1;
        await walk(fullPath);
        continue;
      }

      acc.totalFiles += 1;
      acc.totalBytes += Number.isFinite(length) ? length : 0;
      if (!acc.sampleFilePath) acc.sampleFilePath = fullPath;

      const base = name.toLowerCase();
      if (IMAGE_EXT.test(base)) acc.images += 1;
      else if (VIDEO_EXT.test(base)) acc.videos += 1;
      else if (DOC_EXT.test(base)) acc.documents += 1;
      else acc.other += 1;
    }
  }

  await walk(rootPath);
  return acc;
}

/** Seven points for the chart: live counts from one recursive scan. */
export function chartSeriesFromScan(scan) {
  if (!scan) {
    return [
      { label: 'IMG', files: 0 },
      { label: 'VID', files: 0 },
      { label: 'DOC', files: 0 },
      { label: 'OTHER', files: 0 },
      { label: 'DIRS', files: 0 },
      { label: 'ALL', files: 0 },
      { label: 'MB', files: 0 },
    ];
  }

  if (scan.totalFiles + scan.totalFolders === 0) {
    return [
      { label: 'IMG', files: 0 },
      { label: 'VID', files: 0 },
      { label: 'DOC', files: 0 },
      { label: 'OTHER', files: 0 },
      { label: 'DIRS', files: 0 },
      { label: 'ALL', files: 0 },
      { label: 'MB', files: 0 },
    ];
  }

  const mbRounded = Math.max(
    0,
    Math.round(scan.totalBytes / (1024 * 1024))
  );

  return [
    { label: 'IMG', files: scan.images },
    { label: 'VID', files: scan.videos },
    { label: 'DOC', files: scan.documents },
    { label: 'OTHER', files: scan.other },
    { label: 'DIRS', files: scan.totalFolders },
    { label: 'ALL', files: scan.totalFiles },
    { label: 'MB', files: mbRounded },
  ];
}
