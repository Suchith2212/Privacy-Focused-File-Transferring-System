# GhostDrop — Architecture Reference

> This document is the single-page technical architecture reference for the GhostDrop system.  
> For setup instructions see [`Ghost_Drop/README.md`](../README.md). For the API see [`JSON_API_REQUESTS_PRO_GUIDE.md`](JSON_API_REQUESTS_PRO_GUIDE.md).

---

## Table of Contents

- [System Overview](#system-overview)
- [Component Map](#component-map)
- [Request Lifecycle](#request-lifecycle)
- [Data Layer](#data-layer)
- [Cryptographic Architecture](#cryptographic-architecture)
- [Security Gate Pipeline](#security-gate-pipeline)
- [RBAC Model](#rbac-model)
- [Background Services](#background-services)
- [Deployment Architecture](#deployment-architecture)
- [Design Decisions](#design-decisions)

---

## System Overview

GhostDrop is a **monolith with a single Express process** that serves both the REST API and the static frontend. External dependencies are MySQL 8 (relational store), Google Drive (ciphertext storage), and optionally Redis 7 (distributed rate-limit state in production).

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Vanilla JS SPA)                  │
│   fetch() JSON  ·  XMLHttpRequest multipart  ·  blob download│
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP :4000
┌───────────────────────────▼─────────────────────────────────┐
│                  Express Server (Node.js 20)                 │
│                                                              │
│  ┌──────────────────┐   ┌──────────────────────────────┐    │
│  │  Security Gate   │   │     Auth Middleware           │    │
│  │  (per-route MW)  │   │  requireAuth / requireAdmin   │    │
│  └────────┬─────────┘   └──────────────┬───────────────┘    │
│           │                            │                     │
│  ┌────────▼──────────────────────────────────────────────┐  │
│  │                    Route Handlers                      │  │
│  │  /api/vaults  /api/files  /api/auth                   │  │
│  │  /api/portfolio  /api/security  /api/module-b         │  │
│  └────────┬──────────────────────────┬────────────────── ┘  │
│           │ SQL                      │ Drive API             │
│  ┌────────▼──────────┐    ┌──────────▼──────────────────┐   │
│  │    MySQL 8         │    │       Google Drive           │   │
│  │  ghostdrop_proto   │    │  (AES-256-GCM ciphertext)   │   │
│  └────────────────────┘    └─────────────────────────────┘   │
│           │ rate state                                        │
│  ┌────────▼──────────┐                                       │
│  │   Redis 7          │  (production only; memory in dev)    │
│  └────────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Map

```
Ghost_Drop/
│
├── backend/src/
│   │
│   ├── app.js                  ← Entry: startup validation, route mount, graceful shutdown
│   │
│   ├── config/
│   │   ├── db.js               ← MySQL connection pool (mysql2, up to 20 connections)
│   │   ├── drive.js            ← Google Drive client (service account or OAuth2)
│   │   ├── logger.js           ← Pino — JSON in prod, pretty-print in dev
│   │   ├── securityPolicies.js ← Per-route rate-limit and risk-policy tables
│   │   └── validateEnv.js      ← Fail-fast env validation on startup
│   │
│   ├── middleware/
│   │   ├── securityGate.js     ← 6-layer security pipeline (block→risk→captcha→rate)
│   │   ├── authSession.js      ← requireAuth / requireAdmin Bearer session checks
│   │   └── upload.js           ← Multer config: memory storage, file-size limits
│   │
│   ├── routes/
│   │   ├── auth.js             ← POST /login · GET /isAuth
│   │   ├── vaults.js           ← Create, access, sub-token, QR
│   │   ├── files.js            ← Upload (encrypt), download (decrypt), batch ZIP
│   │   ├── portfolio.js        ← RBAC CRUD with integrity checks
│   │   ├── security.js         ← CAPTCHA endpoints, status, tamper check
│   │   └── moduleB.js          ← Evidence bundle endpoint
│   │
│   └── services/
│       ├── crypto.js           ← Token generation, PBKDF2, HMAC lookup hash
│       ├── fileSecurityMetadata.js ← AES-256-GCM encrypt/decrypt, key wrap/unwrap
│       ├── driveService.js     ← Drive upload/download/delete wrappers
│       ├── security.js         ← Rate limiting, IP risk, CAPTCHA, adaptive blocking
│       ├── authSession.js      ← Session create/lookup/expire (DB-backed)
│       ├── vaultAccess.js      ← Vault resolution and token verification helpers
│       ├── vaultCleanup.js     ← Background purge: expired vaults → Drive + DB delete
│       ├── portfolioIntegrity.js ← SHA-256 row hash, tamper scan
│       ├── fileAuditLogger.js  ← Append-only audit log (backend/logs/audit.log)
│       ├── auditService.js     ← Session record, auth attempt log, expiry job upsert
│       ├── schemaOptimization.js ← Startup index reconciler
│       ├── filePathSchema.js   ← Lazy relative_path column migration
│       ├── fileValidation.js   ← MIME + extension allowlist
│       └── portfolioService.js ← Portfolio entry creation helper
│
├── frontend/                   ← Vanilla JS SPA, no build step
├── sql/init_schema.sql         ← Authoritative schema (13 tables, indexes, trigger)
├── Dockerfile                  ← Node 20 Alpine, non-root, healthcheck
└── docker-compose.yml          ← App + MySQL 8 + Redis 7
```

---

## Request Lifecycle

### Standard protected request (e.g. file download)

```
Browser
  │
  ▼
Express middleware stack
  ├─ Helmet (security headers)
  ├─ CORS check
  ├─ JSON body parse (50 KB limit)
  ├─ Proxy trust (if TRUST_PROXY=true)
  ├─ Request ID attach (X-Request-ID)
  └─ Request log (Pino debug)
  │
  ▼
securityGate("files.download")
  ├─ 1. isBlocked(ip)?               → 429 TEMP_BLOCK
  ├─ 2. evaluateIpRisk(ip)           → 403 RISK_BLOCK if score too high
  ├─ 3. CAPTCHA gate                 → 403 CAPTCHA_REQUIRED / CAPTCHA_INVALID
  ├─ 4. recordAttempt(ip)
  ├─ 5. checkRateLimit(ip)           → 429 RATE_LIMIT
  ├─ 6. checkRouteRateLimit(key, ip) → 429 ROUTE_RATE_LIMIT
  └─ attach req.securityContext
  │
  ▼
Route handler (files.js)
  ├─ Validate outerToken format
  ├─ Resolve vault from DB
  ├─ HMAC lookup hash → DB pre-filter candidates
  ├─ PBKDF2 verify inner token (async, ~250 000 iterations)
  ├─ Fetch wrappedFileKey from file_key_access
  ├─ PBKDF2 derive wrapping key → AES-256-GCM unwrap fileKey
  ├─ Download ciphertext from Google Drive
  ├─ AES-256-GCM decrypt → verify authTag + SHA-256 hash
  ├─ Mark file DELETED in DB
  ├─ Log download event to download_logs
  └─ Stream plaintext to browser
```

### Session-authenticated request (e.g. portfolio CRUD)

```
Browser (Authorization: Bearer <sessionToken>)
  │
  ▼
requireAuth middleware
  ├─ Extract token from Authorization header / x-session-token / query param
  ├─ Look up auth_sessions row in DB
  ├─ Check expires_at and revoked_at
  └─ Attach req.authSession { vaultId, innerTokenId, role, tokenType }
  │
  ▼
Portfolio rate limit (principal-level)
  └─ checkPrincipalRateLimit("portfolio:{vaultId}:{innerTokenId}")
  │
  ▼
Route handler
  ├─ RBAC check (role === "admin" or owner_token_id match)
  ├─ Integrity hash check on every read/write
  └─ Audit log append
```

---

## Data Layer

### Connection Pool

`config/db.js` creates a mysql2 pool with:
- `connectionLimit`: 20 (configurable via `DB_CONNECTION_LIMIT`)
- All queries use prepared statements (parameterised `?` placeholders — no string concatenation)
- Connections are released immediately after each query; long operations use `getConnection()` for explicit transaction control

### Transaction Boundaries

| Operation | Uses transaction? | Why |
|---|---|---|
| Vault creation | No | Single INSERT |
| SUB token creation | Yes | `inner_tokens` + `file_key_access` must be atomic |
| File upload (per-file) | No | Each file is independent; partial failure is logged |
| Portfolio create/update/delete | No | Single UPDATE with integrity hash recompute |
| Vault purge (cleanup) | Yes | Drive delete + multi-table DB delete must be atomic |

### Query Patterns and Index Coverage

Every hot query path has a dedicated composite index. See the [Index Design and Query Mapping](../README.md#index-design-and-query-mapping) table in `Ghost_Drop/README.md` for the full mapping.

The startup reconciler (`schemaOptimization.js`) adds any missing indexes on boot without requiring a full schema re-init — safe to run against existing databases.

---

## Cryptographic Architecture

### Key Hierarchy

```
Inner Token (user-supplied, 10–20 base62 chars)
│
├──► HMAC-SHA256(token, TOKEN_LOOKUP_SECRET)
│    = token_lookup_hash                  (stored, fast DB pre-filter)
│
├──► PBKDF2-HMAC-SHA256(token, salt, 250 000 iter, 32 bytes)
│    = token_hash                         (stored, slow brute-force resistance)
│
└──► PBKDF2-HMAC-SHA256(token, wrapSalt, 200 000 iter, 32 bytes)  [async — non-blocking]
     = wrappingKey                        (derived on-the-fly, never stored)
          │
          └──► AES-256-GCM(wrappingKey, fileKey)
               = encrypted_file_key      (stored in file_key_access)
                    │
                    └──► AES-256-GCM(fileKey, plaintext)
                         = ciphertext    (stored on Google Drive)
```


### Primitive Summary

| Primitive | Iterations / Length | Where | Purpose |
|---|---|---|---|
| PBKDF2-HMAC-SHA256 | 250 000 iter, 32-byte output | inner_tokens | Token hash (brute-force resistance) |
| HMAC-SHA256 | — | inner_tokens | Fast lookup pre-filter |
| PBKDF2-HMAC-SHA256 | 200 000 iter, 32-byte output | file_key_access | Key wrapping derivation |
| AES-256-GCM | 256-bit key, 96-bit IV | file_key_access | Wrap file key |
| AES-256-GCM | 256-bit key, 96-bit IV | Google Drive | Encrypt file data |
| AES-256-GCM | 256-bit key, 96-bit IV | sub_token_secrets | Encrypt raw SUB token |
| SHA-256 | — | files | Plain-file integrity hash |
| SHA-256 | — | portfolio_entries | Row integrity hash |
| `crypto.timingSafeEqual` | — | All comparisons | Constant-time equality |

### Why Envelope Encryption

Direct token encryption of files would require re-encrypting every file when a token changes or is revoked. Envelope encryption solves this:

- The **file key** is random and unique per file — it never changes.
- The **wrapped key** (file key encrypted with a token-derived key) is per-token per-file.
- Adding a new token = copy and re-wrap the file key (cheap).
- Revoking a token = delete that token's `file_key_access` rows (cheap).
- The file ciphertext on Drive is never touched.

---

## Security Gate Pipeline

Applied to all public endpoints via `middleware/securityGate.js`:

```
Request arrives
    │
    ▼
① isBlocked(ip)?
    │ yes → 429 { code: "TEMP_BLOCK", blockedSeconds, captchaRequired: true }
    │
    ▼
② evaluateIpRisk(routeKey, ip, captchaSolved)
    │ risk.blocked → 403 { code: "RISK_BLOCK", riskScore, riskSignals }
    │ risk.requireCaptcha → captcha gate (step ③)
    │
    ▼
③ CAPTCHA gate (if failures accumulated OR high risk AND not already solved)
    ├─ no challenge in request → 403 { code: "CAPTCHA_REQUIRED" }
    └─ challenge present → verifyCaptcha(...)
         │ fail → 403 { code: "CAPTCHA_INVALID" }
         │ pass → captchaSolved = true; proceed
    │
    ▼
④ recordAttempt(ip)  +  recordRouteAttempt(routeKey, ip)
    │
    ▼
⑤ checkRateLimit(ip)  →  overMinute or overDay AND not captchaSolved
    │ → 429 { code: "RATE_LIMIT", retryAfterSeconds }
    │
    ▼
⑥ checkRouteRateLimit(routeKey, ip)  →  over limit AND not captchaSolved
    │ → 429 { code: "ROUTE_RATE_LIMIT", retryAfterSeconds }
    │
    ▼
   attach req.securityContext = { ok: true, ip, risk, captchaSolved }
   call next()
```

Default thresholds (all configurable via `ROUTE_RATE_LIMITS_JSON` and `ROUTE_RISK_POLICY_JSON`):

| Limit | Value |
|---|---|
| IP: requests per minute | 10 |
| IP: requests per day | 100 |
| Principal: requests per minute | 60 |
| Principal: requests per day | 600 |
| Failures before CAPTCHA required | 8 per minute OR weighted score ≥ 10 (10-min window) |
| Failures before temp block | 20 per minute OR weighted score ≥ 22 |
| Block duration (first strike) | 15 minutes |
| Block duration (max) | 24 hours |

---

## RBAC Model

```
Vault
 └── inner_tokens
      ├── MAIN token (token_type = 'MAIN')
      │    └── role: admin
      │         • Upload files to vault
      │         • Create / revoke SUB tokens
      │         • Read all portfolio entries in vault
      │         • Create / update / delete portfolio entries
      │         • Run unauthorized-check (tamper scan)
      │         • Reveal raw SUB token secrets
      │
      └── SUB token  (token_type = 'SUB')
           └── role: user
                • Download files explicitly linked via file_key_access
                • Read own portfolio entries (owner_token_id = this token)
                • Update own portfolio entries
                • Cannot create or delete entries
                • Cannot run unauthorized-check
```

Role is resolved at login (`POST /api/auth/login`) from `inner_tokens.token_type` and stored in `auth_sessions.role`. The `requireAdmin` middleware simply checks `req.authSession.role === "admin"`.

There is no user table. Role = token type.

---

## Background Services

### Vault Cleanup (`services/vaultCleanup.js`)

Runs on a configurable interval (default 10 minutes). Each cycle:

1. Finds vaults where `expires_at < NOW() - graceHours` and `status IN ('ACTIVE', 'EXPIRED')`
2. For each vault:
   - Deletes all associated files from Google Drive
   - Opens a transaction:  
     `download_logs` → `file_key_access` → `file_metadata` → `files` → `auth_sessions` → `inner_tokens` → `expiry_jobs`
   - Sets `vaults.status = 'DELETED'`

| Env Variable | Default | Effect |
|---|---|---|
| `VAULT_CLEANUP_INTERVAL_MS` | `600000` (10 min) | Scan frequency |
| `VAULT_CLEANUP_GRACE_HOURS` | `1` | Hours post-expiry before purge |
| `VAULT_CLEANUP_BATCH_SIZE` | `20` | Max vaults per scan cycle |
| `FILE_KEY_WRAP_ITERATIONS` | `200000` | PBKDF2 iterations for file key wrapping |
| `PORTFOLIO_INTEGRITY_SECRET` | *(required in prod)* | HMAC key for portfolio row hash |
| `AUDIT_LOG_BLOCK_SIZE` | `1000` | Log entries before rotation to sealed block |

### Portfolio Integrity Scanner

When `PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS > 0`, the server scans all `portfolio_entries` on a background timer. Any row whose recomputed SHA-256 hash does not match `integrity_hash` is logged at `CRITICAL` severity in `backend/logs/audit.log`.

### Startup Reconciler (`services/schemaOptimization.js`)

On every server start, checks for and creates any missing performance indexes. Safe to run against databases initialised from older schema versions. Never drops existing indexes.

---

## Deployment Architecture

### Docker Compose (recommended)

```
docker-compose.yml
  ├── db      mysql:8.0
  │            • Volume: mysql_data
  │            • Init: backend/sql/init_schema.sql mounted as /docker-entrypoint-initdb.d/01_init_schema.sql
  │            • Healthcheck: mysqladmin ping
  │
  ├── redis   redis:7-alpine
  │            • Volume: redis_data
  │            • AOF persistence enabled
  │            • Password-protected (REDIS_PASSWORD env)
  │            • Healthcheck: redis-cli ping
  │
  └── app     ./Dockerfile (Node 20 Alpine)
               • Depends on db + redis (health condition)
               • Non-root user: ghostdrop (UID 1001)
               • EXPOSE 4000
               • HEALTHCHECK: HTTP GET /api/health
               • Production env: NODE_ENV=production, SECURITY_STORE=redis
```

### Reverse Proxy (production)

Place nginx or a cloud load balancer in front of the app container:

```
Client → HTTPS :443 → nginx → HTTP :4000 → app container
```

Required env: `TRUST_PROXY=true` so `x-forwarded-for` is used for rate limiting instead of the proxy's IP.

### Startup Sequence

```
1. validateEnvironment()       ← fail fast on missing required vars
2. assertIntegritySecretSafe() ← fail in prod if PORTFOLIO_INTEGRITY_SECRET is default
3. assertTokenLookupSecretSafe() ← fail in prod if TOKEN_LOOKUP_SECRET is default
4. assertSecurityStoreSafe()   ← fail in prod if SECURITY_STORE != redis
5. ensurePerformanceIndexes()  ← startup index reconciler (non-fatal on error)
6. app.listen(PORT)
7. startCleanupTimer()         ← background vault purge service
8. setInterval(integrityScanner) ← if PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS > 0
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| **Single Express process serves both API and frontend** | Simplifies deployment; no CORS configuration needed between frontend and API in production |
| **No user table; roles derived from token type** | Eliminates password management complexity; the inner token IS the credential |
| **Envelope encryption (per-file random key)** | Revoke/add token access without re-encrypting files; one compromised token does not expose all files |
| **HMAC pre-filter before PBKDF2** | PBKDF2 at 250k iterations is ~100 ms per check. The HMAC hash narrows candidates instantly so PBKDF2 is only run against likely matches |
| **Redis optional in dev, required in prod** | In-process Maps are sufficient for single-process development but do not survive restarts or scale across instances |
| **Audit log is an append-only file, not a DB table** | Avoids a dependency on DB availability for security logging; survives DB failure |
| **Background cleanup vs on-request expiry** | On-request expiry adds latency to every vault access. Background cleanup is predictable and testable in isolation |
| **50 KB JSON body limit** | Prevents JSON DoS; all meaningful payloads (tokens, file IDs) fit well within this limit |
| **HSTS disabled in development** | Prevents browsers from permanently caching the dev server as HTTPS-only, which would break local development |
