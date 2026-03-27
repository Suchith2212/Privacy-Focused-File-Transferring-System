const { createHash } = require("crypto");
const { query } = require("../config/db");

const DEFAULT_INTEGRITY_SECRET = "ghostdrop-portfolio-dev-secret";

let ensurePortfolioSchemaPromise = null;
let ensurePortfolioGuardTriggersPromise = null;

function getIntegritySecret() {
  return process.env.PORTFOLIO_INTEGRITY_SECRET || DEFAULT_INTEGRITY_SECRET;
}

function assertIntegritySecretSafe() {
  const secret = getIntegritySecret();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (env === "production" && secret === DEFAULT_INTEGRITY_SECRET) {
    throw new Error("PORTFOLIO_INTEGRITY_SECRET must be explicitly set in production.");
  }
}

function computeIntegrityHash(entry) {
  return createHash("sha256")
    .update(
      [
        entry.vaultId,
        entry.ownerTokenId,
        entry.title,
        entry.content,
        entry.status,
        getIntegritySecret()
      ].join("|")
    )
    .digest("hex");
}

function isEntryTampered(row) {
  const expected = computeIntegrityHash({
    vaultId: row.vault_id,
    ownerTokenId: row.owner_token_id,
    title: row.title,
    content: row.content,
    status: row.status
  });
  return expected !== row.integrity_hash;
}

function ensurePortfolioSchema() {
  if (!ensurePortfolioSchemaPromise) {
    ensurePortfolioSchemaPromise = query(`
      CREATE TABLE IF NOT EXISTS portfolio_entries (
        entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        owner_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        created_by_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        title VARCHAR(120) NOT NULL,
        content TEXT NOT NULL,
        integrity_hash CHAR(64) NOT NULL,
        status ENUM('ACTIVE', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_portfolio_vault
          FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        CONSTRAINT fk_portfolio_owner_token
          FOREIGN KEY (owner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
        CONSTRAINT fk_portfolio_created_by_token
          FOREIGN KEY (created_by_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
        INDEX idx_portfolio_vault_owner_status (vault_id, owner_token_id, status, updated_at),
        INDEX idx_portfolio_vault_status (vault_id, status, updated_at),
        INDEX idx_portfolio_integrity_hash (integrity_hash)
      )
    `)
      .then(() => ensurePortfolioGuardTriggers())
      .catch((err) => {
        ensurePortfolioSchemaPromise = null;
        throw err;
      });
  }

  return ensurePortfolioSchemaPromise;
}

function ensurePortfolioGuardTriggers() {
  if (!ensurePortfolioGuardTriggersPromise) {
    ensurePortfolioGuardTriggersPromise = (async () => {
      const rows = await query(
        `
        SELECT TRIGGER_NAME
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND EVENT_OBJECT_TABLE = 'portfolio_entries'
          AND TRIGGER_NAME = 'before_portfolio_update_guard'
        `
      );

      if (rows.length === 0) {
        /*
        await query(`
          CREATE TRIGGER before_portfolio_update_guard
          BEFORE UPDATE ON portfolio_entries
          FOR EACH ROW
          BEGIN
            IF OLD.created_at <> NEW.created_at THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Timestamp tampering detected';
            END IF;
            IF OLD.created_by_token_id <> NEW.created_by_token_id THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Creator tampering detected';
            END IF;
          END
        `).catch(() => {});
        */
      }
    })().catch((err) => {
      ensurePortfolioGuardTriggersPromise = null;
      throw err;
    });
  }

  return ensurePortfolioGuardTriggersPromise;
}

async function findTamperedEntries(vaultId) {
  await ensurePortfolioSchema();
  const rows = await query(
    `
    SELECT
      entry_id,
      vault_id,
      owner_token_id,
      title,
      content,
      status,
      integrity_hash,
      updated_at
    FROM portfolio_entries
    WHERE vault_id = ?
    `,
    [vaultId]
  );

  return rows
    .filter((row) => isEntryTampered(row))
    .map((row) => ({
      entryId: row.entry_id,
      ownerTokenId: row.owner_token_id,
      status: row.status,
      updatedAt: row.updated_at
    }));
}

async function findAllTamperedEntries() {
  await ensurePortfolioSchema();
  const rows = await query(
    `
    SELECT
      entry_id,
      vault_id,
      owner_token_id,
      title,
      content,
      status,
      integrity_hash,
      updated_at
    FROM portfolio_entries
    `
  );

  return rows
    .filter((row) => isEntryTampered(row))
    .map((row) => ({
      entryId: row.entry_id,
      vaultId: row.vault_id,
      ownerTokenId: row.owner_token_id,
      status: row.status,
      updatedAt: row.updated_at
    }));
}

module.exports = {
  assertIntegritySecretSafe,
  computeIntegrityHash,
  ensurePortfolioSchema,
  ensurePortfolioGuardTriggers,
  findAllTamperedEntries,
  findTamperedEntries,
  isEntryTampered
};
