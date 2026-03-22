# Assignment 2: Application and Custom B+ Tree Development

## A. Assignment Intent
This assignment requires implementation design for:
1. Core backend application logic of BlindDrop
2. A custom B+ Tree index built from scratch
3. Integration of both components for fast and correct data access

## B. Problem Statement in BlindDrop Context
BlindDrop has security-sensitive hot paths:
1. Outer-token vault lookup on every download request
2. Session-window checks for brute-force protection
3. Expiry range scans for cleanup jobs

Without optimized indexing, these operations degrade as data grows. Assignment 2 addresses this by combining domain services + a dedicated B+ Tree access layer.

## C. Scope and Assumptions
## In Scope
1. Backend service architecture and data flow
2. API-level operation model
3. B+ Tree data structure design and operations
4. DB-index synchronization strategy
5. Performance measurement strategy

## Out of Scope
1. UI implementation
2. Final cloud deployment scripts
3. Assignment 3 ACID fault-injection execution

## D. Existing Data Model Used
From [`Blindrop_Dragons.sql`](F:/SEM IV/lessons/DB/Project/Blindrop_Dragons.sql):
1. Vault domain: `vaults`, `inner_tokens`
2. File domain: `files`, `file_metadata`, `file_key_access`
3. Security domain: `sessions`, `auth_attempts`, `captcha_tracking`, `download_logs`
4. Lifecycle domain: `expiry_jobs`

## E. Backend Design (Structured)
## E1. Service Modules
1. `vault-service`
   - create vault
   - validate expiry/status
2. `token-service`
   - verify MAIN/SUB token hash+salt
   - enforce token state rules
3. `file-service`
   - upload metadata registration
   - one-time download transition
4. `access-service`
   - resolve token-to-file permissions
5. `security-service`
   - track attempts
   - apply CAPTCHA/blocking policy
6. `index-service`
   - expose B+ Tree operations
   - maintain index durability and recovery

## E2. Data Ownership Rule
Relational DB is authoritative. B+ Tree is an acceleration layer, never the final source of truth.

## F. B+ Tree Design (From Scratch)
## F1. Key Design Choices
1. Internal nodes store separator keys and child pointers
2. Leaf nodes store key -> posting list mapping and `next_leaf` pointer
3. Duplicate keys supported via posting lists (needed for many-to-one mappings)

## F2. Suggested Configuration
1. Tree order `m = 32`
2. Leaf capacity `64`
3. Fill target after operations: `50%+` to avoid deep trees

## F3. Indexed Attributes
1. `outer_token -> vault_id`
2. `expires_at -> vault_id[]`
3. `(vault_id, status, uploaded_at) -> file_id[]`
4. `(session_id, attempt_time) -> auth_attempt_id[]`

## F4. Supported Operations
1. `insert(key, ptr)`
2. `search(key)`
3. `range_search(start, end)`
4. `delete(key, ptr)`
5. Rebalancing: split, borrow, merge, root shrink

## F5. Complexity
1. Point operations: `O(log N)`
2. Range scan: `O(log N + k)` with leaf chaining

## G. Integration with Application Logic
## G1. Write Path Contract
1. Begin DB transaction
2. Apply DB mutations
3. Apply B+ Tree mutation
4. Commit only if both succeed
5. On failure, rollback and no partial visibility

## G2. Read Path Contract
1. Query B+ Tree first
2. Fallback to DB on miss
3. Lazy-repair missing index entries

## G3. Consistency Rule
Every externally visible write must preserve DB-index parity before commit returns success.

## H. End-to-End Flow Mapping
## H1. Upload Flow
1. Create vault and MAIN token
2. Register encrypted file metadata
3. Insert access rows for MAIN/SUB
4. Update B+ Tree keys for vault/file/time dimensions

## H2. Download Flow
1. Outer token lookup through B+ Tree
2. Inner token verification and access resolution
3. File delivery authorization
4. One-time state transition (`ACTIVE -> DELETED`)
5. Revoke related wrapped-key entries
6. Update index entries and append logs

## I. Data Integrity Rules to Enforce in Code
1. One MAIN token per vault
2. MAIN token must retain access to all vault files
3. No cross-vault token/file mapping
4. File cannot return from `DELETED` to `ACTIVE`
5. Download logging must accompany successful one-time transition

## J. Performance Evaluation Plan
## J1. Baseline
Measure same queries without B+ Tree.

## J2. Indexed Mode
Repeat with B+ Tree enabled.

## J3. Metrics
1. p50/p95 latency
2. Throughput
3. CPU overhead
4. Index memory footprint

## J4. Success Targets
1. Outer-token lookup p95 improvement vs baseline
2. Expiry range scan scales with `k`, not full table size
3. No correctness regressions under concurrent load

## K. Viva Demonstration Checklist
1. Explain tree structure with one insert split example
2. Show one range query using leaf links
3. Show DB+index rollback on forced failure
4. Show before/after performance numbers

## L. Assignment 2 Deliverables Mapping
1. Application architecture and workflow: covered in sections E and H
2. Custom B+ Tree design: covered in section F
3. Integration model: covered in section G
4. Performance validation plan: covered in section J
