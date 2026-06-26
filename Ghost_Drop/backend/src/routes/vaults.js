const express = require("express");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const { query, getConnection } = require("../config/db");
const {
  generateOuterToken,
  generateInnerToken,
  hashInnerToken,
  computeTokenLookupHash,
  verifyInnerToken,
  isBase62
} = require("../services/crypto");
const {
  recordFailure,
  clearFailure,
  shouldRequireCaptcha,
  isCaptchaSolved
} = require("../services/security");
const securityGate = require("../middleware/securityGate");
const { logAuthAttempt, upsertExpiryJob } = require("../services/auditService");
const { ensureRelativePathColumn } = require("../services/filePathSchema");
const logger = require("../config/logger");

const router = express.Router();


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


async function resolveVault(outerToken) {
  // Bug 15: Reject obviously malformed tokens before hitting the DB
  if (!outerToken || typeof outerToken !== "string" || outerToken.length > 50 || !/^[A-Za-z0-9]+$/.test(outerToken)) {
    return null;
  }
  const rows = await query(
    `
    SELECT vault_id, outer_token, status, created_at, expires_at
    FROM vaults
    WHERE outer_token = ?
    `,
    [outerToken]
  );
  if (rows.length === 0) return null;
  return rows[0];
}


router.post("/", async (req, res) => {
  try {
    const { innerToken, expiresInDays = 7 } = req.body;

    if (!validateInnerToken(innerToken)) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({
        error: "Invalid innerToken. It must be 10-20 chars, base62 only (0-9, A-Z, a-z)."
      });
    }

    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days < 1 || days > 14) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "expiresInDays must be between 1 and 14." });
    }

    const vaultId = uuidv4();
    const outerToken = await generateUniqueOuterToken();
    const mainTokenId = uuidv4();
    // hashInnerToken is now async — await to avoid blocking event loop
    const { tokenHash, salt, iterations } = await hashInnerToken(innerToken);
    const tokenLookupHash = computeTokenLookupHash(innerToken);

    await query(
      `
      INSERT INTO vaults (vault_id, outer_token, created_at, expires_at, status)
      VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'ACTIVE')
      `,
      [vaultId, outerToken, days]
    );

    await query(
      `
      INSERT INTO inner_tokens
      (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
      VALUES (?, ?, 'MAIN', ?, ?, ?, ?, NOW(), 'ACTIVE')
      `,
      [mainTokenId, vaultId, tokenHash, tokenLookupHash, salt, iterations]
    );

    const expiryRows = await query("SELECT expires_at FROM vaults WHERE vault_id = ?", [vaultId]);
    await upsertExpiryJob({ vaultId, expiresAt: expiryRows[0].expires_at }).catch(() => {});
    await logAuthAttempt({ req, vaultId, success: true }).catch(() => {});

    return res.status(201).json({
      message: "Vault created.",
      outerToken,
      expiresInDays: days
    });
  } catch (err) {
    logger.error({ err }, "Failed to create vault");
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    return res.status(500).json({ error: err.message || "Failed to create vault." });
  }
});


router.get("/:outerToken/public-info", securityGate("vault.public-info"), async (req, res) => {
  try {
    const sec = req.securityContext;

    const { outerToken } = req.params;
    const vault = await resolveVault(outerToken);
    if (!vault) {
      // Bug 12: weight:2 for vault enumeration; Bug 7: don't leak captcha status in 404
      await recordFailure(sec.ip, { weight: 2, reason: "VAULT_NOT_FOUND" });
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Vault not found." });
    }

    const activeFiles = await query(
      `
      SELECT COUNT(*) AS active_file_count
      FROM files
      WHERE vault_id = ? AND status = 'ACTIVE'
      `,
      [vault.vault_id]
    );

    const isActive = vault.status === "ACTIVE" && new Date(vault.expires_at) > new Date();
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});

    return res.json({
      outerToken: vault.outer_token,
      status: isActive ? "ACTIVE" : "EXPIRED",
      createdAt: vault.created_at,
      expiresAt: vault.expires_at,
      remainingSeconds: getRemainingSeconds(vault.expires_at),
      activeFileCount: Number(activeFiles[0].active_file_count || 0)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to resolve vault." });
  }
});

router.post("/:outerToken/access", securityGate("vault.access"), async (req, res) => {
  try {
    const sec = req.securityContext;
    await ensureRelativePathColumn();

    const { outerToken } = req.params;
    const { innerToken } = req.body;

    if (!validateInnerToken(innerToken)) {
      return res.status(400).json({ error: "Invalid inner token format.", captchaRequired: await shouldRequireCaptcha(sec.ip) && !await isCaptchaSolved(sec.ip) });
    }

    const vault = await resolveVault(outerToken);
    if (!vault) {
      // Bug 12: weight:2 for vault enumeration; Bug 7: no captcha info leak
      await recordFailure(sec.ip, { weight: 2, reason: "VAULT_NOT_FOUND" });
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Vault not found." });
    }

    const isActive = vault.status === "ACTIVE" && new Date(vault.expires_at) > new Date();
    if (!isActive) {
      await recordFailure(sec.ip, { weight: 1, reason: "VAULT_EXPIRED" });
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(403).json({ error: "Vault expired or inactive." });
    }

    const tokenRows = await query(
      `
      SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
      FROM inner_tokens
      WHERE token_lookup_hash = ? AND vault_id = ? AND status = 'ACTIVE'
      `,
      [computeTokenLookupHash(innerToken), vault.vault_id]
    );

    let matchedToken = null;
    for (const tokenRow of tokenRows) {
      if (
        await verifyInnerToken(innerToken, tokenRow.token_hash, tokenRow.salt, tokenRow.key_iterations)
      ) {
        matchedToken = tokenRow;
        break;
      }
    }

    if (!matchedToken) {
      const fallbackRows = await query(
        `
        SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
        FROM inner_tokens
        WHERE vault_id = ? AND status = 'ACTIVE'
        LIMIT 20
        `,
        [vault.vault_id]
      );

      // Bug 11: Limit fallback iteration to prevent timing oracle with many tokens
      for (const tokenRow of fallbackRows) {
        if (
          await verifyInnerToken(innerToken, tokenRow.token_hash, tokenRow.salt, tokenRow.key_iterations)
        ) {
          matchedToken = tokenRow;
          if (!tokenRow.token_lookup_hash) {
            await query(
              `
              UPDATE inner_tokens
              SET token_lookup_hash = ?
              WHERE inner_token_id = ? AND token_lookup_hash IS NULL
              `,
              [computeTokenLookupHash(innerToken), tokenRow.inner_token_id]
            ).catch(() => {});
          }
          break;
        }
      }
    }

    if (!matchedToken) {
      await recordFailure(sec.ip, { weight: 2, reason: "INVALID_INNER_TOKEN" });
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      const captchaRequired = await shouldRequireCaptcha(sec.ip) && !await isCaptchaSolved(sec.ip);
      return res.status(401).json({ error: "Invalid inner token.", captchaRequired });
    }

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
      [vault.vault_id, matchedToken.inner_token_id]
    );

    await clearFailure(sec.ip);
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});
    return res.json({
      outerToken: vault.outer_token,
      expiresAt: vault.expires_at,
      remainingSeconds: getRemainingSeconds(vault.expires_at),
      tokenType: matchedToken.token_type,
      canCreateSubToken: matchedToken.token_type === "MAIN",
      files
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Access verification failed." });
  }
});

router.post("/:outerToken/sub-tokens", securityGate("vault.subtoken-create"), async (req, res) => {
  const conn = await getConnection();
  try {
    const sec = req.securityContext;

    const { outerToken } = req.params;
    const { mainInnerToken, subInnerToken, fileIds = [] } = req.body;

    if (!validateInnerToken(mainInnerToken)) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "MAIN token must be 10-20 base62 characters." });
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "fileIds must contain at least one file id." });
    }

    const selectedSubInnerToken = subInnerToken || generateInnerToken(12);
    if (!validateInnerToken(selectedSubInnerToken)) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "SUB token must be 10-20 base62 characters." });
    }

    const vaultRows = await resolveVault(outerToken);

    if (!vaultRows) {
      await recordFailure(sec.ip, { weight: 2, reason: "VAULT_NOT_FOUND" });
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Vault not found." });
    }
    const vault = vaultRows;
    if (vault.status !== "ACTIVE" || new Date(vault.expires_at) <= new Date()) {
      await recordFailure(sec.ip, { weight: 1, reason: "VAULT_EXPIRED" });
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(403).json({ error: "Vault expired or inactive." });
    }

    const mainRows = await query(
      `
      SELECT inner_token_id, token_hash, salt, key_iterations
      FROM inner_tokens
      WHERE vault_id = ? AND token_type = 'MAIN' AND status = 'ACTIVE'
      `,
      [vault.vault_id]
    );

    if (mainRows.length === 0) {
      return res.status(500).json({ error: "MAIN token missing for vault." });
    }

    const main = mainRows[0];
    if (!await verifyInnerToken(mainInnerToken, main.token_hash, main.salt, main.key_iterations)) {
      await recordFailure(sec.ip, { weight: 2, reason: "INVALID_MAIN_TOKEN" });
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      const captchaRequired = await shouldRequireCaptcha(sec.ip) && !await isCaptchaSolved(sec.ip);
      return res.status(401).json({ error: "Invalid MAIN token.", captchaRequired });
    }

    const placeholders = fileIds.map(() => "?").join(",");
    const scopedFiles = await conn.execute(
      `
      SELECT file_id
      FROM files
      WHERE vault_id = ?
        AND status = 'ACTIVE'
        AND file_id IN (${placeholders})
      `,
      [vault.vault_id, ...fileIds]
    );
    const validatedFiles = scopedFiles[0];

    if (validatedFiles.length !== fileIds.length) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res
        .status(400)
        .json({ error: "All selected files must belong to this vault and be ACTIVE." });
    }

    await conn.beginTransaction();

    const subTokenId = uuidv4();
    // hashInnerToken is now async
    const { tokenHash, salt, iterations } = await hashInnerToken(selectedSubInnerToken);
    const tokenLookupHash = computeTokenLookupHash(selectedSubInnerToken);
    await conn.execute(
      `
      INSERT INTO inner_tokens
      (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
      VALUES (?, ?, 'SUB', ?, ?, ?, ?, NOW(), 'ACTIVE')
      `,
      [subTokenId, vault.vault_id, tokenHash, tokenLookupHash, salt, iterations]
    );

    for (const file of validatedFiles) {
      await conn.execute(
        `
        INSERT INTO file_key_access (access_id, file_id, inner_token_id)
        VALUES (?, ?, ?)
        `,
        [uuidv4(), file.file_id, subTokenId]
      );
    }

    await conn.commit();
    await clearFailure(sec.ip);
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});

    return res.status(201).json({
      message: "SUB token created.",
      subTokenId,
      subInnerToken: selectedSubInnerToken,
      linkedFileCount: validatedFiles.length
    });
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    await conn.rollback().catch(() => {});
    return res.status(500).json({ error: err.message || "Failed to create SUB token." });
  } finally {
    conn.release();
  }
});

router.get("/:outerToken/qr", async (req, res) => {
  try {
    const { outerToken } = req.params;
    const vault = await resolveVault(outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });

    const dataUrl = await QRCode.toDataURL(outerToken, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 300
    });
    return res.json({ outerToken, qrDataUrl: dataUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to generate QR." });
  }
});

module.exports = router;








