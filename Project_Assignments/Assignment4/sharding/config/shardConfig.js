// =============================================================================
// GhostDrop  ·  Assignment 4  ·  Shard Configuration
// config/shardConfig.js
//
// Connects to the THREE REAL remote shard servers provided by the instructor.
//
//  HOST : 10.0.116.184  (only reachable from IITGN network)
//  Team : Dragon
//  Shard 0 → port 3307   database: Dragon
//  Shard 1 → port 3308   database: Dragon
//  Shard 2 → port 3309   database: Dragon
//
// Routing formula
// ───────────────
//   shardIndex = parseInt(vaultId[0], 16) % 3
//
// Environment overrides (add to .env to change without editing this file):
//   SHARD_HOST         default 10.0.116.184
//   SHARD_USER         default Dragon
//   SHARD_PASSWORD     default password@123
//   SHARD_DB           default Dragon
//   SHARD_0_PORT       default 3307
//   SHARD_1_PORT       default 3308
//   SHARD_2_PORT       default 3309
// =============================================================================

"use strict";

require("dotenv").config();
const mysql = require("mysql2/promise");

// ─── Remote shard credentials ─────────────────────────────────────────────────
const SHARD_HOST     = process.env.SHARD_HOST     || "10.0.116.184";
const SHARD_USER     = process.env.SHARD_USER     || "Dragon";
const SHARD_PASSWORD = process.env.SHARD_PASSWORD || "password@123";
const SHARD_DB       = process.env.SHARD_DB       || "Dragon";

// ─── Connection pool factory ──────────────────────────────────────────────────
function makePool({ host, port, user, password, database }) {
  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    connectTimeout:     15_000,
  });
}

// ─── Three physical shard descriptors ────────────────────────────────────────
// Each shard is a SEPARATE MySQL SERVER (physical sharding).
// All three use the same database name "Dragon" but run on different ports,
// simulating distinct nodes as required by Assignment4_Shard_details.pdf.
const SHARDS = [
  {
    id:       0,
    name:     "shard_0",
    host:     process.env.SHARD_0_HOST || SHARD_HOST,
    port:     Number(process.env.SHARD_0_PORT || 3307),
    dbName:   SHARD_DB,
    user:     SHARD_USER,
    password: SHARD_PASSWORD,
    hexRange: "mod3=0  {0,3,6,9,c,f}",
    pool:     null,
  },
  {
    id:       1,
    name:     "shard_1",
    host:     process.env.SHARD_1_HOST || SHARD_HOST,
    port:     Number(process.env.SHARD_1_PORT || 3308),
    dbName:   SHARD_DB,
    user:     SHARD_USER,
    password: SHARD_PASSWORD,
    hexRange: "mod3=1  {1,4,7,a,d}",
    pool:     null,
  },
  {
    id:       2,
    name:     "shard_2",
    host:     process.env.SHARD_2_HOST || SHARD_HOST,
    port:     Number(process.env.SHARD_2_PORT || 3309),
    dbName:   SHARD_DB,
    user:     SHARD_USER,
    password: SHARD_PASSWORD,
    hexRange: "mod3=2  {2,5,8,b,e}",
    pool:     null,
  },
];

// Lazy pool init (avoids connecting during import in test env)
let poolsInitialised = false;

function initPools() {
  if (poolsInitialised) return;
  for (const shard of SHARDS) {
    shard.pool = makePool({
      host:     shard.host,
      port:     shard.port,
      user:     shard.user,
      password: shard.password,
      database: shard.dbName,
    });
  }
  poolsInitialised = true;
}

// ─── Core routing function ────────────────────────────────────────────────────
/**
 * getShard(vaultId) → ShardDescriptor
 *
 * Shard key : vault_id  (UUID v4 — first character is always a hex digit 0–f)
 * Formula   : shardIndex = parseInt(vaultId[0], 16) % 3
 *
 * Distribution:
 *   shard_0 (port 3307) – digits {0,3,6,9,c,f} → 6/16 = 37.5 %
 *   shard_1 (port 3308) – digits {1,4,7,a,d}   → 5/16 = 31.25 %
 *   shard_2 (port 3309) – digits {2,5,8,b,e}   → 5/16 = 31.25 %
 */
function getShard(vaultId) {
  if (!vaultId || typeof vaultId !== "string" || vaultId.length < 8) {
    throw new Error(`Invalid vaultId for shard routing: "${vaultId}"`);
  }
  initPools();
  const firstHex = vaultId[0].toLowerCase();
  const decimal  = parseInt(firstHex, 16);   // 0–15
  const idx      = decimal % 3;              // 0, 1, or 2
  return SHARDS[idx];
}

/** Returns just the shard index (0|1|2) */
function getShardIndex(vaultId) {
  return getShard(vaultId).id;
}

/** Returns all three shard descriptors — for fan-out queries */
function getAllShards() {
  initPools();
  return [...SHARDS];
}

/** Thin helper: run a parameterised query on a specific shard pool */
async function queryOnShard(shard, sql, params = []) {
  const [rows] = await shard.pool.execute(sql, params);
  return rows;
}

/** Get a raw pool connection (for manual transactions) */
async function getConnectionOnShard(shard) {
  return shard.pool.getConnection();
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  getShard,
  getShardIndex,
  getAllShards,
  queryOnShard,
  getConnectionOnShard,
  SHARDS,
};
