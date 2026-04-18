// =============================================================================
// GhostDrop  ·  Assignment 4  ·  Shard Demo Script
// demo/shard_demo.js
//
// Demonstrates all Assignment 4 requirements live:
//  1. Routing formula — hex → decimal → mod3 → shard
//  2. INSERT routing  — vault created on correct remote shard
//  3. POINT LOOKUP    — single-shard lookup (no fan-out)
//  4. SCATTER LOOKUP  — outer_token → all 3 shards in parallel
//  5. RANGE QUERY     — cross-shard fan-out + merge sort
//  6. Distribution stats — per-shard vault counts
//  7. Shard identity  — SELECT @@hostname verification
//
// Run:  node demo/shard_demo.js
// Requires: IITGN network access (shards at 10.0.116.184:3307/3308/3309)
// =============================================================================

"use strict";

// Load local app .env for DB_HOST etc, then sharding .env
require("dotenv").config({ path: require("path").join(__dirname, "../../../../Ghost_Drop/backend/.env") });
require("dotenv").config({ path: require("path").join(__dirname, "../.env"), override: false });

const { v4: uuidv4 } = require("uuid");
const {
  getShard, getShardIndex, getAllShards, queryOnShard, SHARDS,
} = require("../config/shardConfig");
const {
  createVaultTransaction, getVaultByOuterToken, getVaultById,
  getVaultsByCreatedAtRange, getExpiredVaultsAcrossAllShards,
} = require("../router/shardRouter");

// ── Console colours ───────────────────────────────────────────────────────────
const CY = "\x1b[36m"; const GR = "\x1b[32m"; const YE = "\x1b[33m";
const RE = "\x1b[31m"; const BO = "\x1b[1m";  const DI = "\x1b[2m"; const RS = "\x1b[0m";

const log  = (m) => console.log(m);
const ok   = (m) => console.log(`${GR}✓${RS} ${m}`);
const info = (m) => console.log(`${CY}→${RS} ${m}`);
const warn = (m) => console.log(`${YE}⚠${RS} ${m}`);
const head = (m) => console.log(`\n${BO}${CY}══ ${m} ══${RS}`);
const sep  = ()  => console.log(DI + "─".repeat(62) + RS);

function makeFakeVaultId(firstHex) {
  return `${firstHex}${uuidv4().slice(1)}`;
}
function makeFakeOuterToken() {
  return ("GD" + Math.random().toString(36).slice(2, 10)).toUpperCase().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
async function runDemo() {
  log(`\n${BO}╔═══════════════════════════════════════════════════════════════╗${RS}`);
  log(`${BO}║  GhostDrop · Dragon Team · Assignment 4 · Sharding Demo       ║${RS}`);
  log(`${BO}║  Shards: 10.0.116.184  :3307  :3308  :3309  DB: Dragon        ║${RS}`);
  log(`${BO}╚═══════════════════════════════════════════════════════════════╝${RS}\n`);

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 1 — Shard Identity (SELECT @@hostname)");
  // ──────────────────────────────────────────────────────────────────────────
  info("Connecting to all 3 remote shard servers...");
  sep();
  for (const shard of getAllShards()) {
    try {
      const rows = await queryOnShard(shard, "SELECT @@hostname AS h, @@port AS p, DATABASE() AS db");
      const r = rows[0];
      ok(`${shard.name} (port ${shard.port}): hostname=${r.h}  port=${r.p}  db=${r.db}`);
    } catch (e) {
      warn(`${shard.name}: ${e.message} — are you on the IITGN network?`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 2 — Shard Routing Formula");
  // ──────────────────────────────────────────────────────────────────────────
  log("Formula:  shardIndex = parseInt(vaultId[0], 16) % 3\n");
  log("vaultId[0]  dec  mod3  →  shard        port");
  sep();
  for (let i = 0; i < 16; i++) {
    const hex   = i.toString(16);
    const mod3  = i % 3;
    const shard = SHARDS[mod3];
    log(`  ${YE}${hex}${RS}           ${String(i).padStart(2)}    ${mod3}   →  ${GR}${shard.name}${RS}  (${shard.host}:${shard.port})`);
  }
  sep();
  const dist = { 0: [], 1: [], 2: [] };
  for (let i = 0; i < 16; i++) dist[i % 3].push(i.toString(16));
  for (const [id, chars] of Object.entries(dist)) {
    log(`  shard_${id}: [${chars.join(",")}]  →  ${((chars.length / 16) * 100).toFixed(1)}% of all UUID v4 vault_ids`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 3 — INSERT Routing (vault_id → correct shard)");
  // ──────────────────────────────────────────────────────────────────────────
  const createdVaults = [];

  for (const targetShardId of [0, 1, 2]) {
    // Pick a first hex digit that maps to targetShardId
    // mod3=0: '0', mod3=1: '1', mod3=2: '2'
    const leadingHex = targetShardId.toString(16);
    const vaultId    = makeFakeVaultId(leadingHex);
    const outerToken = makeFakeOuterToken();

    try {
      const shard = await createVaultTransaction({
        vaultId,
        outerToken,
        expiresInDays: 1,
        innerTokenId: uuidv4(),
        tokenHash: "demo_hash_" + vaultId.slice(0, 8),
        salt: "demo_salt_" + "x".repeat(22),
        keyIterations: 1000,
        tokenLookupHash: null,
      });

      const expected = getShard(vaultId);
      if (shard.id === expected.id) {
        ok(`vault ${vaultId.slice(0,12)}… → ${GR}${shard.name}${RS} (${shard.host}:${shard.port})  [hex='${vaultId[0]}' dec=${parseInt(vaultId[0],16)} mod3=${parseInt(vaultId[0],16)%3}]`);
      } else {
        warn(`Routing mismatch! Expected ${expected.name}, got ${shard.name}`);
      }
      createdVaults.push({ vaultId, outerToken, shardId: shard.id });
    } catch (e) {
      warn(`Insert on shard_${targetShardId}: ${e.message}`);
      createdVaults.push({ vaultId, outerToken, shardId: targetShardId });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 4 — POINT LOOKUP (single-shard, no fan-out)");
  // ──────────────────────────────────────────────────────────────────────────
  for (const { vaultId } of createdVaults) {
    const shard = getShard(vaultId);
    info(`getVaultById("${vaultId.slice(0,12)}…") → ONLY queries ${shard.name} at ${shard.host}:${shard.port}`);
    try {
      const vault = await getVaultById(vaultId);
      if (vault) ok(`Found vault on ${shard.name} — status: ${vault.status}`);
      else       log(`  ${DI}(not found — may have been cleaned up)${RS}`);
    } catch (e) {
      warn(`Lookup failed: ${e.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 5 — SCATTER LOOKUP (outer_token → all 3 shards in parallel)");
  // ──────────────────────────────────────────────────────────────────────────
  if (createdVaults.length > 0) {
    const { outerToken, shardId } = createdVaults[0];
    info(`getVaultByOuterToken("${outerToken}") → Promise.allSettled to all 3 shards`);
    info("Parallel queries: " + getAllShards().map(s => `${s.name}(${s.port})`).join(", "));

    try {
      const vault = await getVaultByOuterToken(outerToken);
      if (vault) {
        ok(`Hit! Found on shard_${getShardIndex(vault.vault_id)} (${SHARDS[getShardIndex(vault.vault_id)].host}:${SHARDS[getShardIndex(vault.vault_id)].port})`);
      } else {
        log(`  ${DI}(not found — scatter still executed on all 3 shards)${RS}`);
      }
    } catch (e) {
      warn(`Scatter failed: ${e.message}`);
    }
    info("Merge: first fulfilled result with non-empty rows wins");
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 6 — RANGE QUERY (cross-shard fan-out + merge sort)");
  // ──────────────────────────────────────────────────────────────────────────
  const start = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0,19).replace("T"," ");
  const end   = new Date().toISOString().slice(0,19).replace("T"," ");

  info(`Range: vaults created between ${start} and ${end}`);
  info("Pattern: same WHERE clause sent to all 3 shards in parallel");
  info("Merge:   results concat → sort by created_at in application layer");

  try {
    const vaults = await getVaultsByCreatedAtRange(start, end, 200);
    ok(`Merged ${vaults.length} vault(s) across all 3 shards (sorted by created_at ASC)`);
    for (const v of vaults.slice(0, 5)) {
      log(`  ${DI}vault_id=${v.vault_id.slice(0,12)}…  shard=${v._shard}  created=${v.created_at}${RS}`);
    }
    if (vaults.length > 5) log(`  ${DI}… and ${vaults.length - 5} more${RS}`);
  } catch (e) {
    warn(`Range query: ${e.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  head("SECTION 7 — Distribution Stats (per remote shard)");
  // ──────────────────────────────────────────────────────────────────────────
  let total = 0;
  const counts = [];
  for (const shard of getAllShards()) {
    try {
      const rows = await queryOnShard(shard, "SELECT COUNT(*) AS cnt FROM vaults");
      const cnt  = Number(rows[0]?.cnt || 0);
      counts.push({ shard, cnt });
      total += cnt;
    } catch (e) {
      counts.push({ shard, cnt: 0 });
      warn(`${shard.name}: ${e.message}`);
    }
  }
  log("\n  Shard       Host:Port             DB      Vaults   %");
  sep();
  for (const { shard, cnt } of counts) {
    const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : "N/A";
    const bar = "█".repeat(Math.round((total > 0 ? cnt / total : 0) * 20));
    log(`  ${shard.name}   ${shard.host}:${shard.port}   ${shard.dbName.padEnd(8)} ${String(cnt).padStart(6)}  ${String(pct).padStart(5)}%  ${CY}${bar}${RS}`);
  }
  log(`  ${"TOTAL".padEnd(54)} ${String(total).padStart(6)}`);

  // ──────────────────────────────────────────────────────────────────────────
  log(`\n${BO}${GR}╔═══════════════════════════════════════════════════════════════╗${RS}`);
  log(`${BO}${GR}║  Demo Complete — Dragon Team · GhostDrop · CS432 Assignment 4 ║${RS}`);
  log(`${BO}${GR}╚═══════════════════════════════════════════════════════════════╝${RS}\n`);
}

runDemo().catch((e) => {
  console.error(`${RE}✗ Demo error:${RS}`, e.message);
  process.exit(1);
});
