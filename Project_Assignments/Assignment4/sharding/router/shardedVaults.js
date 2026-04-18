// =============================================================================
// GhostDrop · Assignment 4 · Sharded Vault Routes
// sharding/router/shardedVaults.js
//
// Drop-in replacement for Ghost_Drop/backend/src/routes/vaults.js
// that routes all DB operations through the shard layer.
//
// Key changes vs original:
//  • query()       → queryOnShard(shard, …)
//  • getConnection()→ getConnectionOnShard(shard, …)
//  • vault lookup by outer_token → getVaultByOuterToken() (scatter)
//  • vault creation → createVaultTransaction() (single-shard tx)
//  • sub-token creation → createSubTokenTransaction()
// =============================================================================

"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const QRCode  = require("qrcode");

// ── Shard layer ───────────────────────────────────────────────────────────────
const {
  getVaultByOuterToken,
  getVaultById,
  getInnerTokensByVault,
  getAllInnerTokensByVault,
  getFilesByVaultAndToken,
  countActiveFilesByVault,
  createVaultTransaction,
  createSubTokenTransaction,
  updateTokenLookupHash,
  upsertExpiryJob,
  getVaultExpiresAt,
} = require("./shardRouter");

const { getShardIndex } = require("../config/shardConfig");

// ── Existing services (unchanged) ────────────────────────────────────────────
const {
  generateOuterToken, generateInnerToken,
  hashInnerToken, computeTokenLookupHash,
  verifyInnerToken, isBase62,
} = require("../../Ghost_Drop/backend/src/services/crypto");

const {
  checkRateLimit, checkRouteRateLimit,
  recordAttempt, recordFailure, recordRouteAttempt,
  clearFailure, isBlocked, blockedRemainingSeconds,
  shouldRequireCaptcha, verifyCaptcha, isCaptchaSolved,
  getClientIp, evaluateIpRisk,
} = require("../../Ghost_Drop/backend/src/services/security");

const { logAuthAttempt } = require("../../Ghost_Drop/backend/src/services/auditService");
const { ensureRelativePathColumn } = require("../../Ghost_Drop/backend/src/services/filePathSchema");

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
function validateInnerToken(t) {
  return typeof t === "string" && t.length >= 10 && t.length <= 20 && isBase62(t);
}

function getRemainingSeconds(expiresAt) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

async function generateUniqueOuterToken(maxAttempts = 8) {
  for (let i = 0; i < maxAttempts; i++) {
    const token = generateOuterToken();
    // Check ALL shards (outer_token scatter lookup)
    const existing = await getVaultByOuterToken(token);
    if (!existing) return token;
  }
  throw new Error("Unable to generate unique outer token.");
}

async function precheckSecurity(req, res, routeKey = "default") {
  const ip = getClientIp(req);
  let captchaSolved = await isCaptchaSolved(ip);

  if (await isBlocked(ip)) {
    const blockedSeconds = await blockedRemainingSeconds(ip);
    if (blockedSeconds > 0) res.set("Retry-After", String(blockedSeconds));
    res.status(429).json({ error: "Temporarily blocked.", code: "TEMP_BLOCK", blockedSeconds, captchaRequired: true });
    return { ok: false, ip };
  }

  const risk = await evaluateIpRisk({ routeKey, ip, captchaSolved });
  if (risk.blocked) {
    res.status(403).json({ error: "Request blocked by risk policy.", code: "RISK_BLOCK", captchaRequired: true });
    return { ok: false, ip };
  }

  const captchaNeeded = await shouldRequireCaptcha(ip);
  if ((captchaNeeded || risk.requireCaptcha) && !captchaSolved) {
    const challengeId   = req.body?.captchaChallengeId || req.query?.captchaChallengeId;
    const captchaAnswer = req.body?.captchaAnswer      || req.query?.captchaAnswer;
    const providerToken = req.body?.providerToken      || req.body?.captchaToken || req.query?.captchaToken;

    if ((!challengeId || !captchaAnswer) && !providerToken) {
      res.status(403).json({ error: "Captcha required.", code: "CAPTCHA_REQUIRED", captchaRequired: true });
      return { ok: false, ip };
    }
    const out = await verifyCaptcha({ ip, challengeId, answer: captchaAnswer, providerToken });
    if (!out.ok) {
      res.status(403).json({ error: out.reason, code: "CAPTCHA_INVALID", captchaRequired: true });
      return { ok: false, ip };
    }
    captchaSolved = true;
  }

  await recordAttempt(ip);
  await recordRouteAttempt(routeKey, ip);

  const rate      = await checkRateLimit(ip);
  const routeRate = await checkRouteRateLimit(routeKey, ip);
  if ((rate.overMinute || rate.overDay || routeRate.overMinute || routeRate.overDay) && !captchaSolved) {
    const retryAfter = Math.max(rate.resetMinuteSeconds, rate.resetDaySeconds,
      routeRate.resetMinuteSeconds, routeRate.resetDaySeconds, 1);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Rate limit exceeded.", code: "RATE_LIMIT", retryAfterSeconds: retryAfter, captchaRequired: true });
    return { ok: false, ip };
  }

  return { ok: true, ip, risk };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vaults  — Create vault
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { innerToken, expiresInDays = 7 } = req.body;

    if (!validateInnerToken(innerToken)) {
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(400).json({ error: "Invalid innerToken. Must be 10-20 chars, base62." });
    }

    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days < 1 || days > 14) {
      return res.status(400).json({ error: "expiresInDays must be 1–14." });
    }

    const vaultId       = uuidv4();
    const outerToken    = await generateUniqueOuterToken();
    const mainTokenId   = uuidv4();
    const { tokenHash, salt, iterations } = hashInnerToken(innerToken);
    const tokenLookupHash = computeTokenLookupHash(innerToken);

    // ── SHARD ROUTING: vault_id determines target shard ──────────────────────
    const shard = await createVaultTransaction({
      vaultId, outerToken, expiresInDays: days,
      innerTokenId: mainTokenId, tokenHash, salt,
      keyIterations: iterations, tokenLookupHash,
    });

    // Expiry job — goes to same shard as the vault
    const expiresAt = await getVaultExpiresAt(vaultId);
    await upsertExpiryJob({ vaultId, expiresAt, jobId: uuidv4() }).catch(() => {});
    await logAuthAttempt({ req, vaultId, success: true }).catch(() => {});

    return res.status(201).json({
      message: "Vault created.",
      outerToken,
      expiresInDays: days,
      _shard: shard.name,         // included for demo visibility
      _shardIndex: shard.id,
    });
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    return res.status(500).json({ error: err.message || "Failed to create vault." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vaults/:outerToken/public-info
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:outerToken/public-info", async (req, res) => {
  try {
    const sec = await precheckSecurity(req, res, "vault.public-info");
    if (!sec.ok) return;

    const { outerToken } = req.params;

    // ── SHARD ROUTING: outer_token → scatter + take first hit ────────────────
    const vault = await getVaultByOuterToken(outerToken);
    if (!vault) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Vault not found." });
    }

    const activeFileCount = await countActiveFilesByVault(vault.vault_id);
    const isActive = vault.status === "ACTIVE" && new Date(vault.expires_at) > new Date();
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});

    return res.json({
      outerToken: vault.outer_token,
      status: isActive ? "ACTIVE" : "EXPIRED",
      createdAt: vault.created_at,
      expiresAt: vault.expires_at,
      remainingSeconds: getRemainingSeconds(vault.expires_at),
      activeFileCount,
      _shard: `shard_${getShardIndex(vault.vault_id)}`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to resolve vault." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vaults/:outerToken/access
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:outerToken/access", async (req, res) => {
  try {
    const sec = await precheckSecurity(req, res, "vault.access");
    if (!sec.ok) return;
    await ensureRelativePathColumn();

    const { outerToken } = req.params;
    const { innerToken } = req.body;

    if (!validateInnerToken(innerToken)) {
      return res.status(400).json({ error: "Invalid inner token format." });
    }

    // ── outer_token scatter → get vault + owning shard ───────────────────────
    const vault = await getVaultByOuterToken(outerToken);
    if (!vault) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
      return res.status(404).json({ error: "Vault not found." });
    }

    const isActive = vault.status === "ACTIVE" && new Date(vault.expires_at) > new Date();
    if (!isActive) {
      await recordFailure(sec.ip);
      return res.status(403).json({ error: "Vault expired or inactive." });
    }

    // ── Now vault_id is known → all subsequent queries hit ONE shard ──────────
    const lookupHash = computeTokenLookupHash(innerToken);
    let tokenRows = await getInnerTokensByVault(vault.vault_id, lookupHash);

    let matchedToken = null;
    for (const row of tokenRows) {
      if (verifyInnerToken(innerToken, row.token_hash, row.salt, row.key_iterations)) {
        matchedToken = row;
        break;
      }
    }

    // Fallback: full vault scan (handles pre-index rows)
    if (!matchedToken) {
      const allRows = await getAllInnerTokensByVault(vault.vault_id);
      for (const row of allRows) {
        if (verifyInnerToken(innerToken, row.token_hash, row.salt, row.key_iterations)) {
          matchedToken = row;
          if (!row.token_lookup_hash) {
            await updateTokenLookupHash(vault.vault_id, row.inner_token_id, lookupHash).catch(() => {});
          }
          break;
        }
      }
    }

    if (!matchedToken) {
      await recordFailure(sec.ip);
      await logAuthAttempt({ req, vaultId: vault.vault_id, success: false }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token." });
    }

    const files = await getFilesByVaultAndToken(vault.vault_id, matchedToken.inner_token_id);

    await clearFailure(sec.ip);
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});

    return res.json({
      outerToken: vault.outer_token,
      expiresAt: vault.expires_at,
      remainingSeconds: getRemainingSeconds(vault.expires_at),
      tokenType: matchedToken.token_type,
      canCreateSubToken: matchedToken.token_type === "MAIN",
      files,
      _shard: `shard_${getShardIndex(vault.vault_id)}`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Access verification failed." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vaults/:outerToken/sub-tokens
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:outerToken/sub-tokens", async (req, res) => {
  try {
    const sec = await precheckSecurity(req, res, "vault.subtoken-create");
    if (!sec.ok) return;

    const { outerToken } = req.params;
    const { mainInnerToken, subInnerToken, fileIds = [] } = req.body;

    if (!validateInnerToken(mainInnerToken)) {
      return res.status(400).json({ error: "MAIN token must be 10-20 base62 chars." });
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: "fileIds must contain at least one file id." });
    }

    const selectedSub = subInnerToken || generateInnerToken(12);
    if (!validateInnerToken(selectedSub)) {
      return res.status(400).json({ error: "SUB token must be 10-20 base62 chars." });
    }

    const vault = await getVaultByOuterToken(outerToken);
    if (!vault) {
      await recordFailure(sec.ip);
      return res.status(404).json({ error: "Vault not found." });
    }
    if (vault.status !== "ACTIVE" || new Date(vault.expires_at) <= new Date()) {
      await recordFailure(sec.ip);
      return res.status(403).json({ error: "Vault expired or inactive." });
    }

    // Verify MAIN token — single shard
    const mainRows = await getAllInnerTokensByVault(vault.vault_id);
    const mainRow  = mainRows.find(
      (r) => r.token_type === "MAIN" && verifyInnerToken(mainInnerToken, r.token_hash, r.salt, r.key_iterations)
    );
    if (!mainRow) {
      await recordFailure(sec.ip);
      return res.status(401).json({ error: "Invalid MAIN token." });
    }

    // Validate file ownership — all files must belong to this vault + be ACTIVE
    // This query runs on ONE shard (the vault's shard)
    const { queryOnShard: qos, getShard } = require("../config/shardConfig");
    const shard = getShard(vault.vault_id);
    const placeholders = fileIds.map(() => "?").join(",");
    const [validatedRows] = await shard.pool.execute(
      `SELECT file_id FROM files WHERE vault_id = ? AND status = 'ACTIVE' AND file_id IN (${placeholders})`,
      [vault.vault_id, ...fileIds]
    );

    if (validatedRows.length !== fileIds.length) {
      await recordFailure(sec.ip);
      return res.status(400).json({ error: "All files must belong to this vault and be ACTIVE." });
    }

    const subTokenId  = uuidv4();
    const { tokenHash, salt, iterations } = hashInnerToken(selectedSub);
    const tokenLookupHash = computeTokenLookupHash(selectedSub);

    await createSubTokenTransaction({
      vaultId: vault.vault_id,
      subTokenId,
      tokenHash, salt, keyIterations: iterations, tokenLookupHash,
      fileIds: validatedRows.map((r) => ({ accessId: uuidv4(), fileId: r.file_id })),
    });

    await clearFailure(sec.ip);
    await logAuthAttempt({ req, vaultId: vault.vault_id, success: true }).catch(() => {});

    return res.status(201).json({
      message: "SUB token created.",
      subTokenId,
      subInnerToken: selectedSub,
      linkedFileCount: validatedRows.length,
      _shard: `shard_${shard.id}`,
    });
  } catch (err) {
    await logAuthAttempt({ req, vaultId: null, success: false }).catch(() => {});
    return res.status(500).json({ error: err.message || "Failed to create SUB token." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vaults/:outerToken/qr
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:outerToken/qr", async (req, res) => {
  try {
    const vault = await getVaultByOuterToken(req.params.outerToken);
    if (!vault) return res.status(404).json({ error: "Vault not found." });
    const dataUrl = await QRCode.toDataURL(req.params.outerToken, { errorCorrectionLevel: "M", margin: 1, width: 300 });
    return res.json({ outerToken: vault.outer_token, qrDataUrl: dataUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to generate QR." });
  }
});

module.exports = router;
