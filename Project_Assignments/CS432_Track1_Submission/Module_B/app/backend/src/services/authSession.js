const { v4: uuidv4 } = require("uuid");
const { getRemainingSeconds } = require("./vaultAccess");
const { query } = require("../config/db");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function sessionRole(tokenType) {
  return tokenType === "MAIN" ? "admin" : "user";
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAtMs <= now || session.lastSeenAt + SESSION_TTL_MS <= now) {
      sessions.delete(token);
    }
  }
}

function createSession({ vault, tokenRow, outerToken }) {
  pruneExpiredSessions();
  const sessionToken = uuidv4();
  const expiresAtMs = new Date(vault.expires_at).getTime();

  sessions.set(sessionToken, {
    sessionToken,
    vaultId: vault.vault_id,
    outerToken,
    innerTokenId: tokenRow.inner_token_id,
    tokenType: tokenRow.token_type,
    role: sessionRole(tokenRow.token_type),
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAtMs
  });

  return {
    sessionToken,
    vaultId: vault.vault_id,
    outerToken,
    tokenType: tokenRow.token_type,
    role: sessionRole(tokenRow.token_type),
    expiresAt: vault.expires_at,
    remainingSeconds: getRemainingSeconds(vault.expires_at)
  };
}

function getSession(sessionToken) {
  pruneExpiredSessions();
  if (!sessionToken) return null;
  const session = sessions.get(sessionToken);
  if (!session) return null;
  if (session.expiresAtMs <= Date.now()) {
    sessions.delete(sessionToken);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

function invalidateSession(sessionToken) {
  if (sessionToken) sessions.delete(sessionToken);
}

async function validateSessionAgainstDb(sessionToken) {
  const session = getSession(sessionToken);
  if (!session) return null;

  const rows = await query(
    `
    SELECT
      v.vault_id,
      v.status AS vault_status,
      v.expires_at,
      t.inner_token_id,
      t.token_type,
      t.status AS token_status
    FROM vaults v
    JOIN inner_tokens t ON t.inner_token_id = ?
    WHERE v.vault_id = ?
    `,
    [session.innerTokenId, session.vaultId]
  );

  if (rows.length === 0) {
    invalidateSession(sessionToken);
    return null;
  }

  const row = rows[0];
  const vaultActive = row.vault_status === "ACTIVE" && new Date(row.expires_at) > new Date();
  const tokenActive = row.token_status === "ACTIVE";

  if (!vaultActive || !tokenActive) {
    invalidateSession(sessionToken);
    return null;
  }

  session.tokenType = row.token_type;
  session.role = sessionRole(row.token_type);
  session.expiresAtMs = new Date(row.expires_at).getTime();
  session.lastSeenAt = Date.now();
  return session;
}

function getSessionTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const headerToken = String(req.headers["x-session-token"] || "").trim();
  if (headerToken) return headerToken;

  const queryToken = String(req.query.sessionToken || "").trim();
  if (queryToken) return queryToken;

  return "";
}

module.exports = {
  createSession,
  getSession,
  invalidateSession,
  getSessionTokenFromRequest,
  sessionRole,
  validateSessionAgainstDb
};
