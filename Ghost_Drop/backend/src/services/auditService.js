const { v4: uuidv4 } = require("uuid");
const { query } = require("../config/db");
const { getClientIp } = require("./security");

const sessionByClient = new Map();

function getClientKey(req) {
  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "unknown");
  return `${ip}::${ua}`;
}

async function ensureSession(req) {
  const clientKey = getClientKey(req);
  const ip = getClientIp(req);
  const ua = String(req.headers["user-agent"] || "unknown");

  let sessionId = sessionByClient.get(clientKey);
  if (!sessionId) {
    sessionId = uuidv4();
    await query(
      `
      INSERT INTO sessions (session_id, ip_address, user_agent, created_at, last_activity)
      VALUES (?, ?, ?, NOW(), NOW())
      `,
      [sessionId, ip, ua]
    );
    sessionByClient.set(clientKey, sessionId);
  } else {
    await query(
      `
      UPDATE sessions
      SET last_activity = NOW()
      WHERE session_id = ?
      `,
      [sessionId]
    );
  }

  return sessionId;
}

async function logAuthAttempt({ req, vaultId = null, success }) {
  const sessionId = await ensureSession(req);
  await query(
    `
    INSERT INTO auth_attempts (attempt_id, session_id, vault_id, attempt_time, success)
    VALUES (?, ?, ?, NOW(), ?)
    `,
    [uuidv4(), sessionId, vaultId, success ? 1 : 0]
  );
  return sessionId;
}

async function upsertCaptchaTracking({ req, required, incrementAttempts = true }) {
  const sessionId = await ensureSession(req);
  const row = await query(
    `
    SELECT captcha_id, attempts
    FROM captcha_tracking
    WHERE session_id = ?
    `,
    [sessionId]
  );

  if (row.length === 0) {
    await query(
      `
      INSERT INTO captcha_tracking (captcha_id, session_id, attempts, required, last_attempt)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [uuidv4(), sessionId, incrementAttempts ? 1 : 0, required ? 1 : 0]
    );
    return;
  }

  const attempts = Number(row[0].attempts || 0) + (incrementAttempts ? 1 : 0);
  await query(
    `
    UPDATE captcha_tracking
    SET attempts = ?, required = ?, last_attempt = NOW()
    WHERE session_id = ?
    `,
    [attempts, required ? 1 : 0, sessionId]
  );
}

async function upsertExpiryJob({ vaultId, expiresAt }) {
  const existing = await query(
    `
    SELECT job_id
    FROM expiry_jobs
    WHERE vault_id = ?
    `,
    [vaultId]
  );
  if (existing.length > 0) {
    await query(
      `
      UPDATE expiry_jobs
      SET scheduled_time = ?, processed = 0
      WHERE vault_id = ?
      `,
      [expiresAt, vaultId]
    );
    return;
  }

  await query(
    `
    INSERT INTO expiry_jobs (job_id, vault_id, scheduled_time, processed)
    VALUES (?, ?, ?, 0)
    `,
    [uuidv4(), vaultId, expiresAt]
  );
}

module.exports = {
  ensureSession,
  logAuthAttempt,
  upsertCaptchaTracking,
  upsertExpiryJob
};
