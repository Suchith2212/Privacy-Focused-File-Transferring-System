const path = require("path");
const { Readable } = require("stream");
const { getDriveClient } = require("../config/drive");

const folderCache = new Map();

function getFolderId() {
  const value = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!value) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured.");
  }

  // Accept both plain folder ID and full Drive folder URL.
  // Also strip any query parameters from the ID.
  const match = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const id = match ? match[1] : value;
  
  // Strip trailing query parameters if any
  return id.split('?')[0];
}

function normalizeFolderSegments(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const dirName = path.posix.dirname(normalized);
  if (!dirName || dirName === ".") return [];
  return dirName
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

async function findOrCreateFolder(drive, parentId, folderName) {
  const cacheKey = `${parentId}:${folderName}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  const folderPromise = (async () => {
    const escapedName = folderName.replace(/'/g, "\\'");
    const existing = await drive.files.list({
      q: [
        `'${parentId}' in parents`,
        "mimeType = 'application/vnd.google-apps.folder'",
        `name = '${escapedName}'`,
        "trashed = false"
      ].join(" and "),
      fields: "files(id,name)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    const existingFolderId = existing.data?.files?.[0]?.id;
    if (existingFolderId) return existingFolderId;

    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      },
      fields: "id,name",
      supportsAllDrives: true
    });

    return created.data.id;
  })().catch((err) => {
    folderCache.delete(cacheKey);
    throw err;
  });

  folderCache.set(cacheKey, folderPromise);
  return folderPromise;
}

async function ensureFolderPath(drive, baseFolderId, relativePath) {
  const segments = normalizeFolderSegments(relativePath);
  let parentId = baseFolderId;
  for (const segment of segments) {
    parentId = await findOrCreateFolder(drive, parentId, segment);
  }
  return parentId;
}

async function uploadBuffer({ buffer, fileName, mimeType, relativePath }) {
  const drive = getDriveClient();
  const folderId = getFolderId();
  const parentFolderId = await ensureFolderPath(drive, folderId, relativePath);
  const resolvedName = path.posix.basename(String(relativePath || fileName || "upload.bin").replace(/\\/g, "/"));

  const res = await drive.files.create({
    requestBody: {
      name: resolvedName,
      parents: [parentFolderId]
    },
    media: {
      mimeType,
      body: Readable.from(buffer)
    },
    fields: "id,name,mimeType,size,webViewLink",
    supportsAllDrives: true
  });

  return res.data;
}

async function downloadBuffer(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

async function deleteFile(fileId) {
  const drive = getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

module.exports = {
  uploadBuffer,
  downloadBuffer,
  deleteFile
};
