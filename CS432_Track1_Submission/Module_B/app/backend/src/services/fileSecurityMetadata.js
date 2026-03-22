const { createHash, randomBytes } = require("crypto");

function buildStoragePath(driveFile, originalName) {
  if (driveFile?.webViewLink) return driveFile.webViewLink;
  if (driveFile?.id) return `gdrive://${driveFile.id}/${encodeURIComponent(originalName || "")}`;
  return `upload://${encodeURIComponent(originalName || "unknown")}`;
}

function buildFileIv() {
  return randomBytes(16).toString("hex");
}

function buildFileHmac(buffer, saltInput) {
  const salt = typeof saltInput === "string" ? saltInput : String(saltInput || "");
  return createHash("sha256").update(buffer).update(":").update(salt).digest("hex");
}

module.exports = {
  buildStoragePath,
  buildFileIv,
  buildFileHmac
};
