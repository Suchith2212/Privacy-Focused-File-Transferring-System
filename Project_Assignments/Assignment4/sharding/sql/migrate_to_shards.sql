-- =============================================================================
-- GhostDrop  ·  Assignment 4  ·  Migration: ghostdrop_proto → shards
-- migrate_to_shards.sql
--
-- Pre-requisite: Run shard_schema.sql first to create the three shard databases.
--
-- Algorithm
-- ---------
-- For every vault, compute shard_index = CONV(SUBSTR(vault_id,1,1), 16, 10) % 3
-- then INSERT into the corresponding ghostdrop_shard_N database.
-- Child rows (inner_tokens, files, …) are migrated to the SAME shard as their
-- parent vault_id — preserving referential integrity within each shard.
--
-- Run from the MySQL CLI:
--   mysql -u root -p ghostdrop_proto < migrate_to_shards.sql
-- =============================================================================

USE ghostdrop_proto;

-- ── Stored procedure encapsulates the full scatter migration ─────────────────

DROP PROCEDURE IF EXISTS migrate_all_to_shards;

DELIMITER $$
CREATE PROCEDURE migrate_all_to_shards()
BEGIN
  DECLARE v_done   INT DEFAULT 0;
  DECLARE v_vid    CHAR(36);
  DECLARE v_shard  INT;

  -- Cursor over all vaults
  DECLARE cur CURSOR FOR SELECT vault_id FROM vaults ORDER BY created_at;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  OPEN cur;
  vault_loop: LOOP
    FETCH cur INTO v_vid;
    IF v_done THEN LEAVE vault_loop; END IF;

    -- -----------------------------------------------------------------
    -- Shard formula:
    --   shard_index = CONV( first_hex_char_of_uuid, 16, 10 ) % 3
    --
    --   uuid v4 examples:
    --     "0…" → CONV('0',16,10) = 0  → 0 % 3 = 0  → shard_0
    --     "6…" → CONV('6',16,10) = 6  → 6 % 3 = 0  → shard_0  ← NOTE: see full mapping below
    --     "7…" → 7 % 3 = 1  → shard_1
    --     "b…" → CONV('b',16,10) = 11 → 11 % 3 = 2 → shard_2
    --
    --   Full mapping (hex digit → decimal → mod 3):
    --     0→0, 1→1, 2→2, 3→0, 4→1, 5→2, 6→0, 7→1, 8→2, 9→0,
    --     a→1, b→2, c→0, d→1, e→2, f→0
    -- -----------------------------------------------------------------
    SET v_shard = CONV(SUBSTR(v_vid, 1, 1), 16, 10) % 3;

    IF v_shard = 0 THEN
      -- ── Vault ─────────────────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.vaults
        SELECT * FROM vaults WHERE vault_id = v_vid;

      -- ── Inner tokens ──────────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.inner_tokens
        SELECT * FROM inner_tokens WHERE vault_id = v_vid;

      -- ── Files ─────────────────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.files
        SELECT * FROM files WHERE vault_id = v_vid;

      -- ── File metadata ─────────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.file_metadata
        SELECT fm.* FROM file_metadata fm
        JOIN files f ON f.file_id = fm.file_id
        WHERE f.vault_id = v_vid;

      -- ── File key access ───────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.file_key_access
        SELECT fka.* FROM file_key_access fka
        JOIN files f ON f.file_id = fka.file_id
        WHERE f.vault_id = v_vid;

      -- ── Expiry jobs ───────────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.expiry_jobs
        SELECT * FROM expiry_jobs WHERE vault_id = v_vid;

      -- ── Portfolio entries ─────────────────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.portfolio_entries
        SELECT * FROM portfolio_entries WHERE vault_id = v_vid;

      -- ── Auth attempts (vault-scoped) ──────────────────────────────
      INSERT IGNORE INTO ghostdrop_shard_0.auth_attempts
        SELECT * FROM auth_attempts WHERE vault_id = v_vid;

    ELSEIF v_shard = 1 THEN
      INSERT IGNORE INTO ghostdrop_shard_1.vaults       SELECT * FROM vaults WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.inner_tokens SELECT * FROM inner_tokens WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.files        SELECT * FROM files WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.file_metadata
        SELECT fm.* FROM file_metadata fm JOIN files f ON f.file_id = fm.file_id WHERE f.vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.file_key_access
        SELECT fka.* FROM file_key_access fka JOIN files f ON f.file_id = fka.file_id WHERE f.vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.expiry_jobs    SELECT * FROM expiry_jobs WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.portfolio_entries SELECT * FROM portfolio_entries WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_1.auth_attempts    SELECT * FROM auth_attempts WHERE vault_id = v_vid;

    ELSE  -- shard 2
      INSERT IGNORE INTO ghostdrop_shard_2.vaults       SELECT * FROM vaults WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.inner_tokens SELECT * FROM inner_tokens WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.files        SELECT * FROM files WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.file_metadata
        SELECT fm.* FROM file_metadata fm JOIN files f ON f.file_id = fm.file_id WHERE f.vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.file_key_access
        SELECT fka.* FROM file_key_access fka JOIN files f ON f.file_id = fka.file_id WHERE f.vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.expiry_jobs    SELECT * FROM expiry_jobs WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.portfolio_entries SELECT * FROM portfolio_entries WHERE vault_id = v_vid;
      INSERT IGNORE INTO ghostdrop_shard_2.auth_attempts    SELECT * FROM auth_attempts WHERE vault_id = v_vid;
    END IF;

  END LOOP;
  CLOSE cur;

  -- Sessions are not vault-scoped — replicate to all shards so each
  -- shard can satisfy auth_attempts FK lookups locally.
  INSERT IGNORE INTO ghostdrop_shard_0.sessions SELECT * FROM sessions;
  INSERT IGNORE INTO ghostdrop_shard_1.sessions SELECT * FROM sessions;
  INSERT IGNORE INTO ghostdrop_shard_2.sessions SELECT * FROM sessions;

  SELECT
    (SELECT COUNT(*) FROM ghostdrop_shard_0.vaults) AS shard_0_vaults,
    (SELECT COUNT(*) FROM ghostdrop_shard_1.vaults) AS shard_1_vaults,
    (SELECT COUNT(*) FROM ghostdrop_shard_2.vaults) AS shard_2_vaults,
    (SELECT COUNT(*) FROM vaults)                   AS source_total;

END$$
DELIMITER ;

CALL migrate_all_to_shards();

-- Verification query — confirms no vault was dropped or duplicated
SELECT
  'Migration complete' AS status,
  (SELECT COUNT(*) FROM ghostdrop_shard_0.vaults) +
  (SELECT COUNT(*) FROM ghostdrop_shard_1.vaults) +
  (SELECT COUNT(*) FROM ghostdrop_shard_2.vaults) AS total_migrated,
  (SELECT COUNT(*) FROM vaults) AS source_count,
  CASE
    WHEN (
      (SELECT COUNT(*) FROM ghostdrop_shard_0.vaults) +
      (SELECT COUNT(*) FROM ghostdrop_shard_1.vaults) +
      (SELECT COUNT(*) FROM ghostdrop_shard_2.vaults)
    ) = (SELECT COUNT(*) FROM vaults)
    THEN 'PASS - row counts match'
    ELSE 'FAIL - row count mismatch'
  END AS integrity_check;
