const { query } = require("../config/db");

async function tableExists(tableName) {
  const rows = await query(
    `
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(tableName, columnName) {
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
  return rows.length > 0;
}

async function ensureColumn(tableName, columnName, definitionSql) {
  if (!(await tableExists(tableName))) return;
  if (await columnExists(tableName, columnName)) return;
  await query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
}

async function getIndexColumns(tableName, indexName) {
  const rows = await query(
    `
    SELECT COLUMN_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME = ?
    ORDER BY SEQ_IN_INDEX
    `,
    [tableName, indexName]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function ensureIndex(tableName, indexName, columns) {
  if (!(await tableExists(tableName))) return;

  const existingColumns = await getIndexColumns(tableName, indexName);
  if (
    existingColumns.length === columns.length &&
    existingColumns.every((column, index) => column === columns[index])
  ) {
    return;
  }

  if (existingColumns.length > 0) {
    await query(`DROP INDEX ${indexName} ON ${tableName}`);
  }

  await query(`CREATE INDEX ${indexName} ON ${tableName} (${columns.join(", ")})`);
}

async function ensurePerformanceIndexes() {
  await ensureColumn("inner_tokens", "token_lookup_hash", "token_lookup_hash CHAR(64) NULL AFTER token_hash");

  await ensureIndex("inner_tokens", "idx_inner_tokens_lookup_hash", [
    "token_lookup_hash",
    "vault_id",
    "status"
  ]);
  await ensureIndex("file_key_access", "idx_file_key_access_token", ["inner_token_id"]);
  await ensureIndex("download_logs", "idx_download_file_time", ["file_id", "download_time"]);
  await ensureIndex("download_logs", "idx_download_token", ["inner_token_id"]);
  await ensureIndex("files", "idx_files_deleted_at", ["deleted_at"]);
  await ensureIndex("auth_attempts", "idx_auth_attempts_session_time", [
    "session_id",
    "attempt_time",
    "success"
  ]);
  await ensureIndex("portfolio_entries", "idx_portfolio_integrity_hash", ["integrity_hash"]);
  await ensureIndex("vaults", "idx_vault_expiry", ["status", "expires_at"]);
  await ensureIndex("expiry_jobs", "idx_expiry_jobs_sched", ["processed", "scheduled_time"]);
}

module.exports = {
  ensurePerformanceIndexes
};
