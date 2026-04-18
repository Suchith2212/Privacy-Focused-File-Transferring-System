# GhostDrop · Assignment 4 · Sharding — Delivery Walkthrough

## ✅ Test Results: 28/28 Passed

All routing-logic unit tests pass without a live database (Jest + mysql2 mock).

---

## Deliverables

| # | Deliverable | File |
|---|---|---|
| 1 | Shard schema (3 databases) | `sharding/sql/shard_schema.sql` |
| 2 | Migration script | `sharding/sql/migrate_to_shards.sql` |
| 3 | Shard config + routing function | `sharding/config/shardConfig.js` |
| 4 | Query router (all operations) | `sharding/router/shardRouter.js` |
| 5 | Sharded API routes (drop-in) | `sharding/router/shardedVaults.js` |
| 6 | Interactive demo | `sharding/demo/shard_demo.js` |
| 7 | Unit tests | `sharding/tests/shardRouter.test.js` |
| 8 | Full report (CAP, edge cases, demo plan) | `sharding/README.md` |

---

## Architecture Summary

```
                ┌──────────────────────────────────┐
                │         Express API Layer         │
                │      (shardedVaults.js)           │
                └────────────┬─────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  shardRouter.js  │  ← All DB operations
                    │ (query router)   │
                    └──┬──────┬─────┬──┘
        getShard(vid)  │      │     │  scatter / fan-out
                       ▼      ▼     ▼
               ┌──────────┐┌──────────┐┌──────────┐
               │ shard_0  ││ shard_1  ││ shard_2  │
               │0x0-0x5   ││0x6-0xa   ││0xb-0xf   │
               │(37.5%)   ││(31.25%)  ││(31.25%)  │
               └──────────┘└──────────┘└──────────┘
```

---

## Shard Key & Routing Formula

**Shard key**: `vault_id` (UUID v4)  
**Formula**: `shardIndex = parseInt(vaultId[0], 16) % 3`

| Operation | Strategy | Shards hit |
|---|---|---|
| Create vault | Single shard (hash of new vault_id) | 1 |
| Lookup by vault_id | Single shard (hash) | 1 |
| Lookup by outer_token | Parallel scatter | 3 |
| Range by created_at | Fan-out + app-layer merge sort | 3 |
| Child row insert (file, token) | Same shard as parent vault | 1 |

---

## How to Run

```bash
# 1. Create shard databases
mysql -u root -p < sharding/sql/shard_schema.sql

# 2. Migrate existing data
mysql -u root -p ghostdrop_proto < sharding/sql/migrate_to_shards.sql

# 3. Install deps
cd Project_Assignments/Assignment4/sharding && npm install

# 4. Run demo (for video recording)
node demo/shard_demo.js

# 5. Run unit tests
node node_modules/jest-cli/bin/jest.js --testPathPattern=shardRouter --forceExit --no-coverage
```

---

## Key Sections of the Report (`sharding/README.md`)

1. **Shard Key Justification** — vault_id vs outer_token vs created_at vs status
2. **Partitioning Formula** — hash modulo with full hex mapping table
3. **Data Distribution** — per-shard databases, co-location of child rows
4. **Query Routing** — insert, point lookup, scatter, range fan-out
5. **Integration** — which API calls changed and why
6. **Edge Cases** — skewed distribution, hot shard, shard failure, rebalancing
7. **CAP Analysis** — consistency model per operation type
8. **Scalability** — horizontal vs vertical, throughput projection
9. **Demo Plan** — 7 scenarios with exact SQL queries to run live
