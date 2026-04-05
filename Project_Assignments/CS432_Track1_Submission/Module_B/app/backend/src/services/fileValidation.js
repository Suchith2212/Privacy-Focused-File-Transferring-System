const FileType = require("file-type");

async function validateUploadFile(file) {
  if (!file || !file.buffer) {
    return { ok: false, reason: "Invalid file payload." };
  }

  const declaredMime = (file.mimetype || "").toLowerCase();
  const detected = await FileType.fromBuffer(file.buffer);
  const normalizedMime = detected?.mime || declaredMime || "application/octet-stream";
  return { ok: true, normalizedMime };
}

module.exports = {
  validateUploadFile
};
