const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { createHash } = require("crypto");
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
  recordAttempt,
  recordFailure,
  clearFailure,
  isBlocked,
  blockedRemainingSeconds,
  shouldRequireCaptcha,
  verifyCaptcha,
  isCaptchaSolved,
  getClientIp
} = require("../services/security");
const {
  ensureSession,
  logAuthAttempt,
  upsertExpiryJob
} = require("../services/auditService");
const { ensureRelativePathColumn } = require("../services/filePathSchema");
const { createPortfolioEntry } = require("../services/portfolioService");
const { appendAuditLog } = require("../services/fileAuditLogger");
const { computeIntegrityHash } = require("../services/portfolioIntegrity");
const {
  buildStoragePath,
  buildFileIv,
  buildFileHmac
} = require("../services/fileSecurityMetadata");
const upload = require("../middleware/upload");

const router = express.Router();

const MB = 1024 * 1024;
const DEFAULT_MAX_VAULT_SIZE_MB = 250;
const DEFAULT_MAX_TOTAL_SYSTEM_SIZE_MB = 14 * 1024; // 14 GB
const DEFAULT_UPLOAD_CONCURRENCY = 4;

function getLimitBytes(envName, defaultMb) {
  const raw = Number(process.env[envName]);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : defaultMb;
  return Math.floor(mb * MB);
}

const MAX_VAULT_SIZE_BYTES = getLimitBytes("MAX_VAULT_SIZE_MB", DEFAULT_MAX_VAULT_SIZE_MB);
const MAX_TOTAL_SYSTEM_SIZE_BYTES = getLimitBytes("MAX_TOTAL_SYSTEM_SIZE_MB", DEFAULT_MAX_TOTAL_SYSTEM_SIZE_MB);
const UPLOAD_CONCURRENCY = Math.max(1, Number(process.env.UPLOAD_CONCURRENCY || DEFAULT_UPLOAD_CONCURRENCY));

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

async function writeLifecycleEntry({
  vaultId,
  ownerTokenId,
  createdByTokenId,
  title,
  content
}) {
  return createPortfolioEntry({
    vaultId,
    ownerTokenId,
    createdByTokenId,
    title,
    content
  }).catch(() => null);
}

async function archivePortfolioEntriesForOwner(conn, vaultId, ownerTokenId) {
  const [rows] = await conn.execute(
    `
    SELECT entry_id, title, content
    FROM portfolio_entries
    WHERE vault_id = ? AND owner_token_id = ? AND status = 'ACTIVE'
    `,
    [vaultId, ownerTokenId]
  );

  for (const row of rows) {
    const integrityHash = computeIntegrityHash({
      vaultId,
      ownerTokenId,
      title: row.title,
      content: row.content,
      status: "DELETED"
    });
    await conn.execute(
      `
      UPDATE portfolio_entries
      SET status = 'DELETED', integrity_hash = ?, updated_at = NOW()
      WHERE entry_id = ?
      `,
      [integrityHash, row.entry_id]
    );
  }

  return rows.length;
}

let ensureSubTokenSecretsTablePromise = null;
function ensureSubTokenSecretsTable() {
  if (!ensureSubTokenSecretsTablePromise) {
    ensureSubTokenSecretsTablePromise = query(`
      CREATE TABLE IF NOT EXISTS sub_token_secrets (
        inner_token_id CHAR(36) PRIMARY KEY,
        vault_id CHAR(36) NOT NULL,
        sub_inner_token VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).catch((err) => {
      ensureSubTokenSecretsTablePromise = null;
      throw err;
    });
  }
  return ensureSubTokenSecretsTablePromise;
}

function precheckSecurity(req, res) {
  const ip = getClientIp(req);
  let captchaSolved = isCaptchaSolved(ip);

  if (isBlocked(ip)) {
    const blockedSeconds = blockedRemainingSeconds(ip);
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

  if (shouldRequireCaptcha(ip) && !captchaSolved) {
    const challengeId = req.body?.captchaChallengeId || req.query?.captchaChallengeId;
    const captchaAnswer = req.body?.captchaAnswer || req.query?.captchaAnswer;
    if (!challengeId || !captchaAnswer) {
      res.status(403).json(
        securityErrorPayload("Captcha required.", {
          code: "CAPTCHA_REQUIRED",
          captchaRequired: true
        })
      );
      return { ok: false, ip };
    }

    const out = verifyCaptcha({
      ip,
      challengeId,
      answer: captchaAnswer
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

  recordAttempt(ip);
  const rate = checkRateLimit(ip);
  if ((rate.overMinute || rate.overDay) && !captchaSolved) {
    const retryAfter = Math.max(rate.resetMinuteSeconds, rate.resetDaySeconds, 1);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json(
      securityErrorPayload("Rate limit exceeded.", {
        code: "RATE_LIMIT",
        minuteCount: rate.minuteCount,
        dayCount: rate.dayCount,
        minuteLimit: rate.minuteLimit,
        dayLimit: rate.dayLimit,
        retryAfterSeconds: retryAfter,
        captchaRequired: true
      })
    );
    return { ok: false, ip };
  }

  return { ok: true, ip };
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
    sec = precheckSecurity(req, res);
    if (!sec.ok) return;
    await ensureRelativePathColumn();

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

      const driveFile = await uploadBuffer({
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: validation.normalizedMime || "application/octet-stream",
        relativePath
      });
      return {
        local: file,
        drive: driveFile,
        relativePath
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
      const fileIv = buildFileIv();
      const fileHmac = buildFileHmac(item.local.buffer, `${fileId}:${mainTokenId}`);
      await conn.execute(
        `
        INSERT INTO files
        (file_id, vault_id, drive_file_id, original_filename, mime_type, file_size, storage_path, file_key_iv, file_hmac, status, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NULL)
        `,
        [
          fileId,
          vaultId,
          item.drive.id,
          item.local.originalname,
          item.local.mimetype || "application/octet-stream",
          item.local.size,
          storagePath,
          fileIv,
          fileHmac
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

      const encryptedFileKey = createHash("sha256")
        .update(`${fileId}:${mainTokenId}:${item.drive.id}`)
        .digest("hex");

      await conn.execute(
        `
        INSERT INTO file_key_access (access_id, file_id, inner_token_id, encrypted_file_key)
        VALUES (?, ?, ?, ?)
        `,
        [uuidv4(), fileId, mainTokenId, encryptedFileKey]
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

    await writeLifecycleEntry({
      vaultId,
      ownerTokenId: mainTokenId,
      createdByTokenId: mainTokenId,
      title: "Vault initialized",
      content: `Vault created with ${insertedFiles.length} file(s). Expires at ${new Date(expiresAt).toISOString()}.`
    });

    await appendAuditLog({
      req,
      action: "vault.create",
      vaultId,
      actorTokenId: mainTokenId,
      fileCount: insertedFiles.length,
      expiresAt
    }).catch(() => {});

    await upsertExpiryJob({ vaultId, expiresAt }).catch(() => {});
    await logAuthAttempt({ req, vaultId, success: true }).catch(() => {});
    clearFailure(sec.ip);
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
    sec = precheckSecurity(req, res);
    if (!sec.ok) return;
    await ensureRelativePathColumn();

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
      recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token.", captchaRequired: shouldRequireCaptcha(sec.ip) });
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

      const driveFile = await uploadBuffer({
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: validation.normalizedMime || "application/octet-stream",
        relativePath
      });
      return {
        local: file,
        drive: driveFile,
        relativePath
      };
    });

    await conn.beginTransaction();

    const insertedFiles = [];
    for (const item of uploadedDriveFiles) {
      const fileId = uuidv4();
      const storagePath = buildStoragePath(item.drive, item.local.originalname);
      const fileIv = buildFileIv();
      const fileHmac = buildFileHmac(item.local.buffer, `${fileId}:${verifiedToken.inner_token_id}`);
      await conn.execute(
        `
        INSERT INTO files
        (file_id, vault_id, drive_file_id, original_filename, mime_type, file_size, storage_path, file_key_iv, file_hmac, status, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NULL)
        `,
        [
          fileId,
          vault.vault_id,
          item.drive.id,
          item.local.originalname,
          item.local.mimetype || "application/octet-stream",
          item.local.size,
          storagePath,
          fileIv,
          fileHmac
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

      const encryptedFileKey = createHash("sha256")
        .update(`${fileId}:${verifiedToken.inner_token_id}:${item.drive.id}`)
        .digest("hex");

      await conn.execute(
        `
        INSERT INTO file_key_access (access_id, file_id, inner_token_id, encrypted_file_key)
        VALUES (?, ?, ?, ?)
        `,
        [uuidv4(), fileId, verifiedToken.inner_token_id, encryptedFileKey]
      );

      insertedFiles.push({
        fileId,
        name: item.local.originalname,
        size: item.local.size
      });
    }

    await conn.commit();
    await writeLifecycleEntry({
      vaultId: vault.vault_id,
      ownerTokenId: verifiedToken.inner_token_id,
      createdByTokenId: verifiedToken.inner_token_id,
      title: "Vault upload activity",
      content: `${insertedFiles.length} additional file(s) uploaded to the vault.`
    });
    await appendAuditLog({
      req,
      action: "vault.upload_more",
      vaultId: vault.vault_id,
      actorTokenId: verifiedToken.inner_token_id,
      fileCount: insertedFiles.length
    }).catch(() => {});
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    clearFailure(sec.ip);
    return res.status(201).json({
      message: "Files uploaded.",
      uploadedFiles: insertedFiles
    });
  } catch (err) {
    if (err.code === "FILE_VALIDATION_FAILED" || err.statusCode === 400) {
      recordFailure(sec?.ip || getClientIp(req));
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
            a.inner_token_id AS current_sub_token_id,
            s.sub_inner_token AS current_sub_inner_token
          FROM file_key_access a
          JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
          LEFT JOIN files f ON f.file_id = a.file_id
          LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
          LEFT JOIN sub_token_secrets s ON s.inner_token_id = a.inner_token_id
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
      const encryptedFileKey = createHash("sha256")
        .update(`${fileId}:${subTokenId}:sub-access`)
        .digest("hex");

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
        INSERT INTO file_key_access (access_id, file_id, inner_token_id, encrypted_file_key)
        VALUES (?, ?, ?, ?)
        `,
        [uuidv4(), fileId, subTokenId, encryptedFileKey]
      );
    }

    await conn.execute(
      `
      INSERT INTO sub_token_secrets (inner_token_id, vault_id, sub_inner_token)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE sub_inner_token = VALUES(sub_inner_token)
      `,
      [subTokenId, vault.vault_id, subInnerToken]
    );

    await conn.commit();
    await writeLifecycleEntry({
      vaultId: vault.vault_id,
      ownerTokenId: subTokenId,
      createdByTokenId: mainToken.inner_token_id,
      title: "Member access granted",
      content: `SUB member created with ${fileIds.length} mapped file(s). ${conflicts.length} prior mapping(s) were reassigned.`
    });
    await appendAuditLog({
      req,
      action: "member.create",
      vaultId: vault.vault_id,
      actorTokenId: mainToken.inner_token_id,
      ownerTokenId: subTokenId,
      fileCount: fileIds.length,
      reassignedConflicts: conflicts.length
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
        s.sub_inner_token,
        GROUP_CONCAT(DISTINCT COALESCE(fm.relative_path, fm.original_filename, f.original_filename) SEPARATOR ', ') AS files,
        GROUP_CONCAT(DISTINCT a.file_id SEPARATOR ',') AS file_ids
      FROM inner_tokens t
      LEFT JOIN sub_token_secrets s ON s.inner_token_id = t.inner_token_id
      LEFT JOIN file_key_access a ON t.inner_token_id = a.inner_token_id
      LEFT JOIN files f ON a.file_id = f.file_id
      LEFT JOIN file_metadata fm ON f.file_id = fm.file_id
      WHERE t.vault_id = ? AND t.token_type = 'SUB' AND t.status = 'ACTIVE'
      GROUP BY t.inner_token_id, s.sub_inner_token, t.created_at
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

    const previousMappings = await query(
      "SELECT COUNT(*) AS total FROM file_key_access WHERE inner_token_id = ?",
      [tokenId]
    );
    const previousMappedFileCount = Number(previousMappings[0]?.total || 0);

    await conn.beginTransaction();

    await conn.execute("DELETE FROM file_key_access WHERE inner_token_id = ?", [tokenId]);

    for (const fileId of fileIds) {
      const encryptedFileKey = createHash("sha256")
        .update(`${fileId}:${tokenId}:sub-access`)
        .digest("hex");

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
        INSERT INTO file_key_access (access_id, file_id, inner_token_id, encrypted_file_key)
        VALUES (?, ?, ?, ?)
        `,
        [uuidv4(), fileId, tokenId, encryptedFileKey]
      );
    }

    await conn.commit();
    await writeLifecycleEntry({
      vaultId: vault.vault_id,
      ownerTokenId: tokenId,
      createdByTokenId: mainToken.inner_token_id,
      title: "Member scope updated",
      content: `SUB member file mapping changed from ${previousMappedFileCount} file(s) to ${fileIds.length} file(s).`
    });
    await appendAuditLog({
      req,
      action: "member.scope.update",
      vaultId: vault.vault_id,
      actorTokenId: mainToken.inner_token_id,
      ownerTokenId: tokenId,
      previousMappedFileCount,
      mappedFileCount: fileIds.length
    }).catch(() => {});
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

    await query(
      `
      INSERT INTO sub_token_secrets (inner_token_id, vault_id, sub_inner_token)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE sub_inner_token = VALUES(sub_inner_token)
      `,
      [tokenId, vault.vault_id, subInnerToken]
    );

    await appendAuditLog({
      req,
      action: "member.secret.store",
      vaultId: vault.vault_id,
      actorTokenId: mainToken.inner_token_id,
      ownerTokenId: tokenId
    }).catch(() => {});

    return res.json({ message: "Sub-token value stored.", subInnerToken });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to store sub-token value." });
  }
});

router.delete("/:outerToken/sub-tokens/:tokenId", async (req, res) => {
  const conn = await getConnection();
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

    await conn.beginTransaction();

    const [mappingRows] = await conn.execute(
      "SELECT COUNT(*) AS total FROM file_key_access WHERE inner_token_id = ?",
      [tokenId]
    );
    const cleanedFileMappings = Number(mappingRows[0]?.total || 0);

    await conn.execute("DELETE FROM file_key_access WHERE inner_token_id = ?", [tokenId]);
    await conn.execute(
      "UPDATE inner_tokens SET status = 'REVOKED' WHERE inner_token_id = ? AND vault_id = ?",
      [tokenId, vault.vault_id]
    );
    await conn.execute("DELETE FROM sub_token_secrets WHERE inner_token_id = ?", [tokenId]);

    const archivedPortfolioEntries = await archivePortfolioEntriesForOwner(
      conn,
      vault.vault_id,
      tokenId
    );

    await conn.commit();

    await writeLifecycleEntry({
      vaultId: vault.vault_id,
      ownerTokenId: mainToken.inner_token_id,
      createdByTokenId: mainToken.inner_token_id,
      title: "Member revoked",
      content: `SUB member ${tokenId} revoked. ${cleanedFileMappings} file mapping(s) removed and ${archivedPortfolioEntries} member-owned portfolio entr${archivedPortfolioEntries === 1 ? "y was" : "ies were"} archived.`
    });
    await appendAuditLog({
      req,
      action: "member.revoke",
      vaultId: vault.vault_id,
      actorTokenId: mainToken.inner_token_id,
      ownerTokenId: tokenId,
      cleanedFileMappings,
      archivedPortfolioEntries
    }).catch(() => {});

    return res.json({
      message: "Sub-token revoked.",
      cleanedFileMappings,
      archivedPortfolioEntries
    });
  } catch (err) {
    await conn.rollback().catch(() => {});
    return res.status(500).json({ error: err.message || "Failed to revoke sub-token." });
  } finally {
    conn.release();
  }
});

router.post("/:fileId/download", async (req, res) => {
  const conn = await getConnection();
  try {
    const sec = precheckSecurity(req, res);
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
      recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token.", captchaRequired: shouldRequireCaptcha(sec.ip) });
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
        f.status
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

    const fileBuffer = await downloadBuffer(dbFile.drive_file_id);

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
    await appendAuditLog({
      req,
      action: "file.download.consume",
      vaultId: vault.vault_id,
      actorTokenId: verifiedToken.inner_token_id,
      fileId,
      sessionId
    }).catch(() => {});
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    clearFailure(sec.ip);

    deleteFile(dbFile.drive_file_id).catch(() => {
      // Best-effort cleanup for prototype.
    });

    res.setHeader("Content-Type", dbFile.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(dbFile.original_filename)}"`
    );
    return res.send(fileBuffer);
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback();
    return res.status(500).json({ error: err.message || "Download failed." });
  } finally {
    conn.release();
  }
});

module.exports = router;
