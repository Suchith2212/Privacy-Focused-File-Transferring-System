# BlindDrop Final Submission Bundle
## Cover
- Course: CS 432 - Databases (Course Project, Track 1)
- Project: Privacy-Focused File Transferring Portal (BlindDrop)
- Student: Suchith S
- Date: 28 February 2026
## Table of Contents
1. Assignment 2: Application and Custom B+ Tree Development
2. Assignment 3: ACID Testing for BlindDrop + Custom B+ Tree
3. End-to-End Customized Implementation Plan
---
## 1. Assignment 2: Application and Custom B+ Tree Development
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
---
## 2. Assignment 3: ACID Testing for BlindDrop + Custom B+ Tree
## A. Assignment Intent
Validate transaction correctness under realistic concurrency and failure conditions, specifically for:
1. Relational DB state
2. Custom B+ Tree state
3. Cross-layer consistency between both

## B. Test Philosophy
This assignment is not only about passing SQL checks. It must prove:
1. No partial state leaks to users
2. Security invariants remain intact under load
3. Crash/restart never corrupts authority or index parity

## C. Preconditions
1. Deterministic seed dataset loaded
2. Assignment 2 application flows and index integration available
3. Test harness supports concurrent clients and fault injection
4. Logging enabled for transaction IDs and index mutation IDs

## D. Invariants to Protect
1. Successful download implies file status is `DELETED`
2. Downloaded file has no valid wrapped key path for future access
3. No vault has more than one `MAIN` token
4. No file/token access mapping crosses vault boundaries
5. Failed transaction leaves both DB and B+ Tree unchanged
6. Committed transaction survives restart/crash

## E. ACID Test Matrix
## E1. Atomicity
1. `A1 Upload rollback after partial write`
   - Fault: fail after `files` insert, before `file_metadata` + index update
   - Expected: no persistent row in `files`, no metadata, no index key
2. `A2 Download rollback during revocation`
   - Fault: fail after status update, before key access deletion
   - Expected: entire operation undone; file remains `ACTIVE`

## E2. Consistency
1. `C1 Duplicate MAIN token attempt`
   - Action: parallel insert of two MAIN tokens for same vault
   - Expected: exactly one success, one rejection
2. `C2 Cross-vault mapping attempt`
   - Action: map token from vault A to file in vault B
   - Expected: rejection by validation/constraint
3. `C3 State transition correctness`
   - Action: attempt `DELETED -> ACTIVE`
   - Expected: blocked as invalid transition

## E3. Isolation
1. `I1 Parallel auth attempts`
   - Action: 100 concurrent verifications on same vault
   - Expected: no dirty reads, correct attempt counters
2. `I2 Double-download race`
   - Action: two sessions request same file simultaneously
   - Expected: only one success, one deterministic conflict/failure
3. `I3 Expiry vs download race`
   - Action: expiry worker and download hit same vault
   - Expected: serializable business result, no split-brain state

## E4. Durability
1. `D1 Commit then controlled crash`
   - Action: commit download, kill process, restart
   - Expected: `DELETED` state and logs persist
2. `D2 Uncommitted crash`
   - Action: crash before commit
   - Expected: no user-visible changes after recovery
3. `D3 Index durability`
   - Action: commit index mutation then restart
   - Expected: key search returns committed result

## F. Workload Profiles
1. Upload-heavy profile
   - 50 parallel uploads across 10 vaults
2. Auth-heavy profile
   - 500 token checks/minute with mixed valid/invalid tokens
3. Conflict-heavy profile
   - repeated same-file download contention
4. Mixed profile
   - auth + download + expiry worker running together

## G. Execution Protocol
1. Capture baseline snapshot (DB + index stats)
2. Execute one test case
3. Inject fault (when applicable)
4. Capture final snapshot
5. Validate invariants with SQL + index inspection
6. Store pass/fail record with evidence IDs

## H. Verification Queries (Core)
1. One-time download status
```sql
SELECT file_id, status, deleted_at
FROM files
WHERE file_id = :file_id;
```

2. Wrapped key revocation check
```sql
SELECT COUNT(*) AS key_access_count
FROM file_key_access
WHERE file_id = :file_id;
```

3. MAIN token uniqueness
```sql
SELECT vault_id, COUNT(*) AS main_count
FROM inner_tokens
WHERE token_type = 'MAIN'
GROUP BY vault_id
HAVING COUNT(*) > 1;
```

4. Cross-vault mapping integrity
```sql
SELECT f.file_id, f.vault_id AS file_vault, t.vault_id AS token_vault
FROM file_key_access a
JOIN files f ON f.file_id = a.file_id
JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
WHERE f.vault_id <> t.vault_id;
```

## I. Result Reporting Template
For each case, report:
1. Case ID
2. Input workload
3. Fault injection point
4. Observed DB state
5. Observed B+ Tree state
6. Verdict (`PASS`/`FAIL`)
7. Root cause notes (if fail)

## J. Pass/Fail Gate
Assignment passes only if:
1. Zero invariant violations in all ACID suites
2. No DB-index divergence after restart tests
3. Conflict tests produce deterministic, safe outcomes
4. Durability tests preserve only committed effects

## K. Viva Demonstration Plan
1. Live race test for double download
2. Live rollback test with injected exception
3. Crash-and-restart durability proof
4. SQL and B+ Tree parity proof after each test

## L. Deliverables Mapping
1. ACID test matrix: sections E and F
2. Execution plan: section G
3. Validation evidence model: sections H and I
4. Acceptance rubric: section J
---
## 3. End-to-End Customized Implementation Plan
## 1) Goal
Deliver a production-grade privacy-focused temporary file transfer platform with:
1. Anonymous vault creation
2. Dual-token authorization (Outer + Inner)
3. AES-256-GCM encrypted object storage
4. Per-file wrapped key access (MAIN/SUB token model)
5. One-time download and strict expiry lifecycle
6. Brute-force/CAPTCHA/rate-limit protections
7. Auditable and testable ACID-safe backend

## 2) Recommended Tech Stack
- Backend: Node.js + TypeScript + Fastify (or Express)
- DB: MySQL 8.x (matches existing SQL style)
- Cache/Rate control: Redis
- Object store: S3-compatible bucket
- Queue/Scheduler: BullMQ + Redis (expiry and cleanup jobs)
- Infra: Docker Compose (dev), managed cloud for prod
- Observability: OpenTelemetry + Prometheus + Grafana + structured logs

## 3) Target Architecture
1. `API Service`: upload/download/token/session endpoints
2. `Crypto Service`: token KDF, file key wrapping/unwrapping
3. `Storage Adapter`: encrypted object put/get/delete
4. `Auth Defense`: attempt tracking, CAPTCHA gates, temp blocks
5. `Lifecycle Worker`: expiry jobs, hard delete orchestration
6. `Index Engine`: B+ Tree lookup/range module for hot attributes
7. `Admin Observability`: dashboards and security alerts

## 4) Data Model Hardening Plan
Apply schema corrections before coding:
1. Enforce single MAIN token per vault (unique partial logic via trigger/constraint pattern)
2. Enforce at-most-one SUB token per file if required by policy
3. Ensure `captcha_tracking.attempts` stores integer counts (not boolean)
4. Add audit logs table (currently referenced but absent)
5. Add strict status transition controls (`ACTIVE -> DELETED` only)
6. Add composite indexes for auth/expiry/listing paths

## 5) Execution Milestones (8 Weeks)
## Phase 0: Foundations (Week 1)
1. Finalize API contracts and error model
2. Introduce migration framework (versioned SQL)
3. Set up CI pipeline: lint + unit + integration + security checks
4. Output: architecture doc + migration baseline + CI passing on empty scaffold

## Phase 1: Vault and Token Core (Week 2)
1. Vault creation endpoint (`outer_token`, expiry schedule)
2. MAIN token registration and secure hash+salt storage
3. Token verification service with PBKDF2 policy
4. Session creation and auth-attempt logging
5. Output: working vault creation/access prototype

## Phase 2: Secure Upload Pipeline (Week 3)
1. Client-side or service-side file encryption flow
2. Store encrypted object + metadata
3. Insert wrapped key entries (`file_key_access`)
4. Add MIME/size validation rules from product policy
5. Output: upload-to-encrypted-storage demo

## Phase 3: Selective Access and Download (Week 4)
1. SUB token creation/revocation
2. File visibility filtering by token rights
3. Download execution with one-time delete transition
4. Wrapped key revocation after successful download
5. Output: end-to-end one-time download flow

## Phase 4: Security Controls (Week 5)
1. Per-session and per-IP rate limits
2. CAPTCHA escalation thresholds
3. Temporary block policy and unblock timers
4. Abuse monitoring and alerting rules
5. Output: automated abuse defense tests

## Phase 5: B+ Tree Index Integration (Week 6)
1. Implement custom B+ Tree module
2. Integrate for `outer_token`, `expires_at`, and auth timeline lookups
3. Add DB/index reconciliation routines
4. Benchmark baseline vs indexed performance
5. Output: performance report (before/after)

## Phase 6: ACID and Failure Validation (Week 7)
1. Run Assignment 3 test suite end-to-end
2. Concurrency race tests for download/idempotency
3. Crash recovery and durability verification
4. Fix transactional edge cases discovered
5. Output: ACID evidence report with pass/fail table

## Phase 7: Release Readiness (Week 8)
1. SLO definition (latency, error rates, expiry SLA)
2. Backup/restore and key-rotation runbooks
3. Security review and threat-model signoff
4. Production deployment with canary rollout
5. Output: production readiness checklist signed

## 6) API Surface (Minimum)
1. `POST /vaults`
2. `POST /vaults/{outerToken}/files`
3. `POST /access/outer-token`
4. `POST /access/inner-token`
5. `GET /vaults/{vaultId}/files`
6. `POST /files/{fileId}/download`
7. `POST /tokens/sub`
8. `DELETE /tokens/sub/{id}`

## 7) Quality Gates
Each phase closes only when:
1. Unit and integration tests pass
2. No P1/P2 security issues remain open
3. Data integrity invariants remain green
4. Observability for new flow is added

## 8) Test Strategy
1. Unit: crypto, validators, B+ Tree node logic
2. Integration: DB transaction boundaries + object storage adapter
3. Concurrency: parallel upload/auth/download races
4. Security: brute-force, CAPTCHA bypass, token enumeration resistance
5. Resilience: forced crashes, restart replay, job retry/idempotency

## 9) KPIs and Targets
1. Outer-token lookup p95 < 50 ms
2. Auth check p95 < 100 ms under normal load
3. Failed auth defense response < 150 ms
4. Expiry cleanup delay < 5 minutes after schedule
5. One-time download race correctness: 100% single-winner guarantee

## 10) Deployment and Operations
1. Environment separation: dev/staging/prod
2. Secrets in vault manager (no plaintext in config)
3. Encryption key management and rotation cadence
4. Scheduled expiry worker with dead-letter queue
5. Observability dashboards:
   - auth failures/min
   - CAPTCHA trigger rate
   - expired vault cleanup lag
   - download success vs blocked attempts

## 11) Risks and Controls
1. Risk: DB-index divergence
   - Control: transactional hooks + reconciliation jobs
2. Risk: replay/double-download race
   - Control: row-level locking + idempotent state transition
3. Risk: token brute force
   - Control: layered rate limits + CAPTCHA + temp block
4. Risk: stale encrypted objects after logical delete
   - Control: guaranteed cleanup jobs with retries and alarms

## 12) Definition of Done
1. All Assignment 2 and Assignment 3 criteria passed
2. All critical invariants enforced at DB/service layers
3. p95 lookup and download latency within agreed SLO
4. Zero high-severity security findings in final review
5. Production runbooks and rollback procedures validated
---
## Appendix: Source Files
1. Blindrop_Dragons.sql
2. README.md
3. Project_Documentation.pdf
4. ER_Diagram_basic.pdf
5. ER_Diagram_formal.pdf
## Notes
1. Assignment mapping follows Databases_CS432__2026_Track 1.pdf definitions for Assignment 2 and Assignment 3.
2. Final report content is aligned with current BlindDrop schema and security model.
