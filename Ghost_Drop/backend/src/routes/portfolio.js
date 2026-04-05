const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { query } = require("../config/db");
const { requireAuth, requireAdmin } = require("../middleware/authSession");
const {
  computeIntegrityHash,
  ensurePortfolioSchema,
  isEntryTampered
} = require("../services/portfolioIntegrity");
const { appendAuditLog } = require("../services/fileAuditLogger");
const {
  checkPrincipalRateLimit,
  recordPrincipalAttempt
} = require("../services/security");

const router = express.Router();

function toClientRow(row) {
  return {
    entryId: row.entry_id,
    vaultId: row.vault_id,
    ownerTokenId: row.owner_token_id,
    createdByTokenId: row.created_by_token_id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function fetchEntry(entryId) {
  const rows = await query(
    `
    SELECT
      entry_id,
      vault_id,
      owner_token_id,
      created_by_token_id,
      title,
      content,
      integrity_hash,
      status,
      created_at,
      updated_at
    FROM portfolio_entries
    WHERE entry_id = ?
    `,
    [entryId]
  );
  return rows[0] || null;
}

function canAccessEntry(session, row) {
  if (!row || row.vault_id !== session.vaultId || row.status !== "ACTIVE") return false;
  if (session.role === "admin") return true;
  return row.owner_token_id === session.innerTokenId;
}

function validatePayloadShape(body, allowedKeys) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  const extras = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  if (extras.length > 0) {
    return `Unexpected fields: ${extras.join(", ")}`;
  }

  return "";
}

async function logTamperedEntry(req, row, action) {
  await appendAuditLog({
    req,
    severity: "CRITICAL",
    action,
    vaultId: row.vault_id,
    entryId: row.entry_id,
    ownerTokenId: row.owner_token_id,
    actorTokenId: req.authSession?.innerTokenId || null
  }).catch(() => {});
}

function portfolioPrincipalKey(session) {
  return `portfolio:${session.vaultId}:${session.innerTokenId}`;
}

router.use(async (req, res, next) => {
  try {
    await ensurePortfolioSchema();
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message || "Portfolio schema initialization failed." });
  }
});

router.use(requireAuth, async (req, res, next) => {
  const principalKey = portfolioPrincipalKey(req.authSession);
  const rate = await checkPrincipalRateLimit(principalKey);
  if (rate.overMinute || rate.overDay) {
    const retryAfter = Math.max(rate.resetMinuteSeconds, rate.resetDaySeconds, 1);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Portfolio rate limit exceeded for this authenticated token.",
      code: "PORTFOLIO_TOKEN_RATE_LIMIT",
      retryAfterSeconds: retryAfter,
      securityAlert: true
    });
  }

  await recordPrincipalAttempt(principalKey);
  return next();
});

router.get("/", async (req, res) => {
  try {
    const params = [req.authSession.vaultId];
    let where = "vault_id = ? AND status = 'ACTIVE'";

    if (req.authSession.role !== "admin") {
      where += " AND owner_token_id = ?";
      params.push(req.authSession.innerTokenId);
    }

    const rows = await query(
      `
      SELECT
        entry_id,
        vault_id,
        owner_token_id,
        created_by_token_id,
        title,
        content,
        integrity_hash,
        status,
        created_at,
        updated_at
      FROM portfolio_entries
      WHERE ${where}
      ORDER BY updated_at DESC
      `,
      params
    );

    const safeRows = [];
    let tamperedCount = 0;

    for (const row of rows) {
      if (isEntryTampered(row)) {
        tamperedCount += 1;
        await logTamperedEntry(req, row, "portfolio.read.blocked_tampered");
        continue;
      }
      safeRows.push(row);
    }

    return res.json({ entries: safeRows.map(toClientRow), tamperedCount });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch portfolio entries." });
  }
});

router.get("/:entryId", async (req, res) => {
  try {
    const row = await fetchEntry(req.params.entryId);
    if (!canAccessEntry(req.authSession, row)) {
      await appendAuditLog({
        req,
        action: "portfolio.read.denied",
        vaultId: req.authSession.vaultId,
        entryId: req.params.entryId,
        role: req.authSession.role
      }).catch(() => {});
      return res.status(404).json({ error: "Portfolio entry not found." });
    }

    if (isEntryTampered(row)) {
      await logTamperedEntry(req, row, "portfolio.read.blocked_tampered");
      return res.status(409).json({
        error: "Portfolio entry integrity check failed.",
        code: "PORTFOLIO_TAMPER_DETECTED",
        securityAlert: true
      });
    }

    return res.json({ entry: toClientRow(row) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to fetch portfolio entry." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const shapeError = validatePayloadShape(req.body, ["title", "content", "ownerTokenId"]);
    if (shapeError) {
      return res.status(400).json({ error: shapeError });
    }

    const { title, content, ownerTokenId } = req.body || {};
    const nextTitle = String(title || "").trim();
    const nextContent = String(content || "").trim();
    if (!nextTitle || !nextContent) {
      return res.status(400).json({ error: "title and content are required." });
    }

    const selectedOwnerTokenId = ownerTokenId || req.authSession.innerTokenId;
    const validOwner = await query(
      `
      SELECT inner_token_id
      FROM inner_tokens
      WHERE inner_token_id = ? AND vault_id = ? AND status = 'ACTIVE'
      `,
      [selectedOwnerTokenId, req.authSession.vaultId]
    );
    if (validOwner.length === 0) {
      return res.status(400).json({ error: "ownerTokenId must belong to this vault." });
    }

    const entryId = uuidv4();
    const integrityHash = computeIntegrityHash({
      vaultId: req.authSession.vaultId,
      ownerTokenId: selectedOwnerTokenId,
      title: nextTitle,
      content: nextContent,
      status: "ACTIVE"
    });

    await query(
      `
      INSERT INTO portfolio_entries
      (entry_id, vault_id, owner_token_id, created_by_token_id, title, content, integrity_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
      `,
      [
        entryId,
        req.authSession.vaultId,
        selectedOwnerTokenId,
        req.authSession.innerTokenId,
        nextTitle,
        nextContent,
        integrityHash
      ]
    );

    await appendAuditLog({
      req,
      action: "portfolio.create",
      vaultId: req.authSession.vaultId,
      entryId,
      ownerTokenId: selectedOwnerTokenId,
      actorTokenId: req.authSession.innerTokenId
    }).catch(() => {});

    const row = await fetchEntry(entryId);
    return res.status(201).json({ entry: toClientRow(row) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to create portfolio entry." });
  }
});

router.put("/:entryId", async (req, res) => {
  try {
    const shapeError = validatePayloadShape(req.body, ["title", "content", "ownerTokenId"]);
    if (shapeError) {
      return res.status(400).json({ error: shapeError });
    }

    const row = await fetchEntry(req.params.entryId);
    if (!canAccessEntry(req.authSession, row)) {
      await appendAuditLog({
        req,
        action: "portfolio.update.denied",
        vaultId: req.authSession.vaultId,
        entryId: req.params.entryId,
        role: req.authSession.role
      }).catch(() => {});
      return res.status(404).json({ error: "Portfolio entry not found." });
    }

    if (isEntryTampered(row)) {
      await logTamperedEntry(req, row, "portfolio.update.blocked_tampered");
      return res.status(409).json({
        error: "Portfolio entry integrity check failed.",
        code: "PORTFOLIO_TAMPER_DETECTED",
        securityAlert: true
      });
    }

    const nextTitle = String(req.body?.title || row.title).trim();
    const nextContent = String(req.body?.content || row.content).trim();
    const nextOwnerTokenId =
      req.authSession.role === "admin" && req.body?.ownerTokenId
        ? String(req.body.ownerTokenId)
        : row.owner_token_id;

    if (!nextTitle || !nextContent) {
      return res.status(400).json({ error: "title and content cannot be empty." });
    }

    if (req.authSession.role === "admin" && nextOwnerTokenId !== row.owner_token_id) {
      const validOwner = await query(
        `
        SELECT inner_token_id
        FROM inner_tokens
        WHERE inner_token_id = ? AND vault_id = ? AND status = 'ACTIVE'
        `,
        [nextOwnerTokenId, req.authSession.vaultId]
      );
      if (validOwner.length === 0) {
        return res.status(400).json({ error: "ownerTokenId must belong to this vault." });
      }
    }

    const integrityHash = computeIntegrityHash({
      vaultId: row.vault_id,
      ownerTokenId: nextOwnerTokenId,
      title: nextTitle,
      content: nextContent,
      status: row.status
    });

    await query(
      `
      UPDATE portfolio_entries
      SET owner_token_id = ?, title = ?, content = ?, integrity_hash = ?, updated_at = NOW()
      WHERE entry_id = ?
      `,
      [nextOwnerTokenId, nextTitle, nextContent, integrityHash, row.entry_id]
    );

    await appendAuditLog({
      req,
      action: "portfolio.update",
      vaultId: req.authSession.vaultId,
      entryId: row.entry_id,
      actorTokenId: req.authSession.innerTokenId,
      ownerTokenId: nextOwnerTokenId
    }).catch(() => {});

    const updated = await fetchEntry(row.entry_id);
    return res.json({ entry: toClientRow(updated) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to update portfolio entry." });
  }
});

router.delete("/:entryId", requireAdmin, async (req, res) => {
  try {
    const row = await fetchEntry(req.params.entryId);
    if (!row || row.vault_id !== req.authSession.vaultId || row.status !== "ACTIVE") {
      return res.status(404).json({ error: "Portfolio entry not found." });
    }

    if (isEntryTampered(row)) {
      await logTamperedEntry(req, row, "portfolio.delete.blocked_tampered");
      return res.status(409).json({
        error: "Portfolio entry integrity check failed.",
        code: "PORTFOLIO_TAMPER_DETECTED",
        securityAlert: true
      });
    }

    const integrityHash = computeIntegrityHash({
      vaultId: row.vault_id,
      ownerTokenId: row.owner_token_id,
      title: row.title,
      content: row.content,
      status: "DELETED"
    });

    await query(
      `
      UPDATE portfolio_entries
      SET status = 'DELETED', integrity_hash = ?, updated_at = NOW()
      WHERE entry_id = ?
      `,
      [integrityHash, row.entry_id]
    );

    await appendAuditLog({
      req,
      action: "portfolio.delete",
      vaultId: req.authSession.vaultId,
      entryId: row.entry_id,
      actorTokenId: req.authSession.innerTokenId
    }).catch(() => {});

    return res.json({ message: "Portfolio entry deleted." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to delete portfolio entry." });
  }
});

module.exports = router;

