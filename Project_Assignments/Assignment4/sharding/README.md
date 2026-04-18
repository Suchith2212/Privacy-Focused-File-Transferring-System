# GhostDrop — Assignment 4: Distributed Database Sharding
## CS432 · IIT Gandhinagar · Track 1

---

## Scalability Report & Design Rationale

---

## 1. Shard Key Selection

### Selected: `vault_id` (UUID v4)

**Justification:**

| Criterion | vault_id | Score |
|---|---|---|
| **Cardinality** | UUID v4 — 2¹²² unique values; effectively infinite | ★★★★★ |
| **Stability** | Never mutated after INSERT (immutable PK) | ★★★★★ |
| **Query alignment** | Every API call resolves to a vault_id within 1 hop | ★★★★★ |
| **Co-location** | All child rows (files, tokens, logs) carry vault_id | ★★★★★ |

**Why this beats alternatives:**

#### Alternative A — `outer_token` (rejected)
- `outer_token` is a user-readable 32-char string used at the HTTP layer.
- It has high cardinality, but it is **not carried by child rows**. Files, inner_tokens, and download_logs all reference `vault_id`, not `outer_token`.
- Routing on `outer_token` would require a **secondary lookup** for every child-row operation, adding latency and a cross-shard dependency.
- Verdict: ❌ Query-misaligned.

#### Alternative B — `created_at` (Range-based, rejected)
- Range partitioning on `created_at` is superficially appealing because date ranges are common in analytics queries.
- **Hot spot problem**: All new writes land on the "latest" shard. The newest shard gets 100% of write traffic while older shards become cold — classic monotonic key problem (same issue as auto-increment PKs).
- **Rebalancing cost**: When time passes, you must migrate the old "latest" shard and add a new one — operationally expensive.
- Verdict: ❌ Creates unbounded write hot-spot.

#### Alternative C — `status` (rejected)
- Only 3 values (`ACTIVE`, `EXPIRED`, `DELETED`) — extremely low cardinality.
- Almost all vaults start as `ACTIVE`, so this sends the overwhelming majority of reads and writes to one shard.
- Verdict: ❌ Catastrophically low cardinality; immediate hot-shard problem.

---

## 2. Partitioning Strategy

### Selected: **Hash-based partitioning**

**Formula:**
```
shardIndex = parseInt(vaultId[0], 16) % 3
```

**Step-by-step:**
```
vaultId     = "7e2c1234-abcd-4000-8000-aabbccddeeff"
vaultId[0]  = '7'
parseInt('7', 16) = 7
7 % 3 = 1   →   shard_1
```

**Full mapping (all 16 hex digits):**

| Hex | Dec | mod 3 | Shard |
|-----|-----|-------|-------|
| 0 | 0 | 0 | shard_0 |
| 1 | 1 | 1 | shard_1 |
| 2 | 2 | 2 | shard_2 |
| 3 | 3 | 0 | shard_0 |
| 4 | 4 | 1 | shard_1 |
| 5 | 5 | 2 | shard_2 |
| 6 | 6 | 0 | shard_0 |
| 7 | 7 | 1 | shard_1 |
| 8 | 8 | 2 | shard_2 |
| 9 | 9 | 0 | shard_0 |
| a | 10 | 1 | shard_1 |
| b | 11 | 2 | shard_2 |
| c | 12 | 0 | shard_0 |
| d | 13 | 1 | shard_1 |
| e | 14 | 2 | shard_2 |
| f | 15 | 0 | shard_0 |

**Expected distribution:**
- shard_0: digits {0,3,6,9,c,f} → 6/16 = **37.5%**
- shard_1: digits {1,4,7,a,d}   → 5/16 = **31.25%**
- shard_2: digits {2,5,8,b,e}   → 5/16 = **31.25%**

The slight imbalance toward shard_0 (2 extra digits) can be corrected with virtual-node remapping (e.g., assigning digit `c` → shard_1 and `f` → shard_2) if load imbalance is observed in production.

**Why not range partitioning?**
- Range on `vault_id` would send `0x0…–0x5…` entirely to shard_0, but UUID v4 is random — distribution would be uniform regardless. However, range partitioning means range queries on vault_id still require fan-out (vault_id is not a monotonic range query target). The formula simplicity advantage disappears.

**Why not directory/lookup table partitioning?**
- A directory table adds a single-node bottleneck (the directory server) and an extra RTT for every operation. For this application, the shard key is stable and computable from the vault_id alone — a directory provides zero benefit while adding latency and a new failure mode.

---

## 3. Data Distribution

### Three Logical Shards

```
ghostdrop_shard_0   (MySQL database)   → vaults whose vault_id[0] ∈ {0,3,6,9,c,f}
ghostdrop_shard_1   (MySQL database)   → vaults whose vault_id[0] ∈ {1,4,7,a,d}
ghostdrop_shard_2   (MySQL database)   → vaults whose vault_id[0] ∈ {2,5,8,b,e}
```

### Co-location Strategy

Every child table row carries `vault_id` as a non-null FK column. The router uses `vault_id` from that column to select the parent shard. This guarantees:

1. **No cross-shard JOINs** — all tables for a vault live on one database.
2. **Intra-shard ACID** — transactions spanning vault → inner_tokens → files are single-database transactions. No 2PC required.
3. **O(1) indexed lookups** — all FK columns have B+ tree indexes; these remain intact per-shard.

### Sessions Table

`sessions` is NOT vault-scoped (it stores IP/user-agent for rate-limiting). It is **replicated to all three shards** during migration. New session inserts are written to all three shards (fan-out write). This is acceptable because:
- Sessions are small (one row per request session, TTL ~1 day).
- Replicated write cost is trivial vs. the complexity of a separate coordinator.

---

## 4. Query Routing

### 4.1 Insert Routing

```
Insert vault  → getShard(newVaultId) → write to shard_N
Insert file   → getShard(file.vaultId) → same shard as vault
Insert token  → getShard(token.vaultId) → same shard as vault
```

All inserts are O(1) routing decisions. No broadcast.

### 4.2 Point Lookup (known vaultId)

```
getVaultById(vaultId)
  → shardIndex = parseInt(vaultId[0], 16) % 3
  → queryOnShard(SHARDS[shardIndex], "SELECT … WHERE vault_id = ?")
  → return row
```

Single-shard query. No fan-out.

### 4.3 Scatter Lookup (outer_token → unknown vaultId)

```
getVaultByOuterToken(outerToken)
  → queries = [query(shard_0), query(shard_1), query(shard_2)]
  → results = await Promise.allSettled(queries)
  → return first non-empty result
```

Fan-out to all three shards **in parallel**. Latency = max(shard_0, shard_1, shard_2), NOT sum. After the first call resolves the vaultId, all subsequent calls in the same request use single-shard routing.

### 4.4 Range Query (cross-shard)

```
getVaultsByCreatedAtRange(start, end, limit)
  → for each shard: SELECT … WHERE created_at BETWEEN start AND end
  → results = await Promise.allSettled(perShardQueries)
  → merged = concat all result arrays
  → merged.sort((a,b) => a.created_at - b.created_at)
  → return merged.slice(0, limit)
```

Scatter-gather pattern. The application layer performs the merge sort — this is the standard approach used by Vitess, Cassandra, and MongoDB sharding.

---

## 5. Integration with Existing System

### What changed in the route layer (`routes/vaults.js`)

| Old call | New call | Reason |
|---|---|---|
| `query("SELECT … FROM vaults WHERE outer_token = ?")` | `getVaultByOuterToken(outerToken)` | Fan-out scatter |
| `query("INSERT INTO vaults …")` | `createVaultTransaction({ vaultId, … })` | Routes to correct shard |
| `query("SELECT … FROM inner_tokens …")` | `getInnerTokensByVault(vaultId, hash)` | Single-shard, uses existing B+ tree index |
| `getConnection()` + manual transaction | `createSubTokenTransaction({ … })` | Wrapped in shard-aware transaction helper |

### B+ Tree Indexes — preserved

All existing indexes are created identically on each shard:
- `idx_it_lookup_hash (token_lookup_hash, vault_id, status)` — used by inner token lookups
- `idx_files_vault_status (vault_id, status, created_at)` — used by file list queries
- `idx_vault_expiry (status, expires_at)` — used by expiry daemon

Because each shard holds a subset of the data, each index is **smaller** than the original monolithic index — queries that formerly needed to scan 100K rows now scan ~33K rows per shard.

### `.env` changes

Add to `Ghost_Drop/backend/.env`:
```
SHARD_HOST=127.0.0.1
SHARD_PORT=3306
SHARD_USER=root
SHARD_PASSWORD=your_mysql_password
```

All three shards run on the same MySQL instance (logical sharding). To move to physical sharding (separate machines), change `SHARD_HOST_{0,1,2}` per shard.

---

## 6. Edge Cases & Production Hardening

### 6.1 Skewed Data Distribution

**Problem**: UUID v4 first digit `0,3,6,9,c,f` all map to shard_0, giving it 37.5% vs 31.25% per shard.

**Mitigation (immediate)**: Reassign two digits to balance:
- Remap `c → 1` and `f → 2` in `getShard()`.
- Updated `shardConfig.js` to use a lookup table instead of pure modulo.

**Mitigation (long-term)**: Virtual nodes — each physical shard "owns" multiple virtual buckets, and the mapping table allows arbitrary reassignment without data movement.

### 6.2 Hot Shard Problem

**Problem**: If a particular vault becomes extremely popular (e.g., a file shared virally), it monopolises one shard's I/O.

**Mitigation**:
1. **Read replicas**: Add MySQL replicas per shard; direct read-only queries (file list, public-info) to replicas.
2. **Read-through cache**: Cache `getVaultByOuterToken` in Redis with a 30-second TTL. The outer_token scatter becomes a cache hit on the next N requests.
3. **Download log buffering**: Instead of writing a `download_logs` row per download, buffer in Redis and flush in batches to reduce write pressure on the hot shard.

### 6.3 Shard Failure

**Behaviour**: If shard_1 is unavailable:
- `getVaultByOuterToken` uses `Promise.allSettled()` — the failing shard returns a rejected promise; the remaining two shards' results are still returned.
- `getExpiredVaultsAcrossAllShards` explicitly catches errors per-shard and logs a warning, returning partial results.
- Vaults on the failed shard return 503. Vaults on healthy shards continue operating normally.

**Recovery**: MySQL replication (primary + replica per shard) allows automatic failover. When the shard recovers, it replays from the binary log.

### 6.4 Rebalancing (Adding Shard 3)

**Steps (zero-downtime approach)**:
1. Create new database `ghostdrop_shard_3`.
2. Update routing formula to `% 4` in a new version of `shardConfig.js`.
3. Run background migration: for each vault currently on shard_N that should move to shard_3 under the new formula, copy rows to shard_3 **while the old shard still accepts writes**.
4. Dual-write period: writes go to both old and new shard.
5. Flip the router to the new formula; stop dual-writes; delete migrated rows from old shards.

This is the same approach used by Amazon DynamoDB and Cassandra for live rebalancing.

---

## 7. Scalability Analysis

### 7.1 Horizontal vs. Vertical Scaling

| Dimension | Vertical (scale-up) | Horizontal (sharding) |
|---|---|---|
| Mechanism | Larger CPU/RAM/SSD | More database nodes |
| Cost | Exponential (cloud pricing) | Linear |
| Ceiling | Hard limit (max instance size) | Effectively unlimited |
| Complexity | Simple (no code change) | Requires routing layer |
| Fault tolerance | Single point of failure | Isolated failures per shard |
| **Verdict** | Appropriate up to ~5M rows | Required beyond that point |

GhostDrop uses vertical scaling (single MySQL instance) in Assignments 1–3. Assignment 4 introduces horizontal scaling via logical sharding as the next step on the scaling ladder.

### 7.2 CAP Theorem Analysis

GhostDrop's sharding design prioritises **Consistency + Availability (CA)** within each shard, accepting reduced **Partition Tolerance**:

| Property | Behaviour in GhostDrop Sharding |
|---|---|
| **Consistency (C)** | Strong consistency within a shard — intra-shard transactions are serialisable via MySQL InnoDB. Cross-shard operations (e.g., scatter lookup) are eventually consistent only in the sense that a shard failure may return a partial result. |
| **Availability (A)** | High — `Promise.allSettled()` for scatter queries means partial shard failures do not bring down the entire system. Vaults on healthy shards continue to work. |
| **Partition Tolerance (P)** | **Limited** — if a network partition splits shard_N from the application, vaults on that shard become unavailable. This is the standard CP/AP tradeoff for single-primary relational databases. Adding MySQL Group Replication or Galera Cluster per shard upgrades to full PA. |

### 7.3 Consistency Guarantees by Operation

| Operation | Consistency Model | Notes |
|---|---|---|
| Vault creation | **Strong (ACID)** | Single-shard transaction |
| File upload | **Strong (ACID)** | Single-shard transaction |
| Vault access | **Strong (ACID)** | Single-shard read |
| outer_token lookup | **Read-your-writes** | scatter + take first; DB must have committed before client retries |
| Range query (created_at) | **Eventual** | Cross-shard merge; each shard is consistent in isolation |
| Session replication | **Eventual** | Fan-out write; a shard may briefly lag |

### 7.4 Throughput Projection

With 3 shards:
- **Write throughput**: ~3× monolithic (each shard handles 1/3 of vaults independently).
- **Read throughput**: ~3× for point lookups. Scatter reads still hit all 3 shards.
- **Storage**: Proportional to data size; each shard holds ~1/3 of rows.

### 7.5 Real-World Tradeoffs

| Decision | Cost | Benefit |
|---|---|---|
| Hash over range | Range queries require fan-out | No write hot-spot; uniform distribution |
| vault_id as shard key | outer_token lookups scatter | All other operations are single-shard |
| Logical sharding (same host) | No physical isolation | Easy to set up; can migrate to physical later |
| No 2PC | Cross-shard atomicity not guaranteed | Eliminates distributed deadlock; simplifies code |
| Scatter inner_token lookup | 3× query overhead | Only occurs when outer_token is the entry point (first request); subsequent requests use vault_id directly |

---

## 8. Demo Plan

### What to show

1. **Routing formula** (Section 1 of `shard_demo.js`)
   - Print the full hex → decimal → mod3 → shard mapping table live.

2. **INSERT routing** (Section 2)
   - Create one vault per shard by crafting vault_ids with specific leading hex digits.
   - Show: `vault_id[0] = '2' → parseInt('2',16) = 2 → 2%3 = 2 → shard_2`.

3. **Point lookup** (Section 3)
   - `getVaultById(vaultId)` — show it queries ONLY one shard (no fan-out).
   - Highlight this in logs: `"queries ONLY shard_1"`.

4. **Scatter lookup** (Section 4)
   - `getVaultByOuterToken("ABCD1234")` — show all 3 shards queried in parallel.
   - Show the `Promise.allSettled` approach: `"Parallel queries issued to: shard_0, shard_1, shard_2"`.

5. **Range query + merge** (Section 5)
   - `getVaultsByCreatedAtRange(last7days)` — fan out to 3 shards, merge by `created_at`.
   - Show: `"Merged N vault(s) across all shards (sorted by created_at)"`.

6. **Distribution stats** (Section 6)
   - Show per-shard vault counts and the percentage bar chart.

7. **Migration** (show SQL output)
   - Run `migrate_to_shards.sql` — show the integrity check: `"PASS - row counts match"`.

### Example queries to run live

```sql
-- Demonstrate shard formula
SELECT vault_id,
       CONV(SUBSTR(vault_id, 1, 1), 16, 10) AS decimal_val,
       CONV(SUBSTR(vault_id, 1, 1), 16, 10) % 3 AS shard_index
FROM ghostdrop_proto.vaults
LIMIT 10;

-- Per-shard vault counts
SELECT 'shard_0' AS shard, COUNT(*) AS vault_count FROM ghostdrop_shard_0.vaults
UNION ALL
SELECT 'shard_1', COUNT(*) FROM ghostdrop_shard_1.vaults
UNION ALL
SELECT 'shard_2', COUNT(*) FROM ghostdrop_shard_2.vaults;

-- Range query on a single shard (no fan-out needed for single-shard range)
SELECT vault_id, created_at, expires_at
FROM ghostdrop_shard_1.vaults
WHERE created_at BETWEEN '2025-01-01' AND '2026-12-31'
ORDER BY created_at ASC;

-- Cross-shard range (run same query on each shard, merge manually)
-- shard_0:
SELECT vault_id, created_at, 'shard_0' AS shard FROM ghostdrop_shard_0.vaults WHERE created_at > NOW() - INTERVAL 7 DAY
UNION ALL
SELECT vault_id, created_at, 'shard_1' FROM ghostdrop_shard_1.vaults WHERE created_at > NOW() - INTERVAL 7 DAY
UNION ALL
SELECT vault_id, created_at, 'shard_2' FROM ghostdrop_shard_2.vaults WHERE created_at > NOW() - INTERVAL 7 DAY
ORDER BY created_at ASC;
```

```bash
# Run the automated demo
cd Project_Assignments/Assignment4/sharding
node demo/shard_demo.js

# Run unit tests
npx jest tests/shardRouter.test.js
```

---

## 9. Folder Structure

```
Project_Assignments/
└── Assignment4/
    ├── Track1_assignment4.pdf          ← Assignment brief
    ├── Assignment4_Shard_details.pdf   ← Reference PDF
    └── sharding/
        ├── package.json
        ├── README.md                   ← This file (report)
        ├── config/
        │   └── shardConfig.js          ← Pool setup + getShard() routing function
        ├── router/
        │   ├── shardRouter.js          ← All shard-aware DB operations
        │   └── shardedVaults.js        ← Drop-in sharded replacement for vaults.js
        ├── sql/
        │   ├── shard_schema.sql        ← Creates ghostdrop_shard_{0,1,2} databases
        │   └── migrate_to_shards.sql   ← Migrates ghostdrop_proto → shards
        ├── demo/
        │   └── shard_demo.js           ← Interactive demo (run for video)
        └── tests/
            └── shardRouter.test.js     ← Jest unit tests (routing logic)

Ghost_Drop/backend/src/
├── config/db.js                        ← Original single-DB pool (unchanged)
├── routes/vaults.js                    ← Original routes (unchanged)
└── routes/files.js                     ← Original routes (unchanged)
```

**Integration path**: Replace `require("../config/db")` calls in `vaults.js` and `files.js` with calls to `shardRouter.js`. The `shardedVaults.js` file demonstrates this pattern completely.

---

## Setup Instructions

```bash
# 1. Create shard databases
mysql -u root -p < sharding/sql/shard_schema.sql

# 2. Migrate existing data
mysql -u root -p ghostdrop_proto < sharding/sql/migrate_to_shards.sql

# 3. Install dependencies
cd sharding && npm install

# 4. Run demo
node demo/shard_demo.js

# 5. Run unit tests
npx jest tests/shardRouter.test.js
```
