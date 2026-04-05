const {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync
} = require("crypto");

const DEFAULT_FILE_KEY_WRAP_ITERATIONS = 200000;
const FILE_KEY_WRAP_VERSION = 1;

function buildStoragePath(driveFile, originalName) {
  if (driveFile?.webViewLink) return driveFile.webViewLink;
  if (driveFile?.id) return `gdrive://${driveFile.id}/${encodeURIComponent(originalName || "")}`;
  return `upload://${encodeURIComponent(originalName || "unknown")}`;
}

function buildFileIv() {
  return randomBytes(12).toString("hex");
}

function buildFileHmac(buffer, saltInput) {
  const salt = typeof saltInput === "string" ? saltInput : String(saltInput || "");
  return createHash("sha256").update(buffer).update(":").update(salt).digest("hex");
}

function buildPlainFileHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function generateFileKey() {
  return randomBytes(32);
}

function encryptFileBuffer(buffer, fileKey) {
  const ivHex = buildFileIv();
  const iv = Buffer.from(ivHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", fileKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTagHex = cipher.getAuthTag().toString("hex");
  return {
    ciphertext,
    ivHex,
    authTagHex
  };
}

function decryptFileBuffer(ciphertext, fileKey, ivHex, authTagHex) {
  const decipher = createDecipheriv("aes-256-gcm", fileKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function deriveWrappingKey(tokenValue, wrapSaltHex, iterations) {
  return pbkdf2Sync(
    String(tokenValue),
    Buffer.from(wrapSaltHex, "hex"),
    Number(iterations),
    32,
    "sha256"
  );
}

function wrapFileKeyForToken(fileKey, tokenValue) {
  const wrapIterations = Number(process.env.FILE_KEY_WRAP_ITERATIONS || DEFAULT_FILE_KEY_WRAP_ITERATIONS);
  const wrapSaltHex = randomBytes(16).toString("hex");
  const wrapIvHex = buildFileIv();
  const wrappingKey = deriveWrappingKey(tokenValue, wrapSaltHex, wrapIterations);

  const cipher = createCipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapIvHex, "hex"));
  const wrappedFileKeyHex = Buffer.concat([cipher.update(fileKey), cipher.final()]).toString("hex");
  const wrapTagHex = cipher.getAuthTag().toString("hex");

  return {
    wrappedFileKeyHex,
    wrapIvHex,
    wrapTagHex,
    wrapSaltHex,
    wrapIterations,
    wrapVersion: FILE_KEY_WRAP_VERSION
  };
}

function unwrapFileKeyForToken(wrappedFileKeyHex, tokenValue, wrapMeta) {
  if (!wrappedFileKeyHex || !wrapMeta?.wrapIvHex || !wrapMeta?.wrapTagHex || !wrapMeta?.wrapSaltHex) {
    throw new Error("Wrapped file key metadata is incomplete.");
  }

  const wrappingKey = deriveWrappingKey(
    tokenValue,
    wrapMeta.wrapSaltHex,
    Number(wrapMeta.wrapIterations || DEFAULT_FILE_KEY_WRAP_ITERATIONS)
  );
  const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapMeta.wrapIvHex, "hex"));
  decipher.setAuthTag(Buffer.from(wrapMeta.wrapTagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(wrappedFileKeyHex, "hex")),
    decipher.final()
  ]);
}

module.exports = {
  buildStoragePath,
  buildFileIv,
  buildFileHmac,
  buildPlainFileHash,
  generateFileKey,
  encryptFileBuffer,
  decryptFileBuffer,
  wrapFileKeyForToken,
  unwrapFileKeyForToken,
  FILE_KEY_WRAP_VERSION
};
