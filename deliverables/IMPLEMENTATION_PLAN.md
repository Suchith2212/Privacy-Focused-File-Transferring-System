# BlindDrop End-to-End Customized Implementation Plan

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
- Backend: Node.js + TypeScript + Express    => Suchith
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
