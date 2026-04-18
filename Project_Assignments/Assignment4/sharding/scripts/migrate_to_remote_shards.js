// =============================================================================
// GhostDrop  ·  Assignment 4  ·  Remote Shard Migration Script
// scripts/migrate_to_remote_shards.js
//
// Migrates existing data from the local 'ghostdrop_proto' database into the
// three remote shard servers provided by the instructor.
//
//  Source  : localhost:3306  database ghostdrop_proto
//  Shard 0 : 10.0.116.184:3307  database Dragon
//  Shard 1 : 10.0.116.184:3308  database Dragon
//  Shard 2 : 10.0.116.184:3309  database Dragon
//
// Run (from IITGN network):
//   node scripts/migrate_to_remote_shards.js
//
// What it does:
//  1. Reads every vault from local ghostdrop_proto
//  2. Applies sharding formula: shardIndex = parseInt(vault_id[0], 16) % 3
//  3. Copies vault + all child rows to the correct remote shard
//  4. Replicates sessions to all 3 shards (not vault-scoped)
//  5. Inserts shard_meta row on each shard to identify it
//  6. Prints a verification report: source count vs per-shard counts
// =============================================================================

"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../../../../Ghost_Drop/backend/.env") });
require("dotenv").config(); // also load sharding/.env if present

const mysql = require("mysql2/promise");

// ─── Source connection (local) ────────────────────────────────────────────────
const LOCAL_CONFIG = {
  host:     process.env.DB_HOST     || "127.0.0.1",
  port:     Number(process.env.DB_PORT || 3306),
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "ghostdrop_proto",
};

// ─── Remote shard connections ─────────────────────────────────────────────────
const REMOTE_HOST     = process.env.SHARD_HOST     || "10.0.116.184";
const REMOTE_USER     = process.env.SHARD_USER     || "Dragon";
const REMOTE_PASSWORD = process.env.SHARD_PASSWORD || "password@123";
const REMOTE_DB       = process.env.SHARD_DB       || "Dragon";

const SHARD_CONFIGS = [
  { id: 0, host: REMOTE_HOST, port: 3307, user: REMOTE_USER, password: REMOTE_PASSWORD, database: REMOTE_DB, hexDigits: "0,3,6,9,c,f" },
  { id: 1, host: REMOTE_HOST, port: 3308, user: REMOTE_USER, password: REMOTE_PASSWORD, database: REMOTE_DB, hexDigits: "1,4,7,a,d" },
  { id: 2, host: REMOTE_HOST, port: 3309, user: REMOTE_USER, password: REMOTE_PASSWORD, database: REMOTE_DB, hexDigits: "2,5,8,b,e" },
];

// ─── Colours ──────────────────────────────────────────────────────────────────
const G = "\x1b[32m"; const Y = "\x1b[33m"; const R = "\x1b[31m";
const C = "\x1b[36m"; const B = "\x1b[1m";  const D = "\x1b[2m";  const X = "\x1b[0m";

function ok(m)  { console.log(`${G}✓ ${X}${m}`); }
function info(m){ console.log(`${C}→ ${X}${m}`); }
function warn(m){ console.log(`${Y}⚠ ${X}${m}`); }
function err(m) { console.log(`${R}✗ ${X}${m}`); }
function head(m){ console.log(`\n${B}${C}══ ${m} ══${X}`); }

// ─── Shard routing ────────────────────────────────────────────────────────────
function shardIndex(vaultId) {
  return parseInt(vaultId[0].toLowerCase(), 16) % 3;
}

// ─── Safe INSERT IGNORE helper ────────────────────────────────────────────────
async function insertIgnore(conn, table, row) {
  if (!row || Object.keys(row).length === 0) return;
  const cols = Object.keys(row).map(c => `\`${c}\``).join(", ");
  const vals = Object.values(row);
  const placeholders = vals.map(() => "?").join(", ");
  await conn.execute(`INSERT IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`, vals);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}╔══════════════════════════════════════════════════════╗${X}`);
  console.log(`${B}║  GhostDrop · Assignment 4 · Remote Migration Script  ║${X}`);
  console.log(`${B}╚══════════════════════════════════════════════════════╝${X}\n`);

  // ── Connect to local source ────────────────────────────────────────────────
  head("Step 1 — Connecting to local source DB");
  let local;
  try {
    local = await mysql.createConnection(LOCAL_CONFIG);
    ok(`Connected to local ${LOCAL_CONFIG.database}@${LOCAL_CONFIG.host}:${LOCAL_CONFIG.port}`);
  } catch (e) {
    err(`Cannot connect to local DB: ${e.message}`);
    warn("Continuing — will still set up remote shard tables.");
    local = null;
  }

  // ── Connect to remote shards ───────────────────────────────────────────────
  head("Step 2 — Connecting to remote shard servers");
  const shardConns = [];
  for (const cfg of SHARD_CONFIGS) {
    try {
      const conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
      });
      shardConns.push({ id: cfg.id, conn, cfg });
      ok(`shard_${cfg.id} → ${cfg.host}:${cfg.port} (${cfg.database})`);

      // Check identity
      const [[row]] = await conn.execute("SELECT @@hostname AS h, @@port AS p");
      info(`  hostname=${row.h}  port=${row.p}`);
    } catch (e) {
      err(`Cannot connect to shard_${cfg.id} (${cfg.host}:${cfg.port}): ${e.message}`);
      shardConns.push({ id: cfg.id, conn: null, cfg });
    }
  }

  const liveShards = shardConns.filter(s => s.conn !== null);
  if (liveShards.length === 0) {
    err("No remote shards reachable. Are you on the IITGN network?");
    process.exit(1);
  }

  // ── Apply schema on each live shard ───────────────────────────────────────
  head("Step 3 — Applying schema on remote shards");
  for (const { id, conn, cfg } of liveShards) {
    try {
      // shard_meta
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS shard_meta (
          shard_id   TINYINT     NOT NULL PRIMARY KEY,
          shard_name VARCHAR(32) NOT NULL,
          port       SMALLINT    NOT NULL,
          hex_digits VARCHAR(64) NOT NULL,
          team_name  VARCHAR(64) NOT NULL DEFAULT 'Dragon'
        ) ENGINE=InnoDB
      `);
      await conn.execute(
        `INSERT INTO shard_meta (shard_id, shard_name, port, hex_digits, team_name)
         VALUES (?, ?, ?, ?, 'Dragon')
         ON DUPLICATE KEY UPDATE port=VALUES(port), hex_digits=VALUES(hex_digits)`,
        [id, `shard_${id}`, cfg.port, cfg.hexDigits]
      );

      // Core tables
      await conn.execute(`CREATE TABLE IF NOT EXISTS vaults (
        vault_id    CHAR(36)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        outer_token VARCHAR(32)  NOT NULL UNIQUE,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP NOT NULL,
        status      ENUM('ACTIVE','EXPIRED','DELETED') NOT NULL DEFAULT 'ACTIVE'
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS inner_tokens (
        inner_token_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        vault_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        token_type        ENUM('MAIN','SUB') NOT NULL,
        token_hash        CHAR(64) NOT NULL,
        token_lookup_hash CHAR(64) NULL,
        salt              CHAR(32) NOT NULL,
        key_iterations    INT NOT NULL,
        created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status            ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
        CONSTRAINT fk_it_vault_s${id} FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        INDEX idx_it_vault_status (vault_id, status),
        INDEX idx_it_lookup_hash  (token_lookup_hash, vault_id, status)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS files (
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
        CONSTRAINT fk_f_vault_s${id} FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        INDEX idx_files_vault_status (vault_id, status, created_at),
        INDEX idx_files_deleted_at   (deleted_at)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS file_metadata (
        metadata_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        file_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        relative_path     VARCHAR(512) NULL,
        mime_type         VARCHAR(100) NOT NULL,
        file_size         BIGINT NOT NULL,
        uploaded_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_fm_file_s${id} FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
        UNIQUE KEY uq_fm_file (file_id)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS file_key_access (
        access_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        file_id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        inner_token_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        encrypted_file_key  CHAR(64) NULL,
        key_wrap_iv         CHAR(24) NULL,
        key_wrap_tag        CHAR(32) NULL,
        key_wrap_salt       CHAR(32) NULL,
        key_wrap_iterations INT NULL,
        key_wrap_version    SMALLINT NULL,
        CONSTRAINT fk_fka_file_s${id}  FOREIGN KEY (file_id)        REFERENCES files(file_id)        ON DELETE CASCADE,
        CONSTRAINT fk_fka_token_s${id} FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
        UNIQUE KEY uq_file_token (file_id, inner_token_id),
        INDEX idx_fka_token (inner_token_id)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS sessions (
        session_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        ip_address    VARCHAR(45) NOT NULL,
        user_agent    TEXT NOT NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP NULL,
        INDEX idx_sessions_ip_created (ip_address, created_at)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS auth_attempts (
        attempt_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        session_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        vault_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
        attempt_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        success      BOOLEAN NOT NULL,
        CONSTRAINT fk_aa_session_s${id} FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        INDEX idx_aa_time        (attempt_time),
        INDEX idx_aa_vault_time  (vault_id, attempt_time),
        INDEX idx_aa_session_time(session_id, attempt_time, success)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS download_logs (
        download_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        file_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        inner_token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        session_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
        download_time  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_dl_file_s${id}  FOREIGN KEY (file_id)        REFERENCES files(file_id) ON DELETE CASCADE,
        CONSTRAINT fk_dl_token_s${id} FOREIGN KEY (inner_token_id) REFERENCES inner_tokens(inner_token_id) ON DELETE CASCADE,
        INDEX idx_dl_time      (download_time),
        INDEX idx_dl_file_time (file_id, download_time),
        INDEX idx_dl_token     (inner_token_id)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS expiry_jobs (
        job_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        vault_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        scheduled_time TIMESTAMP NOT NULL,
        processed      BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT fk_ej_vault_s${id} FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        UNIQUE KEY uq_ej_vault (vault_id),
        INDEX idx_ej_sched (processed, scheduled_time)
      ) ENGINE=InnoDB`);

      await conn.execute(`CREATE TABLE IF NOT EXISTS portfolio_entries (
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
        CONSTRAINT fk_pe_vault_s${id} FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE,
        INDEX idx_pe_integrity_hash (integrity_hash),
        INDEX idx_pe_vault_owner    (vault_id, owner_token_id, status, updated_at),
        INDEX idx_pe_vault_status   (vault_id, status, updated_at)
      ) ENGINE=InnoDB`);

      // Create composite index separately (may already exist if run twice)
      try {
        await conn.execute(`CREATE INDEX idx_vault_expiry ON vaults(status, expires_at)`);
      } catch (_) { /* already exists */ }

      ok(`shard_${id}: schema applied`);
    } catch (e) {
      warn(`shard_${id}: schema error — ${e.message}`);
    }
  }

  // ── Migrate data ──────────────────────────────────────────────────────────
  if (!local) {
    warn("Skipping data migration (local DB not available).");
  } else {
    head("Step 4 — Migrating data from local ghostdrop_proto → remote shards");

    // --- Sessions (replicate to all shards) ---
    info("Migrating sessions to all shards...");
    const [sessions] = await local.execute("SELECT * FROM sessions");
    let sessionCount = 0;
    for (const s of sessions) {
      for (const { conn } of liveShards) {
        await insertIgnore(conn, "sessions", s);
      }
      sessionCount++;
    }
    ok(`Replicated ${sessionCount} session(s) to ${liveShards.length} shards`);

    // --- Vaults + child rows ---
    info("Loading vaults from local DB...");
    const [vaults] = await local.execute("SELECT * FROM vaults ORDER BY created_at ASC");
    info(`Found ${vaults.length} vault(s) in local ghostdrop_proto`);

    const counts = { 0: 0, 1: 0, 2: 0 };
    let migrated = 0;
    let errors   = 0;

    for (const vault of vaults) {
      const idx  = shardIndex(vault.vault_id);
      const dest = shardConns.find(s => s.id === idx);

      if (!dest || !dest.conn) {
        warn(`shard_${idx} unreachable — skipping vault ${vault.vault_id}`);
        errors++;
        continue;
      }

      try {
        // vault
        await insertIgnore(dest.conn, "vaults", vault);

        // inner_tokens
        const [tokens] = await local.execute(
          "SELECT * FROM inner_tokens WHERE vault_id = ?", [vault.vault_id]);
        for (const t of tokens) await insertIgnore(dest.conn, "inner_tokens", t);

        // files
        const [files] = await local.execute(
          "SELECT * FROM files WHERE vault_id = ?", [vault.vault_id]);
        for (const f of files) {
          await insertIgnore(dest.conn, "files", f);

          // file_metadata
          const [fm] = await local.execute(
            "SELECT * FROM file_metadata WHERE file_id = ?", [f.file_id]);
          for (const m of fm) await insertIgnore(dest.conn, "file_metadata", m);

          // file_key_access
          const [fka] = await local.execute(
            "SELECT * FROM file_key_access WHERE file_id = ?", [f.file_id]);
          for (const a of fka) await insertIgnore(dest.conn, "file_key_access", a);
        }

        // expiry_jobs
        const [ej] = await local.execute(
          "SELECT * FROM expiry_jobs WHERE vault_id = ?", [vault.vault_id]);
        for (const j of ej) await insertIgnore(dest.conn, "expiry_jobs", j);

        // portfolio_entries
        const [pe] = await local.execute(
          "SELECT * FROM portfolio_entries WHERE vault_id = ?", [vault.vault_id]);
        for (const p of pe) await insertIgnore(dest.conn, "portfolio_entries", p);

        // auth_attempts
        const [aa] = await local.execute(
          "SELECT * FROM auth_attempts WHERE vault_id = ?", [vault.vault_id]);
        for (const a of aa) await insertIgnore(dest.conn, "auth_attempts", a);

        counts[idx]++;
        migrated++;
      } catch (e) {
        err(`Error migrating vault ${vault.vault_id}: ${e.message}`);
        errors++;
      }
    }

    head("Step 5 — Migration Report");
    console.log(`  Source vaults      : ${vaults.length}`);
    console.log(`  Successfully moved : ${migrated}`);
    console.log(`  Errors             : ${errors}`);
    console.log(`  shard_0 (port 3307): ${counts[0]} vaults`);
    console.log(`  shard_1 (port 3308): ${counts[1]} vaults`);
    console.log(`  shard_2 (port 3309): ${counts[2]} vaults`);
    console.log(`  Total on shards    : ${counts[0] + counts[1] + counts[2]}`);
    const match = counts[0] + counts[1] + counts[2] === vaults.length - errors;
    if (match && errors === 0) {
      ok("INTEGRITY CHECK PASSED — all vault counts match");
    } else {
      warn(`INTEGRITY CHECK: ${errors} error(s) — review above`);
    }
  }

  // ── Verification: count rows per shard ────────────────────────────────────
  head("Step 6 — Verification (row counts per shard)");
  for (const { id, conn, cfg } of liveShards) {
    try {
      const [[{ cnt }]] = await conn.execute("SELECT COUNT(*) AS cnt FROM vaults");
      ok(`shard_${id} (${cfg.host}:${cfg.port}): ${cnt} vault(s)`);

      // Also print shard_meta to confirm identity
      const [meta] = await conn.execute("SELECT * FROM shard_meta");
      if (meta.length > 0) {
        const m = meta[0];
        info(`  Identity: shard_id=${m.shard_id} port=${m.port} hex_digits=[${m.hex_digits}] team=${m.team_name}`);
      }
    } catch (e) {
      warn(`shard_${id}: could not count — ${e.message}`);
    }
  }

  // ── Close all connections ─────────────────────────────────────────────────
  if (local) await local.end();
  for (const { conn } of shardConns) {
    if (conn) await conn.end().catch(() => {});
  }

  console.log(`\n${B}${G}Migration complete.${X}\n`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
