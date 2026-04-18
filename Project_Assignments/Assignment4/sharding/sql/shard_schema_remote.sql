-- =============================================================================
-- GhostDrop  ·  Assignment 4  ·  Remote Shard Schema
-- sql/shard_schema_remote.sql
--
-- Run this script on EACH of the three remote shard servers:
--
--   mysql -h 10.0.116.184 -P 3307 -u Dragon -p Dragon < shard_schema_remote.sql
--   mysql -h 10.0.116.184 -P 3308 -u Dragon -p Dragon < shard_schema_remote.sql
--   mysql -h 10.0.116.184 -P 3309 -u Dragon -p Dragon < shard_schema_remote.sql
--
-- The database "Dragon" already exists on each shard server — do NOT create it.
-- Each server is a physically separate MySQL instance (physical sharding).
-- Table names are shared across all shards; isolation is at the server level.
--
-- Shard key  : vault_id (UUID v4)
-- Strategy   : Hash partitioning — shardIndex = parseInt(vault_id[0], 16) % 3
--   Shard 0 (port 3307): vault_id first hex digit ∈ {0,3,6,9,c,f}
--   Shard 1 (port 3308): vault_id first hex digit ∈ {1,4,7,a,d}
--   Shard 2 (port 3309): vault_id first hex digit ∈ {2,5,8,b,e}
-- =============================================================================

USE Dragon;

-- ── Metadata table: lets us verify which shard we are connected to ───────────
CREATE TABLE IF NOT EXISTS shard_meta (
  shard_id   TINYINT     NOT NULL PRIMARY KEY,     -- 0, 1, or 2
  shard_name VARCHAR(32) NOT NULL,
  port       SMALLINT    NOT NULL,
  hex_digits VARCHAR(64) NOT NULL,                 -- which vault_id[0] values land here
  team_name  VARCHAR(64) NOT NULL DEFAULT 'Dragon'
) ENGINE=InnoDB;

-- ── Core application tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vaults (
  vault_id    CHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  outer_token VARCHAR(32)  NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  status      ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inner_tokens (
  inner_token_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_type        ENUM('MAIN','SUB') NOT NULL,
  token_hash        CHAR(64) NOT NULL,
  token_lookup_hash CHAR(64) NULL,
  salt              CHAR(32) NOT NULL,
  key_iterations    INT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status            ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT fk_it_vault
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_it_vault_status  (vault_id, status),
  INDEX idx_it_lookup_hash   (token_lookup_hash, vault_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS files (
  file_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  drive_file_id     VARCHAR(128) NOT NULL UNIQUE,
  original_filename VARCHAR(255) NOT NULL,
  mime_type         VARCHAR(100) NOT NULL,
  file_size         BIGINT NOT NULL,
  storage_path      TEXT NULL,
  file_key_iv       CHAR(32) NULL,
  file_auth_tag     CHAR(32) NULL,
  file_hmac         CHAR(64) NULL,
  file_plain_hash   CHAR(64) NULL,
  status            ENUM('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE',
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP NULL,
  CONSTRAINT fk_f_vault
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_files_vault_status (vault_id, status, created_at),
  INDEX idx_files_deleted_at   (deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_metadata (
  metadata_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  relative_path     VARCHAR(512) NULL,
  mime_type         VARCHAR(100) NOT NULL,
  file_size         BIGINT NOT NULL,
  uploaded_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fm_file
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  UNIQUE KEY uq_fm_file (file_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_key_access (
  access_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inner_token_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_file_key  CHAR(64) NULL,
  key_wrap_iv         CHAR(24) NULL,
  key_wrap_tag        CHAR(32) NULL,
  key_wrap_salt       CHAR(32) NULL,
  key_wrap_iterations INT NULL,
  key_wrap_version    SMALLINT NULL,
  CONSTRAINT fk_fka_file  FOREIGN KEY (file_id)        REFERENCES files(file_id)        ON DELETE CASCADE,
  CONSTRAINT fk_fka_token FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  UNIQUE KEY uq_file_token (file_id, inner_token_id),
  INDEX idx_fka_token (inner_token_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  session_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  ip_address    VARCHAR(45) NOT NULL,
  user_agent    TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP NULL,
  INDEX idx_sessions_ip_created (ip_address, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_attempts (
  attempt_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  session_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vault_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempt_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success      BOOLEAN NOT NULL,
  CONSTRAINT fk_aa_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  INDEX idx_aa_time        (attempt_time),
  INDEX idx_aa_vault_time  (vault_id, attempt_time),
  INDEX idx_aa_session_time(session_id, attempt_time, success)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS download_logs (
  download_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inner_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  download_time  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dl_file  FOREIGN KEY (file_id)        REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_token FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  INDEX idx_dl_time      (download_time),
  INDEX idx_dl_file_time (file_id, download_time),
  INDEX idx_dl_token     (inner_token_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expiry_jobs (
  job_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_ej_vault FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  UNIQUE KEY uq_ej_vault (vault_id),
  INDEX idx_ej_sched (processed, scheduled_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS portfolio_entries (
  entry_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_token_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title               VARCHAR(120) NOT NULL,
  content             TEXT NOT NULL,
  integrity_hash      CHAR(64) NOT NULL,
  status              ENUM('ACTIVE','DELETED') NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pe_vault FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_pe_integrity_hash (integrity_hash),
  INDEX idx_pe_vault_owner    (vault_id, owner_token_id, status, updated_at),
  INDEX idx_pe_vault_status   (vault_id, status, updated_at)
) ENGINE=InnoDB;

-- Hot-path index: expiry daemon scans this on every shard
CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);

-- ── Populate shard identity (run SEPARATELY on each shard with correct values)
-- On shard 0 (port 3307): INSERT INTO shard_meta VALUES (0,'shard_0',3307,'0,3,6,9,c,f','Dragon');
-- On shard 1 (port 3308): INSERT INTO shard_meta VALUES (1,'shard_1',3308,'1,4,7,a,d','Dragon');
-- On shard 2 (port 3309): INSERT INTO shard_meta VALUES (2,'shard_2',3309,'2,5,8,b,e','Dragon');
-- (The migration script inserts these automatically.)
