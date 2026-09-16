/** Deterministic storage key conventions. */
export const storageKeys = {
  mediaOriginal: (assetId: string, ext: string) => `media/${assetId}/original.${ext}`,
  mediaVariant: (assetId: string, kind: string, ext: string) => `media/${assetId}/${kind.toLowerCase()}.${ext}`,
  attachment: (submissionId: string, attachmentId: string, ext: string) => `attachments/${submissionId}/${attachmentId}.${ext}`,
  publication: (editionId: string, versionId: string, fileName: string) => `publications/${editionId}/${versionId}/${fileName}`,
  tmp: (name: string) => `tmp/${name}`,
};

export function extensionForMime(mime: string) {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "text/plain": "txt",
    "text/csv": "csv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/webm": "weba",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mime] ?? "bin";
}
