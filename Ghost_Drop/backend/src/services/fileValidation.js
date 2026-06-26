const FileType = require("file-type");

async function validateUploadFile(file) {
  if (!file) {
    return { ok: false, reason: "Invalid file payload." };
  }

  const declaredMime = (file.mimetype || "").toLowerCase();
  let detected = null;

  if (file.path) {
    detected = await FileType.fromFile(file.path).catch(() => null);
  } else if (file.buffer) {
    detected = await FileType.fromBuffer(file.buffer).catch(() => null);
  }

  const normalizedMime = detected?.mime || declaredMime || "application/octet-stream";
  return { ok: true, normalizedMime };
}

module.exports = {
  validateUploadFile
};
