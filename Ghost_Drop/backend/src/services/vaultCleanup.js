/**
 * Background Vault Cleanup Service
 * 
 * Periodically scans for expired vaults and:
 *  1. Deletes all associated files from Google Drive
 *  2. Removes all DB records (files, tokens, metadata, access, audit)
 *  3. Marks the vault as PURGED (or deletes it entirely)
 * 
 * Config (env vars):
 *   VAULT_CLEANUP_INTERVAL_MS  — scan interval (default: 10 minutes)
 *   VAULT_CLEANUP_GRACE_HOURS  — hours after expiry before purging (default: 1)
 *   VAULT_CLEANUP_BATCH_SIZE   — max vaults per scan cycle (default: 20)
 */

const { query, getConnection } = require("../config/db");
const { deleteFile } = require("./driveService");
const logger = require("../config/logger");

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;      // 10 minutes
const DEFAULT_GRACE_HOURS = 1;                     // 1 hour after expiry
const DEFAULT_BATCH_SIZE = 20;

function getConfig() {
  return {
    intervalMs: Number(process.env.VAULT_CLEANUP_INTERVAL_MS || DEFAULT_INTERVAL_MS),
    graceHours: Number(process.env.VAULT_CLEANUP_GRACE_HOURS || DEFAULT_GRACE_HOURS),
    batchSize: Number(process.env.VAULT_CLEANUP_BATCH_SIZE || DEFAULT_BATCH_SIZE)
  };
}

/**
 * Find vaults that expired more than `graceHours` ago and are still ACTIVE or EXPIRED.
 */
async function findPurgeableVaults(graceHours, batchSize) {
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  return query(
    `
    SELECT vault_id, outer_token, expires_at, status
    FROM vaults
    WHERE expires_at < ?
      AND status IN ('ACTIVE', 'EXPIRED')
    ORDER BY expires_at ASC
    LIMIT ?
    `,
    [cutoff, batchSize]
  );
}

/**
 * Purge a single vault: delete Drive files, remove all DB records, mark vault PURGED.
 */
async function purgeVault(vault) {
  const conn = await getConnection();
  const vaultId = vault.vault_id;

  try {
    await conn.beginTransaction();

    // 1. Collect all Drive file IDs for this vault
    const files = await conn.query(
      "SELECT file_id, drive_file_id FROM files WHERE vault_id = ?",
      [vaultId]
    );
    const fileRows = Array.isArray(files[0]) ? files[0] : files;

    // 2. Delete files from Google Drive (best-effort, don't fail the whole purge)
    let driveDeletedCount = 0;
    let driveFailedCount = 0;
    for (const file of fileRows) {
      if (file.drive_file_id) {
        try {
          await deleteFile(file.drive_file_id);
          driveDeletedCount++;
        } catch (err) {
          // File may already be gone, or Drive credentials expired — log and continue
          driveFailedCount++;
          logger.warn(
            { vaultId, fileId: file.file_id, driveFileId: file.drive_file_id, err: err.message },
            "Failed to delete Drive file during vault cleanup"
          );
        }
      }
    }

    // 3. Delete DB records in dependency order
    const fileIds = fileRows.map((f) => f.file_id);

    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => "?").join(",");

      // file_key_access (depends on file_id and inner_token_id)
      await conn.query(
        `DELETE FROM file_key_access WHERE file_id IN (${placeholders})`,
        fileIds
      );

      // file_metadata
      await conn.query(
        `DELETE FROM file_metadata WHERE file_id IN (${placeholders})`,
        fileIds
      );

      // files
      await conn.query(
        `DELETE FROM files WHERE vault_id = ?`,
        [vaultId]
      );
    }

    // sub_token_secrets (depends on inner_token_id)
    const tokenRows = await conn.query(
      "SELECT inner_token_id FROM inner_tokens WHERE vault_id = ?",
      [vaultId]
    );
    const tokens = Array.isArray(tokenRows[0]) ? tokenRows[0] : tokenRows;
    if (tokens.length > 0) {
      const tokenIds = tokens.map((t) => t.inner_token_id);
      const tPlaceholders = tokenIds.map(() => "?").join(",");
      await conn.query(
        `DELETE FROM sub_token_secrets WHERE inner_token_id IN (${tPlaceholders})`,
        tokenIds
      ).catch(() => {});  // Table may not exist
    }

    // inner_tokens
    await conn.query("DELETE FROM inner_tokens WHERE vault_id = ?", [vaultId]);

    // audit_log entries for this vault
    await conn.query("DELETE FROM audit_log WHERE vault_id = ?", [vaultId]).catch(() => {});

    // auth_sessions for this vault
    await conn.query("DELETE FROM auth_sessions WHERE vault_id = ?", [vaultId]).catch(() => {});

    // 4. Mark vault as DELETED (keep the row for audit trail)
    await conn.query(
      "UPDATE vaults SET status = 'DELETED' WHERE vault_id = ?",
      [vaultId]
    );

    await conn.commit();

    logger.info(
      {
        vaultId,
        outerToken: vault.outer_token,
        filesDeleted: fileRows.length,
        driveDeleted: driveDeletedCount,
        driveFailed: driveFailedCount
      },
      "Vault purged successfully"
    );

    return { success: true, filesDeleted: fileRows.length, driveDeleted: driveDeletedCount };
  } catch (err) {
    await conn.rollback().catch(() => {});
    logger.error({ vaultId, err }, "Vault purge failed — transaction rolled back");
    return { success: false, error: err.message };
  } finally {
    conn.release();
  }
}

/**
 * Run one cleanup cycle: find purgeable vaults and purge them.
 */
async function runCleanupCycle() {
  const { graceHours, batchSize } = getConfig();

  try {
    const vaults = await findPurgeableVaults(graceHours, batchSize);
    if (vaults.length === 0) return { purged: 0, failed: 0 };

    logger.info({ count: vaults.length }, "Starting vault cleanup cycle");

    let purged = 0;
    let failed = 0;

    for (const vault of vaults) {
      const result = await purgeVault(vault);
      if (result.success) {
        purged++;
      } else {
        failed++;
      }
    }

    logger.info({ purged, failed }, "Vault cleanup cycle complete");
    return { purged, failed };
  } catch (err) {
    logger.error({ err }, "Vault cleanup cycle crashed");
    return { purged: 0, failed: 0, error: err.message };
  }
}

/**
 * Start the background cleanup timer. Returns the timer handle.
 */
function startCleanupTimer() {
  const { intervalMs } = getConfig();
  if (intervalMs <= 0) {
    logger.info("Vault cleanup disabled (VAULT_CLEANUP_INTERVAL_MS <= 0)");
    return null;
  }

  logger.info(
    { intervalMs, graceHours: getConfig().graceHours, batchSize: getConfig().batchSize },
    "Vault cleanup timer started"
  );

  // Run once immediately on startup, then on interval
  runCleanupCycle().catch(() => {});

  return setInterval(() => {
    runCleanupCycle().catch(() => {});
  }, intervalMs);
}

module.exports = {
  runCleanupCycle,
  startCleanupTimer,
  purgeVault,
  findPurgeableVaults
};
