# Ghost Drop Project Documentation

This document matches the current `Ghost_Drop` implementation and its Module B alignment layer.

## 1) Architecture

- Backend: Node.js + Express
- Database: MySQL (`ghostdrop_proto`)
- Storage: Google Drive for Ghost Drop file blobs
- Frontend: static HTML/CSS/JS served by backend
- Session layer: token-based vault session service
- Module B layer: RBAC portfolio CRUD + tamper detection + audit log file
- Access UX layer: manual outer-token entry, QR scanning, and one-time CAPTCHA replay

## 2) Authentication and Role Mapping

This project uses vault credentials as the login model.

- `outerToken + MAIN innerToken` => `admin`
- `outerToken + SUB innerToken` => `user`

Equivalent Module B APIs:

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

The login route returns a session token. Protected Module B routes use:

```http
Authorization: Bearer <sessionToken>
```

Ghost Drop access in the browser still uses:

- outer token
- inner token

The outer token can now be scanned from QR through the browser camera when supported.

## 3) Schema

Schema source:

- [init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/sql/init_schema.sql)

### Ghost Drop Core Tables

1. `vaults`
2. `inner_tokens`
3. `files`
4. `file_metadata`
5. `file_key_access`
6. `sessions`
7. `auth_attempts`
8. `download_logs`
9. `captcha_tracking`
10. `expiry_jobs`

Additional runtime schema hardening:

- `token_lookup_hash` on `inner_tokens` supports indexed token prefiltering without replacing PBKDF2 verification
- startup schema reconciliation in `schemaOptimization.js` updates index definitions for existing databases

### Module B Alignment Tables

11. `portfolio_entries`
- Vault-scoped CRUD resource
- Owner is an `inner_tokens.inner_token_id`
- Protected by `integrity_hash`
- Indexed for RBAC listing queries

### Runtime-Created Table

12. `sub_token_secrets`
- Used for SUB token display/recovery in the Ghost Drop UI

## 4) Portfolio CRUD Choice

Existing file listing and folder display are useful application features, but they are not a clean full CRUD resource for Module B evaluation. To close that gap, the project now adds `portfolio_entries`.

`portfolio_entries` is the Module B demonstration resource because it supports:

- authenticated create/read/update/delete
- role-based ownership checks
- unauthorized direct DB change detection
- index benchmarking on a realistic protected query

## 5) API Surface

### Ghost Drop APIs

- `POST /api/vaults`
- `GET /api/vaults/:outerToken/public-info`
- `POST /api/vaults/:outerToken/access`
- `GET /api/vaults/:outerToken/qr`
- `POST /api/files/new-vault-upload`
- `POST /api/files/:outerToken/upload`
- `GET /api/files/:outerToken/list`
- `POST /api/files/:outerToken/sub-tokens`
- `GET /api/files/:outerToken/sub-tokens`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`
- `POST /api/files/:fileId/download`

### Module B Alignment APIs

- `POST /api/auth/login`
- `GET /api/auth/isAuth`
- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`
- `GET /api/security/unauthorized-check`

### Security APIs

- `GET /api/security/captcha`
- `POST /api/security/captcha/verify`
- `GET /api/security/captcha/required`
- `GET /api/security/status`

## 6) Frontend Access Features

- vault creator sees generated outer-token QR
- vault recipient can scan that QR from the access screen
- when CAPTCHA is triggered, the frontend reuses the solved state for a short window and retries the blocked action once instead of re-requesting a new challenge immediately
- scanner support depends on browser camera access and `BarcodeDetector` availability

## 7) RBAC Rules

### Admin (`MAIN`)

- can access all portfolio entries in the vault
- can create entries
- can update any entry in the vault
- can delete entries
- can run unauthorized-check

### User (`SUB`)

- can access only portfolio entries whose `owner_token_id` matches that SUB token
- can update only owned entries
- cannot create entries
- cannot delete entries
- cannot run unauthorized-check

## 8) Unauthorized DB Modification Detection

Route:

- `GET /api/security/unauthorized-check`

Mechanism:

- every `portfolio_entries` row stores an `integrity_hash`
- the hash is computed from vault, owner token, title, content, status, and a server secret
- if a row is modified directly in MySQL without recomputing the hash, the route returns it as tampered
- `integrity_hash` is also indexed so direct hash-based integrity lookups remain cheap

Environment variable:

- `PORTFOLIO_INTEGRITY_SECRET`

## 9) Audit Logging

File path:

- [audit.log](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/logs/audit.log)

Logged actions include:

- successful login
- denied login
- portfolio create/update/delete
- denied portfolio read/update attempts
- unauthorized-check execution

## 10) SQL Optimization Evidence

Files:

- [index_benchmark.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/reports/index_benchmark.js)
- [optimization_report.md](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/reports/optimization_report.md)

The benchmark focuses on this protected RBAC listing pattern:

```sql
SELECT benchmark_id, title, updated_at
FROM portfolio_benchmark_entries
WHERE vault_id = ?
  AND owner_token_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 25
```

Matching production index:

```sql
CREATE INDEX idx_portfolio_vault_owner_status
ON portfolio_entries(vault_id, owner_token_id, status, updated_at);
```

Additional production indexes now applied in the schema/runtime optimizer:

```sql
CREATE INDEX idx_inner_tokens_lookup_hash
ON inner_tokens(token_lookup_hash, vault_id, status);

CREATE INDEX idx_file_key_access_token
ON file_key_access(inner_token_id);

CREATE INDEX idx_download_file_time
ON download_logs(file_id, download_time);

CREATE INDEX idx_download_token
ON download_logs(inner_token_id);

CREATE INDEX idx_files_deleted_at
ON files(deleted_at);

CREATE INDEX idx_auth_attempts_session_time
ON auth_attempts(session_id, attempt_time, success);

CREATE INDEX idx_portfolio_integrity_hash
ON portfolio_entries(integrity_hash);
```

Reordered indexes:

```sql
CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);
CREATE INDEX idx_expiry_jobs_sched ON expiry_jobs(processed, scheduled_time);
```

## 11) Security Notes

- `x-forwarded-for` is trusted only when `TRUST_PROXY=true`
- CAPTCHA double-counting was removed from request prechecks
- CAPTCHA in the frontend now uses a solved window to reduce repeated prompts in the same flow
- outer-token QR scanning is available in the access view when the browser supports it
- legacy Ghost Drop routes remain available

## 12) Run Instructions

```powershell
cd Ghost_Drop/backend
mysql -u root -p < sql/init_schema.sql
npm install
npm run dev
```

Health endpoint:

- `http://localhost:4000/api/health`

Example login:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"outerToken\":\"OUTER123\",\"innerToken\":\"MainInner123\"}"
```

## 13) Source Files

- [app.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/app.js)
- [auth.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/routes/auth.js)
- [portfolio.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/routes/portfolio.js)
- [security.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/routes/security.js)
- [authSession.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/services/authSession.js)
- [portfolioIntegrity.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/services/portfolioIntegrity.js)
- [fileAuditLogger.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/src/services/fileAuditLogger.js)
- [init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/backend/sql/init_schema.sql)
- [index.html](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/frontend/index.html)
- [app.js](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/frontend/app.js)
- [styles.css](/F:/SEM%20IV/lessons/DB/Project/Ghost_Drop/frontend/styles.css)

