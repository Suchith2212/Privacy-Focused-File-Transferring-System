# GhostDrop — Project Documentation

> Concise technical reference for the GhostDrop application.  
> For the full architecture, see [`ARCHITECTURE.md`](ARCHITECTURE.md).  
> For the API, see [`JSON_API_REQUESTS_PRO_GUIDE.md`](JSON_API_REQUESTS_PRO_GUIDE.md).  
> For encryption details, see [`ENCRYPTION_REFERENCE.md`](ENCRYPTION_REFERENCE.md).  
> For security limits, see [`SECURITY_LIMITS_REFERENCE.md`](SECURITY_LIMITS_REFERENCE.md).

---

## Table of Contents

- [System Components](#system-components)
- [Authentication and Role Mapping](#authentication-and-role-mapping)
- [Database Schema](#database-schema)
- [RBAC Rules](#rbac-rules)
- [Portfolio CRUD Design](#portfolio-crud-design)
- [Tamper Detection](#tamper-detection)
- [Audit Logging](#audit-logging)
- [SQL Optimization Evidence](#sql-optimization-evidence)
- [Frontend Access Features](#frontend-access-features)
- [Security Notes](#security-notes)
- [Run Instructions](#run-instructions)
- [Source File Index](#source-file-index)

---

## System Components

| Component | Technology | Purpose |
|---|---|---|
| Backend API | Node.js 20 + Express 4 | REST API server; also serves static frontend |
| Database | MySQL 8 (`ghostdrop_proto`) | Primary relational store — 13 tables |
| File storage | Google Drive (via `googleapis`) | Stores AES-256-GCM ciphertext only |
| Security store | In-memory (dev) / Redis 7 (prod) | Rate-limit counters, block state, CAPTCHA state |
| Frontend | Vanilla JS SPA | Single-page app served from `/` by Express |
| Session layer | DB-backed Bearer tokens | `auth_sessions` table; token type → RBAC role |
| Portfolio API | RBAC CRUD + integrity hashing | Protected resource for demonstrating authenticated access control |
| Background service | `vaultCleanup.js` | Purges expired vaults from Drive and DB |

---

## Authentication and Role Mapping

There is no traditional user/password table. Role is derived from the **token type** at login:

```
outerToken + MAIN innerToken  →  role: admin
outerToken + SUB  innerToken  →  role: user
```

### Vault Credential Layer (vault + file endpoints)

The client sends `outerToken` + `innerToken` directly in each request. The server resolves the vault, verifies the token via PBKDF2, and enforces access accordingly.

### Bearer Session Layer (portfolio + security endpoints)

```http
POST /api/auth/login
Body: { "outerToken": "...", "innerToken": "..." }
→ Returns: { "sessionToken": "uuid", "role": "admin", ... }
```

Use the session token in subsequent requests:

```http
Authorization: Bearer <sessionToken>
```

The outer token QR can be scanned via the browser camera (`BarcodeDetector` API) on the access screen when camera access is granted.

---

## Database Schema

Schema source: [`backend/sql/init_schema.sql`](../backend/sql/init_schema.sql)

### Core File-Transfer Tables

| # | Table | Purpose |
|---|---|---|
| 1 | `vaults` | Vault lifecycle (outer token, expiry, status) |
| 2 | `inner_tokens` | MAIN and SUB token PBKDF2 hashes |
| 3 | `files` | File records with Drive ID and encryption metadata |
| 4 | `file_metadata` | Extended filename and relative path |
| 5 | `file_key_access` | Per-token wrapped file key (envelope encryption) |
| 6 | `sub_token_secrets` | AES-encrypted raw SUB token values |
| 7 | `sessions` | Anonymous session tracking (IP + user-agent) |
| 8 | `auth_sessions` | Bearer session tokens with expiry and revocation |
| 9 | `auth_attempts` | Per-session authentication audit trail |
| 10 | `download_logs` | Per-file, per-token download events |
| 11 | `captcha_tracking` | CAPTCHA state per session |
| 12 | `expiry_jobs` | Scheduled vault cleanup queue |

### Portfolio Table

| # | Table | Purpose |
|---|---|---|
| 13 | `portfolio_entries` | Vault-scoped authenticated CRUD resource with per-row integrity hash |

### Schema Hardening

- `inner_tokens.token_lookup_hash`: indexed HMAC pre-filter column; backfilled on first successful match for legacy rows
- `sub_token_secrets.sub_inner_token`: legacy plaintext column; `NULL` on all new writes
- `before_portfolio_update_guard` trigger: blocks mutation of `created_at` and `created_by_token_id` at the database level
- Startup reconciler (`schemaOptimization.js`): adds missing indexes on boot without requiring a full schema re-init

---

## RBAC Rules

### Admin (MAIN token)

| Action | Allowed |
|---|---|
| Upload files to vault | ✅ |
| Create / revoke SUB tokens | ✅ |
| List all portfolio entries in vault | ✅ |
| Create portfolio entries | ✅ |
| Update any portfolio entry | ✅ |
| Delete portfolio entries | ✅ |
| Run `GET /api/security/unauthorized-check` | ✅ |
| Reveal raw SUB token secrets | ✅ |

### User (SUB token)

| Action | Allowed |
|---|---|
| Download files linked to this token | ✅ |
| List own portfolio entries (`owner_token_id` = this token) | ✅ |
| Update own portfolio entries | ✅ |
| Create portfolio entries | ❌ |
| Delete portfolio entries | ❌ |
| Access files not linked to this token | ❌ |
| Run tamper check | ❌ |

Role enforcement happens at two levels:
1. `requireAdmin` middleware blocks non-admin requests before the handler runs
2. Query-level filtering: user role queries always include `AND owner_token_id = ?`

---

## Portfolio CRUD Design

The `portfolio_entries` table is the dedicated RBAC resource. It exists specifically to provide:

- A full authenticated create/read/update/delete surface (file listing alone is not sufficient)
- Vault-scoped ownership — each entry belongs to a vault and is owned by a specific inner token
- Integrity hashing — every row carries a tamper-evident hash
- Index benchmarking — the listing query pattern uses a composite covering index

### Why Not Use File Records for RBAC

File records are tied to download semantics (one-time access, logical deletion). They are not suitable as a persistent, updatable authenticated resource. `portfolio_entries` is additive — the file transfer system is unchanged.

---

## Tamper Detection

Every `portfolio_entries` row stores:

```
integrity_hash = SHA-256(vaultId | ownerTokenId | title | content | status | PORTFOLIO_INTEGRITY_SECRET)
```

On every read, update, and delete:
1. The hash is recomputed using the current row values
2. If it does not match the stored `integrity_hash`, the operation returns `409 PORTFOLIO_TAMPER_DETECTED`
3. A `CRITICAL` severity event is written to `backend/logs/audit.log`

**Detection endpoint:** `GET /api/security/unauthorized-check`  
Scans all portfolio entries for the authenticated vault and returns tampered row details.

**Background scan:** When `PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS > 0`, the server scans all entries system-wide on a timer.

**Database-level guard:** The `before_portfolio_update_guard` trigger fires `SQLSTATE '45000'` if `created_at` or `created_by_token_id` is changed in any UPDATE, preventing timestamp and creator forgery via direct SQL access.

Environment variable: `PORTFOLIO_INTEGRITY_SECRET` (required in production; blocked from using the default dev value).

---

## Audit Logging

Audit log file: `backend/logs/audit.log`

The log is append-only and written by `services/fileAuditLogger.js`. It persists independently of the database — useful for post-incident investigation when DB integrity is in question.

### Logged Events

| Action | Severity | Trigger |
|---|---|---|
| `auth.login.success` | INFO | Successful Bearer session creation |
| `auth.login.denied` | WARN | Invalid token or inactive vault at login |
| `portfolio.create` | INFO | Admin creates portfolio entry |
| `portfolio.update` | INFO | Entry updated |
| `portfolio.delete` | INFO | Entry soft-deleted |
| `portfolio.read.denied` | WARN | Role check failed on read |
| `portfolio.update.denied` | WARN | Role check failed on update |
| `portfolio.read.blocked_tampered` | CRITICAL | Tampered entry excluded from listing |
| `portfolio.update.blocked_tampered` | CRITICAL | Tampered entry blocked from update |
| `portfolio.delete.blocked_tampered` | CRITICAL | Tampered entry blocked from delete |
| `portfolio.background_scan.tampered` | CRITICAL | Background scanner detected tampered row |

---

## SQL Optimization Evidence

All indexes are defined in [`backend/sql/init_schema.sql`](../backend/sql/init_schema.sql). The startup reconciler in `services/schemaOptimization.js` adds missing indexes on boot.

### Covering Index for Portfolio Listing

The primary benchmark query (RBAC user listing):

```sql
SELECT entry_id, title, updated_at
FROM portfolio_entries
WHERE vault_id    = ?
  AND owner_token_id = ?
  AND status     = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 25;
```

Satisfied by:

```sql
CREATE INDEX idx_portfolio_vault_owner_status
ON portfolio_entries(vault_id, owner_token_id, status, updated_at);
```

### Complete Index Reference

| Index | Table | Columns | Query Pattern |
|---|---|---|---|
| `UNIQUE outer_token` | `vaults` | `outer_token` | `WHERE outer_token = ?` |
| `idx_vault_expiry` | `vaults` | `(status, expires_at)` | Cleanup scan order |
| `idx_inner_tokens_lookup_hash` | `inner_tokens` | `(token_lookup_hash, vault_id, status)` | HMAC pre-filter before PBKDF2 |
| `idx_inner_tokens_vault_status` | `inner_tokens` | `(vault_id, status)` | List vault tokens |
| `idx_files_vault_status` | `files` | `(vault_id, status, created_at)` | File listing per vault |
| `idx_files_deleted_at` | `files` | `deleted_at` | Cleanup scan |
| `idx_file_key_access_token` | `file_key_access` | `inner_token_id` | Token-first key lookup |
| `idx_download_file_time` | `download_logs` | `(file_id, download_time)` | Per-file download history |
| `idx_download_token` | `download_logs` | `inner_token_id` | Per-token download audit |
| `idx_auth_attempts_session_time` | `auth_attempts` | `(session_id, attempt_time, success)` | Session analysis |
| `idx_portfolio_vault_status` | `portfolio_entries` | `(vault_id, status, updated_at)` | Admin listing |
| `idx_portfolio_vault_owner_status` | `portfolio_entries` | `(vault_id, owner_token_id, status, updated_at)` | User listing |
| `idx_portfolio_integrity_hash` | `portfolio_entries` | `integrity_hash` | Tamper scan |
| `idx_expiry_jobs_sched` | `expiry_jobs` | `(processed, scheduled_time)` | Job queue scan |
| `idx_sub_token_secrets_vault` | `sub_token_secrets` | `vault_id` | Per-vault secret list |

---

## Frontend Access Features

- **QR scanning**: outer token can be typed manually or scanned from QR using the browser camera (`getUserMedia` + `BarcodeDetector` when available)
- **CAPTCHA replay**: after solving a CAPTCHA, the frontend holds the solved state for a short window and retries the blocked action without re-prompting
- **Batch download**: MAIN users can select multiple files and trigger `Download Selected`, which calls `POST /api/files/download-batch` and downloads a ZIP
- **No build step**: all frontend code is plain JS and CSS; `lucide.js` is bundled and served as-is

---

## Security Notes

- `x-forwarded-for` is trusted only when `TRUST_PROXY=true` — required when running behind nginx, Railway, Render, or any reverse proxy
- `SECURITY_STORE=redis` is required in production — the server will not start without it when `NODE_ENV=production`
- The built-in math CAPTCHA is suitable for development only — use `hcaptcha` or `recaptcha` in production
- `BATCH_DOWNLOAD_MAX_FILES` (default 10) prevents memory exhaustion from large server-side ZIP assembly
- JSON body size is capped at 50 KB to prevent JSON DoS
- HSTS is disabled in development to prevent browsers from permanently caching the dev server as HTTPS-only

---

## Run Instructions

```bash
# Initialize schema
mysql -u root -p < backend/sql/init_schema.sql

# PowerShell alternative
Get-Content ".\backend\sql\init_schema.sql" | mysql --force -u root -p ghostdrop_proto

# Install and start
cd backend
npm install
npm run dev       # development (hot-reload)
```

Endpoints:
- App: `http://localhost:4000`
- Health: `http://localhost:4000/api/health`
- Readiness: `http://localhost:4000/api/ready`

Example login:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"outerToken":"OUTER123","innerToken":"MainInner123"}'
```

---

## Source File Index

| File | Purpose |
|---|---|
| [`backend/src/app.js`](../backend/src/app.js) | Server entry point |
| [`backend/src/routes/auth.js`](../backend/src/routes/auth.js) | Auth login + session validation |
| [`backend/src/routes/portfolio.js`](../backend/src/routes/portfolio.js) | Portfolio CRUD |
| [`backend/src/routes/security.js`](../backend/src/routes/security.js) | CAPTCHA, status, tamper check |
| [`backend/src/routes/vaults.js`](../backend/src/routes/vaults.js) | Vault and sub-token management |
| [`backend/src/routes/files.js`](../backend/src/routes/files.js) | Upload, download, batch ZIP |
| [`backend/src/services/authSession.js`](../backend/src/services/authSession.js) | Session create/lookup/expire |
| [`backend/src/services/portfolioIntegrity.js`](../backend/src/services/portfolioIntegrity.js) | Integrity hash + tamper scan |
| [`backend/src/services/fileAuditLogger.js`](../backend/src/services/fileAuditLogger.js) | Append-only audit log |
| [`backend/src/services/crypto.js`](../backend/src/services/crypto.js) | Token generation, PBKDF2, HMAC |
| [`backend/src/services/fileSecurityMetadata.js`](../backend/src/services/fileSecurityMetadata.js) | AES-256-GCM encrypt/decrypt, key wrap |
| [`backend/src/services/security.js`](../backend/src/services/security.js) | Rate limiting, IP risk, CAPTCHA, blocking |
| [`backend/src/services/vaultCleanup.js`](../backend/src/services/vaultCleanup.js) | Background vault purge |
| [`backend/sql/init_schema.sql`](../backend/sql/init_schema.sql) | Authoritative schema |
| [`frontend/index.html`](../frontend/index.html) | SPA shell |
| [`frontend/app.js`](../frontend/app.js) | All frontend logic |
| [`frontend/styles.css`](../frontend/styles.css) | All styles |
