const { v4: uuidv4 } = require("uuid");
const { query } = require("../config/db");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

let ensureAuthSessionsTablePromise = null;

function sessionRole(tokenType) {
  return tokenType === "MAIN" ? "admin" : "user";
}

async function ensureAuthSessionsTable() {
  if (!ensureAuthSessionsTablePromise) {
    ensureAuthSessionsTablePromise = query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        outer_token VARCHAR(32) NOT NULL,
        inner_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        token_type ENUM('MAIN', 'SUB') NOT NULL,
        role ENUM('admin', 'user') NOT NULL,
        issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL,
        CONSTRAINT fk_auth_sessions_vault
          FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        CONSTRAINT fk_auth_sessions_token
          FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
        INDEX idx_auth_sessions_vault (vault_id),
        INDEX idx_auth_sessions_token (inner_token_id),
        INDEX idx_auth_sessions_expires (expires_at),
        INDEX idx_auth_sessions_revoked (revoked_at)
      ) ENGINE=InnoDB
    `).catch((err) => {
      ensureAuthSessionsTablePromise = null;
      throw err;
    });
  }

  return ensureAuthSessionsTablePromise;
}

const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // prune at most once every 5 minutes per process
let lastPruneAt = 0;

async function pruneExpiredSessions() {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = Date.now();
  await ensureAuthSessionsTable();
  await query(`
    DELETE FROM auth_sessions
    WHERE revoked_at IS NOT NULL
       OR expires_at <= NOW()
  `).catch(() => {});
}

function buildSessionRecord({ sessionToken, vault, tokenRow, outerToken, expiresAtMs }) {
  return {
    sessionToken,
    vaultId: vault.vault_id,
    outerToken,
    innerTokenId: tokenRow.inner_token_id,
    tokenType: tokenRow.token_type,
    role: sessionRole(tokenRow.token_type),
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAtMs
  };
}

async function createSession({ vault, tokenRow, outerToken }) {
  await ensureAuthSessionsTable();
  await pruneExpiredSessions();

  const sessionToken = uuidv4();
  const vaultExpiresAtMs = new Date(vault.expires_at).getTime();
  const expiresAtMs = Math.min(vaultExpiresAtMs, Date.now() + SESSION_TTL_MS);

  await query(
    `
    INSERT INTO auth_sessions (
      session_token,
      vault_id,
      outer_token,
      inner_token_id,
      token_type,
      role,
      issued_at,
      last_seen_at,
      expires_at,
      revoked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), FROM_UNIXTIME(? / 1000), NULL)
    `,
    [
      sessionToken,
      vault.vault_id,
      outerToken,
      tokenRow.inner_token_id,
      tokenRow.token_type,
      sessionRole(tokenRow.token_type),
      expiresAtMs
    ]
  );

  return buildSessionRecord({ sessionToken, vault, tokenRow, outerToken, expiresAtMs });
}

async function getSession(sessionToken) {
  await ensureAuthSessionsTable();
  await pruneExpiredSessions();

  if (!sessionToken) return null;

  const rows = await query(
    `
    SELECT
      session_token,
      vault_id,
      outer_token,
      inner_token_id,
      token_type,
      role,
      issued_at,
      last_seen_at,
      expires_at,
      revoked_at
    FROM auth_sessions
    WHERE session_token = ?
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    `,
    [sessionToken]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs <= Date.now()) {
    await invalidateSession(sessionToken);
    return null;
  }

  await query(
    `
    UPDATE auth_sessions
    SET last_seen_at = NOW()
    WHERE session_token = ?
    `,
    [sessionToken]
  ).catch(() => {});

  return {
    sessionToken: row.session_token,
    vaultId: row.vault_id,
    outerToken: row.outer_token,
    innerTokenId: row.inner_token_id,
    tokenType: row.token_type,
    role: row.role || sessionRole(row.token_type),
    issuedAt: new Date(row.issued_at).getTime(),
    lastSeenAt: Date.now(),
    expiresAtMs
  };
}

async function invalidateSession(sessionToken) {
  if (!sessionToken) return;
  await ensureAuthSessionsTable();
  await query(
    `
    DELETE FROM auth_sessions
    WHERE session_token = ?
    `,
    [sessionToken]
  ).catch(() => {});
}

async function validateSessionAgainstDb(sessionToken) {
  const session = await getSession(sessionToken);
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
    JOIN inner_tokens t
      ON t.inner_token_id = ?
     AND t.vault_id = v.vault_id
    WHERE v.vault_id = ?
    `,
    [session.innerTokenId, session.vaultId]
  );

  if (rows.length === 0) {
    await invalidateSession(sessionToken);
    return null;
  }

  const row = rows[0];
  const vaultActive = row.vault_status === "ACTIVE" && new Date(row.expires_at) > new Date();
  const tokenActive = row.token_status === "ACTIVE";

  if (!vaultActive || !tokenActive) {
    await invalidateSession(sessionToken);
    return null;
  }

  session.tokenType = row.token_type;
  session.role = sessionRole(row.token_type);
  session.expiresAtMs = Math.min(new Date(row.expires_at).getTime(), Date.now() + SESSION_TTL_MS);

  await query(
    `
    UPDATE auth_sessions
    SET token_type = ?, role = ?, expires_at = FROM_UNIXTIME(? / 1000), last_seen_at = NOW()
    WHERE session_token = ?
    `,
    [session.tokenType, session.role, session.expiresAtMs, sessionToken]
  ).catch(() => {});

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
