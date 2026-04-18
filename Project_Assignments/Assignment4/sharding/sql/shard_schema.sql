-- =============================================================================
-- GhostDrop Sharding  ·  Assignment 4  ·  CS432 IIT Gandhinagar
-- shard_schema.sql
--
-- Run this script once for each shard database.
-- Usage:
--   mysql -u root -p < shard_schema.sql
--
-- Creates three shard databases:
--   ghostdrop_shard_0   (vault UUIDs whose first hex digit ∈ {0..5})
--   ghostdrop_shard_1   (vault UUIDs whose first hex digit ∈ {6..a})
--   ghostdrop_shard_2   (vault UUIDs whose first hex digit ∈ {b..f})
--
-- Shard key  : vault_id  (CHAR(36) UUID v4)
-- ─── Shard 0 ─────────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS ghostdrop_shard_0
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE ghostdrop_shard_0;

-- Shard registry: tiny table to self-identify
CREATE TABLE IF NOT EXISTS shard_meta (
  shard_id   TINYINT  NOT NULL PRIMARY KEY,
  shard_name VARCHAR(32) NOT NULL,
  hex_range  VARCHAR(32) NOT NULL     -- human-readable bucket description
) ENGINE=InnoDB;
INSERT IGNORE INTO shard_meta VALUES (0, 'shard_0', '0x0-0x5');

-- ── Core tables (FK constraints are INTRA-shard only) ────────────────────────

CREATE TABLE IF NOT EXISTS vaults (
  vault_id    CHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  outer_token VARCHAR(32)  NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  status      ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inner_tokens (
  inner_token_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_type       ENUM('MAIN','SUB') NOT NULL,
  token_hash       CHAR(64) NOT NULL,
  token_lookup_hash CHAR(64) NULL,
  salt             CHAR(32) NOT NULL,
  key_iterations   INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status           ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT fk_it_vault_s0
    FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_it_vault_status   (vault_id, status),
  INDEX idx_it_lookup_hash    (token_lookup_hash, vault_id, status)
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
  CONSTRAINT fk_f_vault_s0
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
  CONSTRAINT fk_fm_file_s0
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  UNIQUE KEY uq_fm_file (file_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_key_access (
  access_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inner_token_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_file_key CHAR(64) NULL,
  key_wrap_iv        CHAR(24) NULL,
  key_wrap_tag       CHAR(32) NULL,
  key_wrap_salt      CHAR(32) NULL,
  key_wrap_iterations INT NULL,
  key_wrap_version   SMALLINT NULL,
  CONSTRAINT fk_fka_file_s0
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_fka_token_s0
    FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  UNIQUE KEY uq_file_token_s0 (file_id, inner_token_id),
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
  attempt_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  session_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vault_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempt_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success     BOOLEAN NOT NULL,
  CONSTRAINT fk_aa_session_s0 FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_dl_file_s0  FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_token_s0 FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  INDEX idx_dl_time          (download_time),
  INDEX idx_dl_file_time     (file_id, download_time),
  INDEX idx_dl_token         (inner_token_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expiry_jobs (
  job_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_ej_vault_s0 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_pe_vault_s0 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_pe_integrity_hash (integrity_hash),
  INDEX idx_pe_vault_owner    (vault_id, owner_token_id, status, updated_at),
  INDEX idx_pe_vault_status   (vault_id, status, updated_at)
) ENGINE=InnoDB;

-- Shard-level index on status + expiry (hot path for expiry daemon)
CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);


-- =============================================================================
-- ─── Shard 1 ─────────────────────────────────────────────────────────────────
-- =============================================================================
CREATE DATABASE IF NOT EXISTS ghostdrop_shard_1
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE ghostdrop_shard_1;

CREATE TABLE IF NOT EXISTS shard_meta (
  shard_id   TINYINT  NOT NULL PRIMARY KEY,
  shard_name VARCHAR(32) NOT NULL,
  hex_range  VARCHAR(32) NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO shard_meta VALUES (1, 'shard_1', '0x6-0xa');

CREATE TABLE IF NOT EXISTS vaults (
  vault_id    CHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  outer_token VARCHAR(32)  NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  status      ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inner_tokens (
  inner_token_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_type       ENUM('MAIN','SUB') NOT NULL,
  token_hash       CHAR(64) NOT NULL,
  token_lookup_hash CHAR(64) NULL,
  salt             CHAR(32) NOT NULL,
  key_iterations   INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status           ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT fk_it_vault_s1 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_it_vault_status   (vault_id, status),
  INDEX idx_it_lookup_hash    (token_lookup_hash, vault_id, status)
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
  CONSTRAINT fk_f_vault_s1 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_fm_file_s1 FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  UNIQUE KEY uq_fm_file (file_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_key_access (
  access_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inner_token_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_file_key CHAR(64) NULL,
  key_wrap_iv        CHAR(24) NULL,
  key_wrap_tag       CHAR(32) NULL,
  key_wrap_salt      CHAR(32) NULL,
  key_wrap_iterations INT NULL,
  key_wrap_version   SMALLINT NULL,
  CONSTRAINT fk_fka_file_s1  FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_fka_token_s1 FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  UNIQUE KEY uq_file_token_s1 (file_id, inner_token_id),
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
  attempt_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  session_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vault_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempt_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success     BOOLEAN NOT NULL,
  CONSTRAINT fk_aa_session_s1 FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_dl_file_s1  FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_token_s1 FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  INDEX idx_dl_time      (download_time),
  INDEX idx_dl_file_time (file_id, download_time),
  INDEX idx_dl_token     (inner_token_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expiry_jobs (
  job_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_ej_vault_s1 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_pe_vault_s1 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_pe_integrity_hash (integrity_hash),
  INDEX idx_pe_vault_owner    (vault_id, owner_token_id, status, updated_at),
  INDEX idx_pe_vault_status   (vault_id, status, updated_at)
) ENGINE=InnoDB;

CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);


-- =============================================================================
-- ─── Shard 2 ─────────────────────────────────────────────────────────────────
-- =============================================================================
CREATE DATABASE IF NOT EXISTS ghostdrop_shard_2
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE ghostdrop_shard_2;

CREATE TABLE IF NOT EXISTS shard_meta (
  shard_id   TINYINT  NOT NULL PRIMARY KEY,
  shard_name VARCHAR(32) NOT NULL,
  hex_range  VARCHAR(32) NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO shard_meta VALUES (2, 'shard_2', '0xb-0xf');

CREATE TABLE IF NOT EXISTS vaults (
  vault_id    CHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  outer_token VARCHAR(32)  NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  status      ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inner_tokens (
  inner_token_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_type       ENUM('MAIN','SUB') NOT NULL,
  token_hash       CHAR(64) NOT NULL,
  token_lookup_hash CHAR(64) NULL,
  salt             CHAR(32) NOT NULL,
  key_iterations   INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status           ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT fk_it_vault_s2 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_it_vault_status   (vault_id, status),
  INDEX idx_it_lookup_hash    (token_lookup_hash, vault_id, status)
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
  CONSTRAINT fk_f_vault_s2 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_fm_file_s2 FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  UNIQUE KEY uq_fm_file (file_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_key_access (
  access_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  file_id            CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inner_token_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_file_key CHAR(64) NULL,
  key_wrap_iv        CHAR(24) NULL,
  key_wrap_tag       CHAR(32) NULL,
  key_wrap_salt      CHAR(32) NULL,
  key_wrap_iterations INT NULL,
  key_wrap_version   SMALLINT NULL,
  CONSTRAINT fk_fka_file_s2  FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_fka_token_s2 FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  UNIQUE KEY uq_file_token_s2 (file_id, inner_token_id),
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
  attempt_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  session_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vault_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempt_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success     BOOLEAN NOT NULL,
  CONSTRAINT fk_aa_session_s2 FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_dl_file_s2  FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
  CONSTRAINT fk_dl_token_s2 FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
  INDEX idx_dl_time      (download_time),
  INDEX idx_dl_file_time (file_id, download_time),
  INDEX idx_dl_token     (inner_token_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS expiry_jobs (
  job_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  vault_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_time TIMESTAMP NOT NULL,
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_ej_vault_s2 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
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
  CONSTRAINT fk_pe_vault_s2 FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
  INDEX idx_pe_integrity_hash (integrity_hash),
  INDEX idx_pe_vault_owner    (vault_id, owner_token_id, status, updated_at),
  INDEX idx_pe_vault_status   (vault_id, status, updated_at)
) ENGINE=InnoDB;

CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);
