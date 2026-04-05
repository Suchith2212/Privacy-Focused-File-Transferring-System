const express = require("express");
const { v4: uuidv4 } = require("uuid");
const JSZip = require("jszip");
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("crypto");
const { query, getConnection } = require("../config/db");
const {
  computeTokenLookupHash,
  verifyInnerToken,
  generateOuterToken,
  hashInnerToken,
  isBase62
} = require("../services/crypto");
const { uploadBuffer, downloadBuffer, deleteFile } = require("../services/driveService");
const { validateUploadFile } = require("../services/fileValidation");
const {
  checkRateLimit,
  checkRouteRateLimit,
  recordAttempt,
  recordFailure,
  recordRouteAttempt,
  clearFailure,
  isBlocked,
  blockedRemainingSeconds,
  shouldRequireCaptcha,
  verifyCaptcha,
  isCaptchaSolved,
  getClientIp,
  evaluateIpRisk
} = require("../services/security");
const {
  ensureSession,
  logAuthAttempt,
  upsertExpiryJob
} = require("../services/auditService");
const { ensureRelativePathColumn } = require("../services/filePathSchema");
const { createPortfolioEntry } = require("../services/portfolioService");
const { appendAuditLog } = require("../services/fileAuditLogger");
const {
  buildStoragePath,
  buildFileHmac,
  buildPlainFileHash,
  generateFileKey,
  encryptFileBuffer,
  decryptFileBuffer,
  wrapFileKeyForToken,
  unwrapFileKeyForToken
} = require("../services/fileSecurityMetadata");
const upload = require("../middleware/upload");

const router = express.Router();

const MB = 1024 * 1024;
const DEFAULT_MAX_VAULT_SIZE_MB = 250;
const DEFAULT_MAX_TOTAL_SYSTEM_SIZE_MB = 14 * 1024; // 14 GB
const DEFAULT_UPLOAD_CONCURRENCY = 4;
const DEFAULT_BATCH_DOWNLOAD_MAX_FILES = 10;
const SUB_TOKEN_SECRET_VERSION = 1;

function getLimitBytes(envName, defaultMb) {
  const raw = Number(process.env[envName]);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : defaultMb;
  return Math.floor(mb * MB);
}

const MAX_VAULT_SIZE_BYTES = getLimitBytes("MAX_VAULT_SIZE_MB", DEFAULT_MAX_VAULT_SIZE_MB);
const MAX_TOTAL_SYSTEM_SIZE_BYTES = getLimitBytes("MAX_TOTAL_SYSTEM_SIZE_MB", DEFAULT_MAX_TOTAL_SYSTEM_SIZE_MB);
const UPLOAD_CONCURRENCY = Math.max(1, Number(process.env.UPLOAD_CONCURRENCY || DEFAULT_UPLOAD_CONCURRENCY));
const BATCH_DOWNLOAD_MAX_FILES = Math.max(
  1,
  Number(process.env.BATCH_DOWNLOAD_MAX_FILES || DEFAULT_BATCH_DOWNLOAD_MAX_FILES)
);

function totalBytes(files) {
  return (files || []).reduce((sum, file) => sum + Number(file?.size || 0), 0);
}

function normalizeRelativePath(input) {
  return String(input || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getRelativePaths(body) {
  const raw = body?.relativePaths;
  if (Array.isArray(raw)) return raw.map(normalizeRelativePath);
  if (typeof raw === "string" && raw.length > 0) return [normalizeRelativePath(raw)];
  return [];
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function getActiveSystemUsageBytes() {
  const rows = await query(
    `
    SELECT COALESCE(SUM(file_size), 0) AS total_size
    FROM files
    WHERE status = 'ACTIVE'
    `
  );
  return Number(rows[0]?.total_size || 0);
}

async function getActiveVaultUsageBytes(vaultId) {
  const rows = await query(
    `
    SELECT COALESCE(SUM(file_size), 0) AS total_size
    FROM files
    WHERE vault_id = ? AND status = 'ACTIVE'
    `,
    [vaultId]
  );
  return Number(rows[0]?.total_size || 0);
}

async function resolveVaultByOuterToken(outerToken) {
  const rows = await query(
    `
    SELECT vault_id, status, expires_at
    FROM vaults
    WHERE outer_token = ?
    `,
    [outerToken]
  );
  if (rows.length === 0) return null;

  const vault = rows[0];
  if (vault.status !== "ACTIVE") return null;
  if (new Date(vault.expires_at) <= new Date()) return null;
  return vault;
}

function validateInnerToken(innerToken) {
  if (typeof innerToken !== "string") return false;
  if (innerToken.length < 10 || innerToken.length > 20) return false;
  return isBase62(innerToken);
}

async function generateUniqueOuterToken() {
  for (let i = 0; i < 8; i += 1) {
    const token = generateOuterToken();
    const rows = await query("SELECT vault_id FROM vaults WHERE outer_token = ?", [token]);
    if (rows.length === 0) return token;
  }
  throw new Error("Unable to generate unique outer token.");
}

function getRemainingSeconds(expiresAt) {
  const remaining = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

function securityErrorPayload(message, extra = {}) {
  return {
    error: message,
    ...extra
  };
}

function sanitizeArchiveFilename(filename, fallback = "file.bin") {
  const source = String(filename || "").trim() || fallback;
  const safe = source
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return safe || fallback;
}

function reserveUniqueArchiveName(baseName, usedNames) {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  const dotIndex = baseName.lastIndexOf(".");
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : "";
  let counter = 2;
  while (counter <= 9999) {
    const candidate = `${stem} (${counter})${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }

  const fallback = `${stem}-${Date.now()}${ext}`;
  usedNames.add(fallback);
  return fallback;
}

let ensureSubTokenSecretsTablePromise = null;
async function ensureSubTokenSecretsTable() {
  if (!ensureSubTokenSecretsTablePromise) {
    ensureSubTokenSecretsTablePromise = (async () => {
      const tableRows = await query(
        `
        SELECT 1
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sub_token_secrets'
        LIMIT 1
        `
      );
      if (tableRows.length === 0) {
        throw new Error(
          "Missing table sub_token_secrets. Apply backend/sql/init_schema.sql to provision encrypted SUB-token storage."
        );
      }

      const requiredColumns = [
        "inner_token_id",
        "vault_id",
        "sub_inner_token",
        "secret_ciphertext",
        "secret_iv",
        "secret_auth_tag",
        "secret_version",
        "created_at",
        "updated_at"
      ];
      const columnRows = await query(
        `
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sub_token_secrets'
        `
      );
      const present = new Set(columnRows.map((row) => row.COLUMN_NAME));
      const missing = requiredColumns.filter((name) => !present.has(name));
      if (missing.length > 0) {
        throw new Error(
          `sub_token_secrets schema is outdated. Missing columns: ${missing.join(", ")}. Re-apply backend/sql/init_schema.sql.`
        );
      }
    })().catch((err) => {
      ensureSubTokenSecretsTablePromise = null;
      throw err;
    });
  }
  return ensureSubTokenSecretsTablePromise;
}

function getSubTokenSecretKey() {
  const seed = String(process.env.SUB_TOKEN_SECRET_KEY || "").trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (!seed) {
    if (env === "production") {
      throw new Error("SUB_TOKEN_SECRET_KEY must be set in production.");
    }
    return createHash("sha256").update("ghostdrop-sub-token-dev-secret").digest();
  }
  return createHash("sha256").update(String(seed)).digest();
}

function encryptSubTokenSecret(subInnerToken) {
  const iv = randomBytes(12);
  const key = getSubTokenSecretKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(subInnerToken), "utf8"),
    cipher.final()
  ]);

  return {
    secretCiphertext: ciphertext.toString("hex"),
    secretIv: iv.toString("hex"),
    secretAuthTag: cipher.getAuthTag().toString("hex"),
    secretVersion: SUB_TOKEN_SECRET_VERSION
  };
}

function decryptSubTokenSecret(row) {
  if (
    row?.secret_ciphertext &&
    row?.secret_iv &&
    row?.secret_auth_tag
  ) {
    const key = getSubTokenSecretKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.secret_iv, "hex"));
    decipher.setAuthTag(Buffer.from(row.secret_auth_tag, "hex"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(row.secret_ciphertext, "hex")),
      decipher.final()
    ]);
    return out.toString("utf8");
  }

  if (row?.sub_inner_token) {
    return String(row.sub_inner_token);
  }
  return "";
}

async function upsertSubTokenSecret({ innerTokenId, vaultId, subInnerToken, connection = null }) {
  const encrypted = encryptSubTokenSecret(subInnerToken);
  const sql = `
    INSERT INTO sub_token_secrets
    (inner_token_id, vault_id, sub_inner_token, secret_ciphertext, secret_iv, secret_auth_tag, secret_version, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      sub_inner_token = NULL,
      secret_ciphertext = VALUES(secret_ciphertext),
      secret_iv = VALUES(secret_iv),
      secret_auth_tag = VALUES(secret_auth_tag),
      secret_version = VALUES(secret_version),
      updated_at = NOW()
    `;
  const args = [
    innerTokenId,
    vaultId,
    encrypted.secretCiphertext,
    encrypted.secretIv,
    encrypted.secretAuthTag,
    encrypted.secretVersion
  ];
  if (connection) {
    await connection.execute(sql, args);
    return;
  }
  await query(
    `
    INSERT INTO sub_token_secrets
    (inner_token_id, vault_id, sub_inner_token, secret_ciphertext, secret_iv, secret_auth_tag, secret_version, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      sub_inner_token = NULL,
      secret_ciphertext = VALUES(secret_ciphertext),
      secret_iv = VALUES(secret_iv),
      secret_auth_tag = VALUES(secret_auth_tag),
      secret_version = VALUES(secret_version),
      updated_at = NOW()
    `,
    args
  );
}

let ensureFileCryptoColumnsPromise = null;
async function addColumnIfMissing(tableName, columnName, definitionSql) {
  const rows = await query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  if (rows.length > 0) return;
  await query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

function ensureFileCryptoColumns() {
  if (!ensureFileCryptoColumnsPromise) {
    ensureFileCryptoColumnsPromise = (async () => {
      await addColumnIfMissing("files", "file_auth_tag", "file_auth_tag CHAR(32) NULL AFTER file_key_iv");
      await addColumnIfMissing("files", "file_plain_hash", "file_plain_hash CHAR(64) NULL AFTER file_hmac");
      await addColumnIfMissing("file_key_access", "key_wrap_iv", "key_wrap_iv CHAR(24) NULL AFTER encrypted_file_key");
      await addColumnIfMissing("file_key_access", "key_wrap_tag", "key_wrap_tag CHAR(32) NULL AFTER key_wrap_iv");
      await addColumnIfMissing("file_key_access", "key_wrap_salt", "key_wrap_salt CHAR(32) NULL AFTER key_wrap_tag");
      await addColumnIfMissing("file_key_access", "key_wrap_iterations", "key_wrap_iterations INT NULL AFTER key_wrap_salt");
      await addColumnIfMissing("file_key_access", "key_wrap_version", "key_wrap_version SMALLINT NULL AFTER key_wrap_iterations");
    })().catch((err) => {
      ensureFileCryptoColumnsPromise = null;
      throw err;
    });
  }
  return ensureFileCryptoColumnsPromise;
}

function readFileKeyFromAccessRow(accessRow, providedToken) {
  if (!accessRow?.encrypted_file_key || !accessRow?.key_wrap_iv || !accessRow?.key_wrap_tag || !accessRow?.key_wrap_salt) {
    return null;
  }

  return unwrapFileKeyForToken(accessRow.encrypted_file_key, providedToken, {
    wrapIvHex: accessRow.key_wrap_iv,
    wrapTagHex: accessRow.key_wrap_tag,
    wrapSaltHex: accessRow.key_wrap_salt,
    wrapIterations: accessRow.key_wrap_iterations
  });
}

async function loadMainFileKey(conn, fileId, mainTokenId, mainInnerToken) {
  const [rows] = await conn.execute(
    `
    SELECT encrypted_file_key, key_wrap_iv, key_wrap_tag, key_wrap_salt, key_wrap_iterations
    FROM file_key_access
    WHERE file_id = ? AND inner_token_id = ?
    LIMIT 1
    `,
    [fileId, mainTokenId]
  );
  if (rows.length === 0) {
    throw new Error("Main token access mapping missing for one or more files.");
  }

  const fileKey = readFileKeyFromAccessRow(rows[0], mainInnerToken);
  if (!fileKey) {
    throw new Error("Cannot re-wrap legacy file mapping. Re-upload file to enable cryptographic sub-token wrapping.");
  }
  return fileKey;
}

async function precheckSecurity(req, res, routeKey = "default") {
  const ip = getClientIp(req);
  let captchaSolved = await isCaptchaSolved(ip);

  if (await isBlocked(ip)) {
    const blockedSeconds = await blockedRemainingSeconds(ip);
    if (blockedSeconds > 0) {
      res.set("Retry-After", String(blockedSeconds));
    }
    res.status(429).json(
      securityErrorPayload("Temporarily blocked due to repeated failures.", {
        code: "TEMP_BLOCK",
        blockedSeconds,
        captchaRequired: true
      })
    );
    return { ok: false, ip };
  }

  const risk = await evaluateIpRisk({ routeKey, ip, captchaSolved });
  if (risk.blocked) {
    res.status(403).json(
      securityErrorPayload("Request blocked by risk policy.", {
        code: "RISK_BLOCK",
        captchaRequired: true,
        riskScore: risk.risk.score,
        riskSignals: risk.risk.reasons
      })
    );
    return { ok: false, ip };
  }

  const captchaNeededByFailures = await shouldRequireCaptcha(ip);
  if ((captchaNeededByFailures || risk.requireCaptcha) && !captchaSolved) {
    const challengeId = req.body?.captchaChallengeId || req.query?.captchaChallengeId;
    const captchaAnswer = req.body?.captchaAnswer || req.query?.captchaAnswer;
    const providerToken = req.body?.providerToken || req.body?.captchaToken || req.query?.captchaToken;
    if ((!challengeId || !captchaAnswer) && !providerToken) {
      res.status(403).json(
        securityErrorPayload("Captcha required.", {
          code: "CAPTCHA_REQUIRED",
          captchaRequired: true,
          riskScore: risk.risk.score,
          riskSignals: risk.risk.reasons
        })
      );
      return { ok: false, ip };
    }

    const out = await verifyCaptcha({
      ip,
      challengeId,
      answer: captchaAnswer,
      providerToken
    });
    if (!out.ok) {
      res.status(403).json(
        securityErrorPayload(out.reason, {
          code: "CAPTCHA_INVALID",
          captchaRequired: true,
          retryAfterSeconds: out.retryAfterSeconds || 0
        })
      );
      return { ok: false, ip };
    }

    captchaSolved = true;
  }

  await recordAttempt(ip);
  await recordRouteAttempt(routeKey, ip);
  const rate = await checkRateLimit(ip);
  const routeRate = await checkRouteRateLimit(routeKey, ip);
  if ((rate.overMinute || rate.overDay || routeRate.overMinute || routeRate.overDay) && !captchaSolved) {
    const retryAfter = Math.max(
      rate.resetMinuteSeconds,
      rate.resetDaySeconds,
      routeRate.resetMinuteSeconds,
      routeRate.resetDaySeconds,
      1
    );
    res.set("Retry-After", String(retryAfter));
    res.status(429).json(
      securityErrorPayload("Rate limit exceeded.", {
        code: routeRate.overMinute || routeRate.overDay ? "ROUTE_RATE_LIMIT" : "RATE_LIMIT",
        minuteCount: rate.minuteCount,
        dayCount: rate.dayCount,
        minuteLimit: rate.minuteLimit,
        dayLimit: rate.dayLimit,
        routeMinuteCount: routeRate.minuteCount,
        routeDayCount: routeRate.dayCount,
        routeMinuteLimit: routeRate.minuteLimit,
        routeDayLimit: routeRate.dayLimit,
        retryAfterSeconds: retryAfter,
        captchaRequired: true
      })
    );
    return { ok: false, ip };
  }

  return { ok: true, ip, risk };
}

async function verifyTokenForVault(vaultId, innerToken) {
  const lookupHash = computeTokenLookupHash(innerToken);
  const indexedRows = await query(
    `
    SELECT inner_token_id, token_type, token_hash, salt, key_iterations, token_lookup_hash
    FROM inner_tokens
    WHERE token_lookup_hash = ? AND vault_id = ? AND status = 'ACTIVE'
    `,
    [lookupHash, vaultId]
  );

  for (const tokenRow of indexedRows) {
    const ok = verifyInnerToken(
      innerToken,
      tokenRow.token_hash,
      tokenRow.salt,
      tokenRow.key_iterations
    );
    if (ok) return tokenRow;
  }

  const fallbackRows = await query(
    `
    SELECT inner_token_id, token_type, token_hash, salt, key_iterations, token_lookup_hash
    FROM inner_tokens
    WHERE vault_id = ? AND status = 'ACTIVE'
    `,
    [vaultId]
  );

  for (const tokenRow of fallbackRows) {
    const ok = verifyInnerToken(
      innerToken,
      tokenRow.token_hash,
      tokenRow.salt,
      tokenRow.key_iterations
    );
    if (!ok) continue;

    if (!tokenRow.token_lookup_hash) {
      await query(
        `
        UPDATE inner_tokens
        SET token_lookup_hash = ?
        WHERE inner_token_id = ? AND token_lookup_hash IS NULL
        `,
        [lookupHash, tokenRow.inner_token_id]
      ).catch(() => {});
    }

    return tokenRow;
  }
  return null;
}

router.post("/new-vault-upload", upload.array("files"), async (req, res) => {
  const conn = await getConnection();
  let sec = null;
  let uploadedDriveFiles = [];
  try {
    sec = await precheckSecurity(req, res, "files.new-vault-upload");
    if (!sec.ok) return;
    await ensureRelativePathColumn();
    await ensureFileCryptoColumns();

    const files = req.files || [];
    const relativePaths = getRelativePaths(req.body);
    const { innerToken, expiresInDays = 7 } = req.body;

    if (!validateInnerToken(innerToken)) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({
        error: "Invalid innerToken. It must be 10-20 chars, base62 only."
      });
    }
    if (files.length === 0) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "At least one file is required." });
    }

    const incomingBytes = totalBytes(files);
    if (incomingBytes > MAX_VAULT_SIZE_BYTES) {
      return res.status(413).json({
        error: "Selected upload exceeds max vault size.",
        code: "MAX_VAULT_SIZE_EXCEEDED",
        maxVaultSizeBytes: MAX_VAULT_SIZE_BYTES,
        incomingBytes
      });
    }
    const systemUsageBytes = await getActiveSystemUsageBytes();
    if (systemUsageBytes + incomingBytes > MAX_TOTAL_SYSTEM_SIZE_BYTES) {
      return res.status(413).json({
        error: "System storage limit reached.",
        code: "MAX_SYSTEM_SIZE_EXCEEDED",
        maxSystemSizeBytes: MAX_TOTAL_SYSTEM_SIZE_BYTES,
        currentSystemUsageBytes: systemUsageBytes,
        incomingBytes
      });
    }

    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days < 1 || days > 14) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "expiresInDays must be between 1 and 14." });
    }

    const outerToken = await generateUniqueOuterToken();
    const vaultId = uuidv4();
    const mainTokenId = uuidv4();
    const { tokenHash, salt, iterations } = hashInnerToken(innerToken);
    const tokenLookupHash = computeTokenLookupHash(innerToken);
    uploadedDriveFiles = await mapWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, index) => {
      const validation = await validateUploadFile(file);
      if (!validation.ok) {
        const err = new Error(validation.reason);
        err.statusCode = 400;
        err.code = "FILE_VALIDATION_FAILED";
        throw err;
      }

      const relativePath = normalizeRelativePath(relativePaths[index] || file.originalname);

      const fileKey = generateFileKey();
      const encryptedFile = encryptFileBuffer(file.buffer, fileKey);

      const driveFile = await uploadBuffer({
        buffer: encryptedFile.ciphertext,
        fileName: file.originalname,
        mimeType: validation.normalizedMime || "application/octet-stream",
        relativePath
      });
      return {
        local: file,
        drive: driveFile,
        relativePath,
        crypto: {
          fileKey,
          fileIv: encryptedFile.ivHex,
          fileAuthTag: encryptedFile.authTagHex,
          filePlainHash: buildPlainFileHash(file.buffer)
        }
      };
    });

    await conn.beginTransaction();

    await conn.execute(
      `
      INSERT INTO vaults (vault_id, outer_token, created_at, expires_at, status)
      VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'ACTIVE')
      `,
      [vaultId, outerToken, days]
    );

    await conn.execute(
        `
        INSERT INTO inner_tokens
        (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
        VALUES (?, ?, 'MAIN', ?, ?, ?, ?, NOW(), 'ACTIVE')
        `,
        [mainTokenId, vaultId, tokenHash, tokenLookupHash, salt, iterations]
      );

    const insertedFiles = [];
    for (const item of uploadedDriveFiles) {
      const fileId = uuidv4();
      const storagePath = buildStoragePath(item.drive, item.local.originalname);
      const fileHmac = buildFileHmac(item.local.buffer, `${fileId}:${mainTokenId}`);
      const wrappedMainFileKey = wrapFileKeyForToken(item.crypto.fileKey, innerToken);
      await conn.execute(
        `
        INSERT INTO files
        (file_id, vault_id, drive_file_id, original_filename, mime_type, file_size, storage_path, file_key_iv, file_auth_tag, file_hmac, file_plain_hash, status, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NULL)
        `,
        [
          fileId,
          vaultId,
          item.drive.id,
          item.local.originalname,
          item.local.mimetype || "application/octet-stream",
          item.local.size,
          storagePath,
          item.crypto.fileIv,
          item.crypto.fileAuthTag,
          fileHmac,
          item.crypto.filePlainHash
        ]
      );

      await conn.execute(
        `
        INSERT INTO file_metadata
        (metadata_id, file_id, original_filename, relative_path, mime_type, file_size, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          uuidv4(),
          fileId,
          item.local.originalname,
          item.relativePath,
          item.local.mimetype || "application/octet-stream",
          item.local.size
        ]
      );

      await conn.execute(
        `
        INSERT INTO file_key_access
        (access_id, file_id, inner_token_id, encrypted_file_key, key_wrap_iv, key_wrap_tag, key_wrap_salt, key_wrap_iterations, key_wrap_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          fileId,
          mainTokenId,
          wrappedMainFileKey.wrappedFileKeyHex,
          wrappedMainFileKey.wrapIvHex,
          wrappedMainFileKey.wrapTagHex,
          wrappedMainFileKey.wrapSaltHex,
          wrappedMainFileKey.wrapIterations,
          wrappedMainFileKey.wrapVersion
        ]
      );

      insertedFiles.push({
        fileId,
        name: item.local.originalname,
        size: item.local.size,
        mimeType: item.local.mimetype || "application/octet-stream"
      });
    }

    await conn.commit();

    const expiryRows = await query(
      "SELECT expires_at FROM vaults WHERE vault_id = ?",
      [vaultId]
    );
    const expiresAt = expiryRows[0].expires_at;

    await createPortfolioEntry({
      vaultId,
      ownerTokenId: mainTokenId,
      createdByTokenId: mainTokenId,
      title: "Vault initialized",
      content: `Vault created with ${insertedFiles.length} file(s). Expires at ${new Date(expiresAt).toISOString()}.`
    }).catch(() => {});

    await upsertExpiryJob({ vaultId, expiresAt }).catch(() => {});
    await logAuthAttempt({ req, vaultId, success: true }).catch(() => {});
    await clearFailure(sec.ip);
    return res.status(201).json({
      message: "Vault created and files uploaded.",
      outerToken,
      expiresAt,
      remainingSeconds: getRemainingSeconds(expiresAt),
      uploadedFiles: insertedFiles
    });
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback();
    for (const item of uploadedDriveFiles) {
      if (item?.drive?.id) {
        await deleteFile(item.drive.id).catch(() => {});
      }
    }
    return res.status(500).json({ error: err.message || "Failed to upload to new vault." });
  } finally {
    conn.release();
  }
});

router.post("/:outerToken/upload", upload.array("files"), async (req, res) => {
  const conn = await getConnection();
  let sec = null;
  let uploadedDriveFiles = [];
  try {
    sec = await precheckSecurity(req, res, "files.upload");
    if (!sec.ok) return;
    await ensureRelativePathColumn();
    await ensureFileCryptoColumns();

    const { outerToken } = req.params;
    const { innerToken } = req.body;
    const files = req.files || [];
    const relativePaths = getRelativePaths(req.body);

    if (files.length === 0) return res.status(400).json({ error: "At least one file is required." });
    if (!innerToken) return res.status(400).json({ error: "innerToken is required." });

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Active vault not found for outer token." });
    }

    const verifiedToken = await verifyTokenForVault(vault.vault_id, innerToken);
    if (!verifiedToken) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token.", captchaRequired: await shouldRequireCaptcha(sec.ip) });
    }

    // Only MAIN token can upload more
    if (verifiedToken.token_type !== 'MAIN') {
      return res.status(403).json({ error: "Only the MAIN token can upload additional files." });
    }

    const incomingBytes = totalBytes(files);
    const vaultUsageBytes = await getActiveVaultUsageBytes(vault.vault_id);
    if (vaultUsageBytes + incomingBytes > MAX_VAULT_SIZE_BYTES) {
      return res.status(413).json({
        error: "Vault size limit exceeded.",
        code: "MAX_VAULT_SIZE_EXCEEDED",
        maxVaultSizeBytes: MAX_VAULT_SIZE_BYTES,
        currentVaultUsageBytes: vaultUsageBytes,
        incomingBytes
      });
    }
    const systemUsageBytes = await getActiveSystemUsageBytes();
    if (systemUsageBytes + incomingBytes > MAX_TOTAL_SYSTEM_SIZE_BYTES) {
      return res.status(413).json({
        error: "System storage limit reached.",
        code: "MAX_SYSTEM_SIZE_EXCEEDED",
        maxSystemSizeBytes: MAX_TOTAL_SYSTEM_SIZE_BYTES,
        currentSystemUsageBytes: systemUsageBytes,
        incomingBytes
      });
    }

    uploadedDriveFiles = await mapWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, index) => {
      const validation = await validateUploadFile(file);
      if (!validation.ok) {
        const err = new Error(validation.reason);
        err.statusCode = 400;
        err.code = "FILE_VALIDATION_FAILED";
        throw err;
      }

      const relativePath = normalizeRelativePath(relativePaths[index] || file.originalname);

      const fileKey = generateFileKey();
      const encryptedFile = encryptFileBuffer(file.buffer, fileKey);

      const driveFile = await uploadBuffer({
        buffer: encryptedFile.ciphertext,
        fileName: file.originalname,
        mimeType: validation.normalizedMime || "application/octet-stream",
        relativePath
      });
      return {
        local: file,
        drive: driveFile,
        relativePath,
        crypto: {
          fileKey,
          fileIv: encryptedFile.ivHex,
          fileAuthTag: encryptedFile.authTagHex,
          filePlainHash: buildPlainFileHash(file.buffer)
        }
      };
    });

    await conn.beginTransaction();

    const insertedFiles = [];
    for (const item of uploadedDriveFiles) {
      const fileId = uuidv4();
      const storagePath = buildStoragePath(item.drive, item.local.originalname);
      const fileHmac = buildFileHmac(item.local.buffer, `${fileId}:${verifiedToken.inner_token_id}`);
      const wrappedFileKey = wrapFileKeyForToken(item.crypto.fileKey, innerToken);
      await conn.execute(
        `
        INSERT INTO files
        (file_id, vault_id, drive_file_id, original_filename, mime_type, file_size, storage_path, file_key_iv, file_auth_tag, file_hmac, file_plain_hash, status, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NULL)
        `,
        [
          fileId,
          vault.vault_id,
          item.drive.id,
          item.local.originalname,
          item.local.mimetype || "application/octet-stream",
          item.local.size,
          storagePath,
          item.crypto.fileIv,
          item.crypto.fileAuthTag,
          fileHmac,
          item.crypto.filePlainHash
        ]
      );

      await conn.execute(
        `
        INSERT INTO file_metadata
        (metadata_id, file_id, original_filename, relative_path, mime_type, file_size, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          uuidv4(),
          fileId,
          item.local.originalname,
          item.relativePath,
          item.local.mimetype || "application/octet-stream",
          item.local.size
        ]
      );

      await conn.execute(
        `
        INSERT INTO file_key_access
        (access_id, file_id, inner_token_id, encrypted_file_key, key_wrap_iv, key_wrap_tag, key_wrap_salt, key_wrap_iterations, key_wrap_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          fileId,
          verifiedToken.inner_token_id,
          wrappedFileKey.wrappedFileKeyHex,
          wrappedFileKey.wrapIvHex,
          wrappedFileKey.wrapTagHex,
          wrappedFileKey.wrapSaltHex,
          wrappedFileKey.wrapIterations,
          wrappedFileKey.wrapVersion
        ]
      );

      insertedFiles.push({
        fileId,
        name: item.local.originalname,
        size: item.local.size
      });
    }

    await conn.commit();
    await createPortfolioEntry({
      vaultId: vault.vault_id,
      ownerTokenId: verifiedToken.inner_token_id,
      createdByTokenId: verifiedToken.inner_token_id,
      title: "Vault upload activity",
      content: `${insertedFiles.length} additional file(s) uploaded to the vault.`
    }).catch(() => {});
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    await clearFailure(sec.ip);
    return res.status(201).json({
      message: "Files uploaded.",
      uploadedFiles: insertedFiles
    });
  } catch (err) {
    if (err.code === "FILE_VALIDATION_FAILED" || err.statusCode === 400) {
      await recordFailure(sec?.ip || getClientIp(req));
      for (const item of uploadedDriveFiles) {
        if (item?.drive?.id) {
          await deleteFile(item.drive.id).catch(() => {});
        }
      }
      return res.status(400).json({ error: err.message, code: "FILE_VALIDATION_FAILED" });
    }
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback();
    for (const item of uploadedDriveFiles) {
      if (item?.drive?.id) {
        await deleteFile(item.drive.id).catch(() => {});
      }
    }
    return res.status(500).json({ error: err.message || "Upload failed." });
  } finally {
    conn.release();
  }
});

router.get("/:outerToken/list", async (req, res) => {
  try {
    await ensureRelativePathColumn();
    const { outerToken } = req.params;
    const innerToken = req.query.innerToken;

    if (!innerToken) return res.status(400).json({ error: "innerToken query parameter is required." });

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Active vault not found." });

    const token = await verifyTokenForVault(vault.vault_id, innerToken);
    if (!token) return res.status(401).json({ error: "Invalid inner token." });

    const files = await query(
      `
      SELECT
        f.file_id,
        COALESCE(fm.original_filename, f.original_filename) AS original_filename,
        COALESCE(fm.relative_path, fm.original_filename, f.original_filename) AS relative_path,
        COALESCE(fm.mime_type, f.mime_type) AS mime_type,
        COALESCE(fm.file_size, f.file_size) AS file_size,
        f.created_at
      FROM files f
      LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
      JOIN file_key_access a ON a.file_id = f.file_id
      WHERE f.vault_id = ?
        AND f.status = 'ACTIVE'
        AND a.inner_token_id = ?
      ORDER BY f.created_at DESC
      `,
      [vault.vault_id, token.inner_token_id]
    );

    return res.json({ 
      files, 
      tokenType: token.token_type, 
      expiresAt: vault.expires_at,
      remainingSeconds: getRemainingSeconds(vault.expires_at)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch file list." });
  }
});

router.post("/:outerToken/sub-tokens", async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureSubTokenSecretsTable();
    await ensureRelativePathColumn();
    await ensureFileCryptoColumns();
    const { outerToken } = req.params;
    const { mainInnerToken, subInnerToken, fileIds, forceReassign = false } = req.body;

    if (!mainInnerToken || !subInnerToken || !fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: "mainInnerToken, subInnerToken, and fileIds array are required." });
    }

    if (!validateInnerToken(subInnerToken)) {
      return res.status(400).json({ error: "Invalid subInnerToken format." });
    }

    if (mainInnerToken === subInnerToken) {
      return res.status(400).json({ error: "Sub-token must be different from main token." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== 'MAIN') {
      return res.status(403).json({ error: "Only the main token can create sub-tokens." });
    }

    // Check if sub-token already exists for this vault
    const existing = await query(
      "SELECT inner_token_id FROM inner_tokens WHERE vault_id = ? AND status = 'ACTIVE'",
      [vault.vault_id]
    );
    
    for (const row of existing) {
      const tokenRow = (await query("SELECT token_hash, salt, key_iterations FROM inner_tokens WHERE inner_token_id = ?", [row.inner_token_id]))[0];
      if (verifyInnerToken(subInnerToken, tokenRow.token_hash, tokenRow.salt, tokenRow.key_iterations)) {
        return res.status(409).json({ error: "This sub-token already exists for this vault." });
      }
    }

    const subTokenId = uuidv4();
    const { tokenHash, salt, iterations } = hashInnerToken(subInnerToken);
    const tokenLookupHash = computeTokenLookupHash(subInnerToken);

    await conn.beginTransaction();

    const conflictPlaceholders = fileIds.map(() => "?").join(",");
    const conflicts = fileIds.length
      ? await query(
          `
          SELECT
            a.file_id,
            COALESCE(fm.original_filename, f.original_filename) AS original_filename,
            a.inner_token_id AS current_sub_token_id
          FROM file_key_access a
          JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
          LEFT JOIN files f ON f.file_id = a.file_id
          LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
          WHERE a.file_id IN (${conflictPlaceholders})
            AND t.vault_id = ?
            AND t.token_type = 'SUB'
            AND t.status = 'ACTIVE'
          `,
          [...fileIds, vault.vault_id]
        )
      : [];

    if (conflicts.length > 0 && !forceReassign) {
      await conn.rollback();
      return res.status(409).json({
        error: "Some selected files are already mapped to another SUB token.",
        code: "FILE_ALREADY_SCOPED",
        action: "Reassigning will remove those files from their current SUB token and move them to the new one.",
        conflicts
      });
    }

    await conn.execute(
      `
      INSERT INTO inner_tokens
      (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
      VALUES (?, ?, 'SUB', ?, ?, ?, ?, NOW(), 'ACTIVE')
      `,
      [subTokenId, vault.vault_id, tokenHash, tokenLookupHash, salt, iterations]
    );

    for (const fileId of fileIds) {
      const fileKey = await loadMainFileKey(conn, fileId, mainToken.inner_token_id, mainInnerToken);
      const wrappedSubFileKey = wrapFileKeyForToken(fileKey, subInnerToken);

      // One file can belong to only one active SUB token in this vault.
      await conn.execute(
        `
        DELETE a
        FROM file_key_access a
        JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
        WHERE a.file_id = ?
          AND t.vault_id = ?
          AND t.token_type = 'SUB'
          AND t.status = 'ACTIVE'
        `,
        [fileId, vault.vault_id]
      );

      await conn.execute(
        `
        INSERT INTO file_key_access
        (access_id, file_id, inner_token_id, encrypted_file_key, key_wrap_iv, key_wrap_tag, key_wrap_salt, key_wrap_iterations, key_wrap_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          fileId,
          subTokenId,
          wrappedSubFileKey.wrappedFileKeyHex,
          wrappedSubFileKey.wrapIvHex,
          wrappedSubFileKey.wrapTagHex,
          wrappedSubFileKey.wrapSaltHex,
          wrappedSubFileKey.wrapIterations,
          wrappedSubFileKey.wrapVersion
        ]
      );
    }

    await upsertSubTokenSecret({
      innerTokenId: subTokenId,
      vaultId: vault.vault_id,
      subInnerToken,
      connection: conn
    });

    await conn.commit();
    await createPortfolioEntry({
      vaultId: vault.vault_id,
      ownerTokenId: subTokenId,
      createdByTokenId: mainToken.inner_token_id,
      title: "Sub-token provisioned",
      content: `Scoped SUB token created with ${fileIds.length} mapped file(s).`
    }).catch(() => {});
    return res.status(201).json({
      message: "Sub-token created successfully.",
      subTokenId,
      subInnerToken,
      reassignedConflicts: conflicts.length
    });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message || "Failed to create sub-token." });
  } finally {
    conn.release();
  }
});

router.get("/:outerToken/sub-tokens", async (req, res) => {
  try {
    await ensureSubTokenSecretsTable();
    const { outerToken } = req.params;
    const { mainInnerToken } = req.query;

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== 'MAIN') {
      return res.status(403).json({ error: "Access denied." });
    }

    const subTokens = await query(
      `
      SELECT
        t.inner_token_id,
        t.created_at,
        MAX(CASE WHEN s.secret_ciphertext IS NOT NULL OR s.sub_inner_token IS NOT NULL THEN 1 ELSE 0 END) AS has_secret,
        GROUP_CONCAT(DISTINCT COALESCE(fm.relative_path, fm.original_filename, f.original_filename) SEPARATOR ', ') AS files,
        GROUP_CONCAT(DISTINCT a.file_id SEPARATOR ',') AS file_ids
      FROM inner_tokens t
      LEFT JOIN sub_token_secrets s ON s.inner_token_id = t.inner_token_id
      LEFT JOIN file_key_access a ON t.inner_token_id = a.inner_token_id
      LEFT JOIN files f ON a.file_id = f.file_id
      LEFT JOIN file_metadata fm ON f.file_id = fm.file_id
      WHERE t.vault_id = ? AND t.token_type = 'SUB' AND t.status = 'ACTIVE'
      GROUP BY t.inner_token_id, t.created_at
      `,
      [vault.vault_id]
    );

    return res.json({ subTokens });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to list sub-tokens." });
  }
});

router.put("/:outerToken/sub-tokens/:tokenId/files", async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureFileCryptoColumns();
    const { outerToken, tokenId } = req.params;
    const { mainInnerToken, fileIds } = req.body;

    if (!mainInnerToken || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: "mainInnerToken and fileIds array are required." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== "MAIN") {
      return res.status(403).json({ error: "Access denied." });
    }

    const tokenRows = await query(
      `
      SELECT inner_token_id
      FROM inner_tokens
      WHERE inner_token_id = ? AND vault_id = ? AND token_type = 'SUB' AND status = 'ACTIVE'
      `,
      [tokenId, vault.vault_id]
    );
    if (tokenRows.length === 0) {
      return res.status(404).json({ error: "SUB token not found." });
    }

    const subSecretRows = await query(
      `
      SELECT sub_inner_token, secret_ciphertext, secret_iv, secret_auth_tag
      FROM sub_token_secrets
      WHERE inner_token_id = ? AND vault_id = ?
      LIMIT 1
      `,
      [tokenId, vault.vault_id]
    );
    let subInnerToken = "";
    if (subSecretRows.length > 0) {
      subInnerToken = decryptSubTokenSecret(subSecretRows[0]);
    }
    if (!subInnerToken) {
      return res.status(400).json({ error: "Sub-token secret is unavailable. Set token value before updating file mappings." });
    }

    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => "?").join(",");
      const validFiles = await query(
        `
        SELECT file_id
        FROM files
        WHERE vault_id = ? AND status = 'ACTIVE' AND file_id IN (${placeholders})
        `,
        [vault.vault_id, ...fileIds]
      );
      if (validFiles.length !== fileIds.length) {
        return res.status(400).json({ error: "All files must belong to this vault and be ACTIVE." });
      }
    }

    await conn.beginTransaction();

    await conn.execute("DELETE FROM file_key_access WHERE inner_token_id = ?", [tokenId]);

    for (const fileId of fileIds) {
      const fileKey = await loadMainFileKey(conn, fileId, mainToken.inner_token_id, mainInnerToken);
      const wrappedSubFileKey = wrapFileKeyForToken(fileKey, subInnerToken);

      await conn.execute(
        `
        DELETE a
        FROM file_key_access a
        JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
        WHERE a.file_id = ?
          AND t.vault_id = ?
          AND t.token_type = 'SUB'
          AND t.status = 'ACTIVE'
          AND t.inner_token_id <> ?
        `,
        [fileId, vault.vault_id, tokenId]
      );

      await conn.execute(
        `
        INSERT INTO file_key_access
        (access_id, file_id, inner_token_id, encrypted_file_key, key_wrap_iv, key_wrap_tag, key_wrap_salt, key_wrap_iterations, key_wrap_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          fileId,
          tokenId,
          wrappedSubFileKey.wrappedFileKeyHex,
          wrappedSubFileKey.wrapIvHex,
          wrappedSubFileKey.wrapTagHex,
          wrappedSubFileKey.wrapSaltHex,
          wrappedSubFileKey.wrapIterations,
          wrappedSubFileKey.wrapVersion
        ]
      );
    }

    await conn.commit();
    return res.json({ message: "Sub-token file mapping updated.", mappedFileCount: fileIds.length });
  } catch (err) {
    await conn.rollback();
    return res.status(500).json({ error: err.message || "Failed to update sub-token files." });
  } finally {
    conn.release();
  }
});

router.put("/:outerToken/sub-tokens/:tokenId/secret", async (req, res) => {
  try {
    await ensureSubTokenSecretsTable();
    const { outerToken, tokenId } = req.params;
    const { mainInnerToken, subInnerToken } = req.body;

    if (!mainInnerToken || !subInnerToken) {
      return res.status(400).json({ error: "mainInnerToken and subInnerToken are required." });
    }
    if (!validateInnerToken(subInnerToken)) {
      return res.status(400).json({ error: "Invalid subInnerToken format." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== "MAIN") {
      return res.status(403).json({ error: "Access denied." });
    }

    const subRows = await query(
      `
      SELECT inner_token_id, token_hash, salt, key_iterations
      FROM inner_tokens
      WHERE inner_token_id = ? AND vault_id = ? AND token_type = 'SUB' AND status = 'ACTIVE'
      `,
      [tokenId, vault.vault_id]
    );
    if (subRows.length === 0) {
      return res.status(404).json({ error: "SUB token not found." });
    }

    const subToken = subRows[0];
    const ok = verifyInnerToken(subInnerToken, subToken.token_hash, subToken.salt, subToken.key_iterations);
    if (!ok) {
      return res.status(401).json({ error: "Provided sub token value does not match this token." });
    }

    await upsertSubTokenSecret({
      innerTokenId: tokenId,
      vaultId: vault.vault_id,
      subInnerToken
    });

    return res.json({ message: "Sub-token value stored.", subInnerToken });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to store sub-token value." });
  }
});

router.get("/:outerToken/sub-tokens/:tokenId/reveal", async (req, res) => {
  try {
    await ensureSubTokenSecretsTable();
    const { outerToken, tokenId } = req.params;
    const mainInnerToken = String(req.query?.mainInnerToken || "");

    if (!mainInnerToken) {
      return res.status(400).json({ error: "mainInnerToken is required." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== "MAIN") {
      await appendAuditLog({
        req,
        action: "subtoken.reveal.denied",
        vaultId: vault.vault_id,
        targetTokenId: tokenId,
        reason: "MAIN_REQUIRED",
        severity: "WARNING"
      }).catch(() => {});
      return res.status(403).json({ error: "Access denied." });
    }

    const subRows = await query(
      `
      SELECT inner_token_id
      FROM inner_tokens
      WHERE inner_token_id = ? AND vault_id = ? AND token_type = 'SUB' AND status = 'ACTIVE'
      `,
      [tokenId, vault.vault_id]
    );
    if (subRows.length === 0) {
      return res.status(404).json({ error: "SUB token not found." });
    }

    const secretRows = await query(
      `
      SELECT sub_inner_token, secret_ciphertext, secret_iv, secret_auth_tag
      FROM sub_token_secrets
      WHERE inner_token_id = ? AND vault_id = ?
      LIMIT 1
      `,
      [tokenId, vault.vault_id]
    );

    if (secretRows.length === 0) {
      await appendAuditLog({
        req,
        action: "subtoken.reveal.missing",
        vaultId: vault.vault_id,
        targetTokenId: tokenId,
        actorTokenId: mainToken.inner_token_id,
        severity: "WARNING"
      }).catch(() => {});
      return res.status(404).json({ error: "Sub-token value is unavailable." });
    }

    const subInnerToken = decryptSubTokenSecret(secretRows[0]);
    if (!subInnerToken) {
      await appendAuditLog({
        req,
        action: "subtoken.reveal.failed",
        vaultId: vault.vault_id,
        targetTokenId: tokenId,
        actorTokenId: mainToken.inner_token_id,
        severity: "WARNING"
      }).catch(() => {});
      return res.status(404).json({ error: "Sub-token value is unavailable." });
    }

    await upsertSubTokenSecret({
      innerTokenId: tokenId,
      vaultId: vault.vault_id,
      subInnerToken
    }).catch(() => {});

    await appendAuditLog({
      req,
      action: "subtoken.reveal.success",
      vaultId: vault.vault_id,
      targetTokenId: tokenId,
      actorTokenId: mainToken.inner_token_id,
      severity: "INFO"
    }).catch(() => {});

    return res.json({ subInnerToken });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to reveal sub-token value." });
  }
});

router.delete("/:outerToken/sub-tokens/:tokenId", async (req, res) => {
  try {
    await ensureSubTokenSecretsTable();
    const { outerToken, tokenId } = req.params;
    const { mainInnerToken } = req.body;

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const mainToken = await verifyTokenForVault(vault.vault_id, mainInnerToken);
    if (!mainToken || mainToken.token_type !== 'MAIN') {
      return res.status(403).json({ error: "Access denied." });
    }

    await query(
      "UPDATE inner_tokens SET status = 'REVOKED' WHERE inner_token_id = ? AND vault_id = ?",
      [tokenId, vault.vault_id]
    );
    await query("DELETE FROM sub_token_secrets WHERE inner_token_id = ?", [tokenId]);

    return res.json({ message: "Sub-token revoked." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to revoke sub-token." });
  }
});

router.post("/download-batch", async (req, res) => {
  const conn = await getConnection();
  let sec = null;

  try {
    await ensureFileCryptoColumns();
    sec = await precheckSecurity(req, res, "files.download-batch");
    if (!sec.ok) return;

    const { outerToken, innerToken, fileIds } = req.body || {};
    if (!outerToken || !innerToken) {
      return res.status(400).json({ error: "outerToken and innerToken are required." });
    }
    if (!Array.isArray(fileIds)) {
      return res.status(400).json({ error: "fileIds must be an array." });
    }

    const requestedFileIds = [...new Set(
      fileIds
        .map((id) => String(id || "").trim())
        .filter((id) => id.length > 0)
    )];

    if (requestedFileIds.length === 0) {
      return res.status(400).json({ error: "fileIds must include at least one file id." });
    }

    if (requestedFileIds.length > BATCH_DOWNLOAD_MAX_FILES) {
      return res.status(400).json({
        error: `Too many files requested. Maximum ${BATCH_DOWNLOAD_MAX_FILES} files per batch download.`
      });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Active vault not found." });

    const verifiedToken = await verifyTokenForVault(vault.vault_id, innerToken);
    if (!verifiedToken) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({
        error: "Invalid inner token.",
        captchaRequired: await shouldRequireCaptcha(sec.ip)
      });
    }
    const sessionId = await ensureSession(req).catch(() => null);

    await conn.beginTransaction();

    const placeholders = requestedFileIds.map(() => "?").join(", ");
    const [fileRows] = await conn.execute(
      `
      SELECT
        f.file_id,
        f.drive_file_id,
        COALESCE(fm.original_filename, f.original_filename) AS original_filename,
        COALESCE(fm.mime_type, f.mime_type) AS mime_type,
        f.status,
        f.file_key_iv,
        f.file_auth_tag,
        f.file_plain_hash,
        a.encrypted_file_key,
        a.key_wrap_iv,
        a.key_wrap_tag,
        a.key_wrap_salt,
        a.key_wrap_iterations
      FROM files f
      LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
      JOIN file_key_access a ON a.file_id = f.file_id
      WHERE f.file_id IN (${placeholders})
        AND f.vault_id = ?
        AND a.inner_token_id = ?
      FOR UPDATE
      `,
      [...requestedFileIds, vault.vault_id, verifiedToken.inner_token_id]
    );

    const fileById = new Map(fileRows.map((row) => [String(row.file_id), row]));
    const inaccessibleFileIds = requestedFileIds.filter((fileId) => !fileById.has(fileId));
    if (inaccessibleFileIds.length > 0) {
      await conn.rollback();
      return res.status(404).json({
        error: "One or more files were not found or are not accessible by this token.",
        fileIds: inaccessibleFileIds
      });
    }

    const inactiveFileIds = requestedFileIds.filter((fileId) => fileById.get(fileId)?.status !== "ACTIVE");
    if (inactiveFileIds.length > 0) {
      await conn.rollback();
      return res.status(410).json({
        error: "One or more files are already deleted after prior download.",
        fileIds: inactiveFileIds
      });
    }

    const preparedDownloads = [];
    for (const fileId of requestedFileIds) {
      const dbFile = fileById.get(fileId);
      const encryptedBuffer = await downloadBuffer(dbFile.drive_file_id);

      let responseBuffer = encryptedBuffer;
      const decryptedFileKey = readFileKeyFromAccessRow(dbFile, innerToken);
      if (decryptedFileKey && dbFile.file_key_iv && dbFile.file_auth_tag) {
        responseBuffer = decryptFileBuffer(
          encryptedBuffer,
          decryptedFileKey,
          dbFile.file_key_iv,
          dbFile.file_auth_tag
        );
        if (dbFile.file_plain_hash) {
          const computedHash = buildPlainFileHash(responseBuffer);
          if (computedHash !== dbFile.file_plain_hash) {
            throw new Error("File integrity verification failed.");
          }
        }
      }

      preparedDownloads.push({
        fileId,
        dbFile,
        responseBuffer
      });
    }

    for (const item of preparedDownloads) {
      await conn.execute(
        `
        UPDATE files
        SET status = 'DELETED', deleted_at = NOW()
        WHERE file_id = ?
        `,
        [item.fileId]
      );

      await conn.execute("DELETE FROM file_key_access WHERE file_id = ?", [item.fileId]);

      await conn.execute(
        `
        INSERT INTO download_logs
        (download_id, file_id, inner_token_id, session_id, download_time)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [uuidv4(), item.fileId, verifiedToken.inner_token_id, sessionId]
      );
    }

    await conn.commit();
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    await clearFailure(sec.ip);

    for (const item of preparedDownloads) {
      deleteFile(item.dbFile.drive_file_id).catch(() => {
        // Best-effort cleanup for prototype.
      });
    }

    const archive = new JSZip();
    const usedNames = new Set();
    for (const item of preparedDownloads) {
      const suggested = sanitizeArchiveFilename(item.dbFile.original_filename, `${item.fileId}.bin`);
      const unique = reserveUniqueArchiveName(suggested, usedNames);
      archive.file(unique, item.responseBuffer);
    }

    const zipBuffer = await archive.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="ghostdrop-batch-${stamp}.zip"`);
    return res.send(zipBuffer);
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback().catch(() => {});
    return res.status(500).json({ error: err.message || "Batch download failed." });
  } finally {
    conn.release();
  }
});
router.post("/:fileId/download", async (req, res) => {
  const conn = await getConnection();
  try {
    await ensureFileCryptoColumns();
    const sec = await precheckSecurity(req, res, "files.download");
    if (!sec.ok) return;

    const { fileId } = req.params;
    const { outerToken, innerToken } = req.body;

    if (!outerToken || !innerToken) {
      return res.status(400).json({ error: "outerToken and innerToken are required." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault) return res.status(404).json({ error: "Active vault not found." });

    const verifiedToken = await verifyTokenForVault(vault.vault_id, innerToken);
    if (!verifiedToken) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token.", captchaRequired: await shouldRequireCaptcha(sec.ip) });
    }
    const sessionId = await ensureSession(req).catch(() => null);

    await conn.beginTransaction();

    const [fileRows] = await conn.execute(
      `
      SELECT
        f.file_id,
        f.drive_file_id,
        COALESCE(fm.original_filename, f.original_filename) AS original_filename,
        COALESCE(fm.mime_type, f.mime_type) AS mime_type,
        f.status,
        f.file_key_iv,
        f.file_auth_tag,
        f.file_plain_hash,
        a.encrypted_file_key,
        a.key_wrap_iv,
        a.key_wrap_tag,
        a.key_wrap_salt,
        a.key_wrap_iterations
      FROM files f
      LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
      JOIN file_key_access a ON a.file_id = f.file_id
      WHERE f.file_id = ?
        AND f.vault_id = ?
        AND a.inner_token_id = ?
      FOR UPDATE
      `,
      [fileId, vault.vault_id, verifiedToken.inner_token_id]
    );

    if (fileRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "File not found or access denied." });
    }

    const dbFile = fileRows[0];
    if (dbFile.status !== "ACTIVE") {
      await conn.rollback();
      return res.status(410).json({ error: "File already deleted after prior download." });
    }

    const encryptedBuffer = await downloadBuffer(dbFile.drive_file_id);

    let responseBuffer = encryptedBuffer;
    const decryptedFileKey = readFileKeyFromAccessRow(dbFile, innerToken);
    if (decryptedFileKey && dbFile.file_key_iv && dbFile.file_auth_tag) {
      responseBuffer = decryptFileBuffer(
        encryptedBuffer,
        decryptedFileKey,
        dbFile.file_key_iv,
        dbFile.file_auth_tag
      );
      if (dbFile.file_plain_hash) {
        const computedHash = buildPlainFileHash(responseBuffer);
        if (computedHash !== dbFile.file_plain_hash) {
          throw new Error("File integrity verification failed.");
        }
      }
    }

    await conn.execute(
      `
      UPDATE files
      SET status = 'DELETED', deleted_at = NOW()
      WHERE file_id = ?
      `,
      [fileId]
    );

    await conn.execute("DELETE FROM file_key_access WHERE file_id = ?", [fileId]);

    await conn.execute(
      `
      INSERT INTO download_logs
      (download_id, file_id, inner_token_id, session_id, download_time)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [uuidv4(), fileId, verifiedToken.inner_token_id, sessionId]
    );

    await conn.commit();
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    await clearFailure(sec.ip);

    deleteFile(dbFile.drive_file_id).catch(() => {
      // Best-effort cleanup for prototype.
    });

    res.setHeader("Content-Type", dbFile.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(dbFile.original_filename)}"`
    );
    return res.send(responseBuffer);
  } catch (err) {
    if (err.code === "FILE_VALIDATION_FAILED" || err.statusCode === 400) {
      await recordFailure(sec?.ip || getClientIp(req));
      for (const item of uploadedDriveFiles) {
        if (item?.drive?.id) {
          await deleteFile(item.drive.id).catch(() => {});
        }
      }
      return res.status(400).json({ error: err.message, code: "FILE_VALIDATION_FAILED" });
    }
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback();
    return res.status(500).json({ error: err.message || "Download failed." });
  } finally {
    conn.release();
  }
});

module.exports = router;






