const DEFAULT_MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILES = 6;

export function mediaUploadConfig(me = null) {
  const media = me?.media || {};
  const store = media.store || "local-files";
  const maxBytes = positiveNumber(media.max_upload_bytes) || DEFAULT_MAX_MEDIA_BYTES;
  const maxFiles = positiveNumber(media.max_files_per_post) || DEFAULT_MAX_FILES;
  const label = `Media: ${formatBytes(maxBytes)} per file`;
  const detail =
    store === "d1-inline"
      ? `${label} until R2 is connected`
      : store === "r2"
        ? `${label} via R2`
        : `${label} locally`;
  return { store, maxBytes, maxFiles, label, detail };
}

export function filterAcceptedMediaFiles(files, config = mediaUploadConfig(), existingCount = 0) {
  const accepted = [];
  const rejected = [];
  const maxFiles = Math.max(0, config.maxFiles || DEFAULT_MAX_FILES);
  const maxBytes = config.maxBytes || DEFAULT_MAX_MEDIA_BYTES;
  const remaining = Math.max(0, maxFiles - existingCount);

  for (const file of files) {
    if (!isMediaFile(file)) {
      rejected.push({ file, reason: `Unsupported file type: ${file.name || "file"}` });
      continue;
    }
    if (file.size > maxBytes) {
      rejected.push({ file, reason: `${file.name || "Media"} is too large (max ${formatBytes(maxBytes)})` });
      continue;
    }
    if (accepted.length >= remaining) {
      rejected.push({ file, reason: `Upload accepts up to ${maxFiles} files` });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isMediaFile(file) {
  return /^image\/|^video\//.test(file?.type || "");
}
