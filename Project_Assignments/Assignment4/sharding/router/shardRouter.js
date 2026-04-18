// =============================================================================
// GhostDrop  ·  Assignment 4  ·  Query Router
// router/shardRouter.js
//
// Houses every shard-aware database operation used by the API routes.
// The existing routes import from this file instead of calling db.js directly.
//
// Routing table
// ─────────────
//  INSERT vault         → getShard(newVaultId)
//  INSERT child row     → getShard(vaultId)   (same shard as parent vault)
//  LOOKUP by vaultId    → getShard(vaultId)    (single shard)
//  LOOKUP by outerToken → scatter to all 3 shards, take first hit
//  RANGE by created_at  → fan-out to all 3, merge + re-sort in app layer
//  RANGE by expires_at  → fan-out to all 3 (expiry daemon)
// =============================================================================

"use strict";

const {
  getShard,
  getAllShards,
  queryOnShard,
  getConnectionOnShard,
} = require("../config/shardConfig");

// ─── INSERT ROUTING ──────────────────────────────────────────────────────────

/**
 * insertVault(vault) → void
 *
 * Chooses the target shard deterministically from vault_id, then inserts.
 * Called once during vault creation — before any child rows exist.
 */
async function insertVault({ vaultId, outerToken, expiresInDays }) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO vaults (vault_id, outer_token, created_at, expires_at, status)
     VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'ACTIVE')`,
    [vaultId, outerToken, expiresInDays]
  );
  return shard;
}

/**
 * insertInnerToken(token) → void
 *
 * vault_id carries the routing information — child always goes to same shard.
 */
async function insertInnerToken({
  innerTokenId, vaultId, tokenType, tokenHash,
  tokenLookupHash, salt, keyIterations,
}) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO inner_tokens
     (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'ACTIVE')`,
    [innerTokenId, vaultId, tokenType, tokenHash, tokenLookupHash, salt, keyIterations]
  );
}

/**
 * insertFile(file) → void
 */
async function insertFile({
  fileId, vaultId, driveFileId, originalFilename, mimeType,
  fileSize, storagePathVal, fileKeyIv, fileAuthTag, fileHmac, filePlainHash,
}) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO files
     (file_id, vault_id, drive_file_id, original_filename, mime_type,
      file_size, storage_path, file_key_iv, file_auth_tag, file_hmac, file_plain_hash,
      status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW())`,
    [fileId, vaultId, driveFileId, originalFilename, mimeType,
     fileSize, storagePathVal, fileKeyIv, fileAuthTag, fileHmac, filePlainHash]
  );
}

/**
 * insertFileMetadata(meta) → void
 */
async function insertFileMetadata({ metadataId, fileId, vaultId, originalFilename, relativePath, mimeType, fileSize }) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO file_metadata
     (metadata_id, file_id, original_filename, relative_path, mime_type, file_size, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [metadataId, fileId, originalFilename, relativePath, mimeType, fileSize]
  );
}

/**
 * insertFileKeyAccess(access) → void
 */
async function insertFileKeyAccess({
  accessId, fileId, innerTokenId, vaultId,
  encryptedFileKey, keyWrapIv, keyWrapTag, keyWrapSalt, keyWrapIterations, keyWrapVersion,
}) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO file_key_access
     (access_id, file_id, inner_token_id, encrypted_file_key, key_wrap_iv, key_wrap_tag,
      key_wrap_salt, key_wrap_iterations, key_wrap_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [accessId, fileId, innerTokenId, encryptedFileKey, keyWrapIv, keyWrapTag,
     keyWrapSalt, keyWrapIterations, keyWrapVersion]
  );
}

// ─── LOOKUP ROUTING ──────────────────────────────────────────────────────────

/**
 * getVaultById(vaultId) → vault row | null
 *
 * O(1) single-shard lookup — no scatter needed.
 */
async function getVaultById(vaultId) {
  const shard = getShard(vaultId);
  const rows = await queryOnShard(
    shard,
    `SELECT vault_id, outer_token, status, created_at, expires_at
     FROM vaults WHERE vault_id = ?`,
    [vaultId]
  );
  return rows[0] || null;
}

/**
 * getVaultByOuterToken(outerToken) → vault row | null
 *
 * outer_token is NOT the shard key → must scatter to all shards.
 * Parallel fan-out: queries all 3 simultaneously, takes first non-null.
 *
 * Optimisation: In practice, outer_token is only looked up when a user
 * presents it at the access endpoint. We could add an outer_token→vaultId
 * directory table on a coordinator node to avoid the scatter, but for this
 * academic system scatter + parallel fetch is perfectly adequate.
 */
async function getVaultByOuterToken(outerToken) {
  const shards = getAllShards();
  const queries = shards.map((shard) =>
    queryOnShard(
      shard,
      `SELECT vault_id, outer_token, status, created_at, expires_at
       FROM vaults WHERE outer_token = ?`,
      [outerToken]
    )
  );

  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      return result.value[0];
    }
  }
  return null;
}

/**
 * getInnerTokensByVault(vaultId, lookupHash) → rows
 * Uses idx_it_lookup_hash — O(1) indexed scan on the ONE correct shard.
 */
async function getInnerTokensByVault(vaultId, lookupHash) {
  const shard = getShard(vaultId);
  return queryOnShard(
    shard,
    `SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
     FROM inner_tokens
     WHERE token_lookup_hash = ? AND vault_id = ? AND status = 'ACTIVE'`,
    [lookupHash, vaultId]
  );
}

/**
 * getAllInnerTokensByVault(vaultId) → rows  (fallback, no lookup hash)
 */
async function getAllInnerTokensByVault(vaultId) {
  const shard = getShard(vaultId);
  return queryOnShard(
    shard,
    `SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
     FROM inner_tokens WHERE vault_id = ? AND status = 'ACTIVE'`,
    [vaultId]
  );
}

/**
 * getFilesByVaultAndToken(vaultId, innerTokenId) → file rows
 */
async function getFilesByVaultAndToken(vaultId, innerTokenId) {
  const shard = getShard(vaultId);
  return queryOnShard(
    shard,
    `SELECT
       f.file_id,
       COALESCE(fm.original_filename, f.original_filename) AS original_filename,
       COALESCE(fm.relative_path, fm.original_filename, f.original_filename) AS relative_path,
       COALESCE(fm.mime_type, f.mime_type) AS mime_type,
       COALESCE(fm.file_size, f.file_size) AS file_size,
       f.created_at
     FROM files f
     LEFT JOIN file_metadata fm ON fm.file_id = f.file_id
     JOIN  file_key_access a   ON a.file_id   = f.file_id
     WHERE f.vault_id = ?
       AND f.status = 'ACTIVE'
       AND a.inner_token_id = ?
     ORDER BY f.created_at DESC`,
    [vaultId, innerTokenId]
  );
}

/**
 * countActiveFilesByVault(vaultId) → number
 */
async function countActiveFilesByVault(vaultId) {
  const shard = getShard(vaultId);
  const rows = await queryOnShard(
    shard,
    `SELECT COUNT(*) AS cnt FROM files WHERE vault_id = ? AND status = 'ACTIVE'`,
    [vaultId]
  );
  return Number(rows[0]?.cnt || 0);
}

// ─── RANGE QUERY — CROSS-SHARD FAN-OUT ───────────────────────────────────────

/**
 * getVaultsByCreatedAtRange(startTs, endTs, limit = 500) → vault rows (merged)
 *
 * Fan-out pattern:
 *  1. Issue the same query to all 3 shards in parallel.
 *  2. Collect results arrays.
 *  3. Merge + sort by created_at in the application layer.
 *  4. Apply limit post-merge.
 *
 * This mirrors how systems like Vitess handle scatter-gather for range queries
 * that cross shard boundaries.
 */
async function getVaultsByCreatedAtRange(startTs, endTs, limit = 500) {
  const shards = getAllShards();

  // Parallel queries
  const fanOut = await Promise.allSettled(
    shards.map((shard) =>
      queryOnShard(
        shard,
        `SELECT vault_id, outer_token, status, created_at, expires_at, ? AS _shard
         FROM vaults
         WHERE created_at BETWEEN ? AND ?
         ORDER BY created_at ASC`,
        [shard.name, startTs, endTs]
      )
    )
  );

  // Merge
  const merged = [];
  for (const result of fanOut) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    }
  }

  // Re-sort by created_at (cross-shard merge sort)
  merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Apply limit
  return merged.slice(0, limit);
}

/**
 * getExpiredVaultsAcrossAllShards(cutoffTs) → { shard, rows }[]
 *
 * Used by the expiry daemon to find vaults that must be expired.
 * Returns results grouped by shard so each vault can be updated/deleted
 * on its owning shard connection.
 */
async function getExpiredVaultsAcrossAllShards(cutoffTs) {
  const shards = getAllShards();
  const output = [];

  await Promise.all(
    shards.map(async (shard) => {
      try {
        const rows = await queryOnShard(
          shard,
          `SELECT vault_id, expires_at FROM vaults
           WHERE status = 'ACTIVE' AND expires_at <= ?
           ORDER BY expires_at ASC`,
          [cutoffTs]
        );
        if (rows.length > 0) {
          output.push({ shard, rows });
        }
      } catch (_err) {
        // Tolerate a shard being temporarily unavailable (availability > consistency)
        console.error(`[shardRouter] Shard ${shard.name} unavailable for expiry scan:`, _err.message);
      }
    })
  );

  return output;
}

/**
 * getDownloadStatsByDateRange(startTs, endTs) → merged download_logs rows
 *
 * Cross-shard analytics — useful for the demo's "admin dashboard" range query.
 */
async function getDownloadStatsByDateRange(startTs, endTs) {
  const shards = getAllShards();
  const fanOut = await Promise.allSettled(
    shards.map((shard) =>
      queryOnShard(
        shard,
        `SELECT dl.download_id, dl.file_id, dl.download_time, ? AS _shard
         FROM download_logs dl
         WHERE download_time BETWEEN ? AND ?
         ORDER BY download_time ASC`,
        [shard.name, startTs, endTs]
      )
    )
  );

  const merged = [];
  for (const r of fanOut) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }
  merged.sort((a, b) => new Date(a.download_time) - new Date(b.download_time));
  return merged;
}

// ─── TRANSACTIONAL OPERATIONS ─────────────────────────────────────────────────

/**
 * createVaultTransaction({ vaultId, outerToken, expiresInDays, innerTokenId, ... })
 *
 * Wraps vault + mainToken insertion in an intra-shard transaction.
 * Since both rows go to the SAME shard, this is a normal single-node transaction
 * — no 2PC needed.
 */
async function createVaultTransaction({
  vaultId, outerToken, expiresInDays,
  innerTokenId, tokenHash, salt, keyIterations, tokenLookupHash,
}) {
  const shard = getShard(vaultId);
  const conn  = await getConnectionOnShard(shard);

  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO vaults (vault_id, outer_token, created_at, expires_at, status)
       VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'ACTIVE')`,
      [vaultId, outerToken, expiresInDays]
    );

    await conn.execute(
      `INSERT INTO inner_tokens
       (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
       VALUES (?, ?, 'MAIN', ?, ?, ?, ?, NOW(), 'ACTIVE')`,
      [innerTokenId, vaultId, tokenHash, tokenLookupHash, salt, keyIterations]
    );

    await conn.commit();
    return shard;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * createSubTokenTransaction({ vaultId, subTokenId, files, ... })
 *
 * Wraps sub-token creation + file_key_access inserts in one transaction.
 */
async function createSubTokenTransaction({
  vaultId, subTokenId, tokenHash, salt, keyIterations, tokenLookupHash, fileIds,
}) {
  const shard = getShard(vaultId);
  const conn  = await getConnectionOnShard(shard);

  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO inner_tokens
       (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
       VALUES (?, ?, 'SUB', ?, ?, ?, ?, NOW(), 'ACTIVE')`,
      [subTokenId, vaultId, tokenHash, tokenLookupHash, salt, keyIterations]
    );

    for (const { accessId, fileId } of fileIds) {
      await conn.execute(
        `INSERT INTO file_key_access (access_id, file_id, inner_token_id) VALUES (?, ?, ?)`,
        [accessId, fileId, subTokenId]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────

/**
 * updateTokenLookupHash(vaultId, innerTokenId, lookupHash) → void
 * Back-patches the indexed lookup hash for pre-existing rows.
 */
async function updateTokenLookupHash(vaultId, innerTokenId, lookupHash) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `UPDATE inner_tokens SET token_lookup_hash = ?
     WHERE inner_token_id = ? AND token_lookup_hash IS NULL`,
    [lookupHash, innerTokenId]
  );
}

/**
 * upsertExpiryJob({ vaultId, expiresAt }) — idempotent
 */
async function upsertExpiryJob({ vaultId, expiresAt, jobId }) {
  const shard = getShard(vaultId);
  await queryOnShard(
    shard,
    `INSERT INTO expiry_jobs (job_id, vault_id, scheduled_time, processed)
     VALUES (?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE scheduled_time = VALUES(scheduled_time), processed = FALSE`,
    [jobId, vaultId, expiresAt]
  );
}

/**
 * getVaultExpiresAt(vaultId) → TIMESTAMP string | null
 */
async function getVaultExpiresAt(vaultId) {
  const rows = await queryOnShard(
    getShard(vaultId),
    `SELECT expires_at FROM vaults WHERE vault_id = ?`,
    [vaultId]
  );
  return rows[0]?.expires_at ?? null;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  // INSERT
  insertVault,
  insertInnerToken,
  insertFile,
  insertFileMetadata,
  insertFileKeyAccess,
  // LOOKUP
  getVaultById,
  getVaultByOuterToken,
  getInnerTokensByVault,
  getAllInnerTokensByVault,
  getFilesByVaultAndToken,
  countActiveFilesByVault,
  // RANGE (cross-shard)
  getVaultsByCreatedAtRange,
  getExpiredVaultsAcrossAllShards,
  getDownloadStatsByDateRange,
  // TRANSACTIONS
  createVaultTransaction,
  createSubTokenTransaction,
  // UTILITY
  updateTokenLookupHash,
  upsertExpiryJob,
  getVaultExpiresAt,
};
