# Ghost Drop Initial Prototype (`Ghost_Drop`)

This project now serves three purposes:

- Ghost Drop temporary vault/file-sharing prototype
- Portfolio security API layer with vault-credential authentication
- B+ tree indexing integration layer using the existing Python custom implementation for Ghost Drop query paths

## Current Model (Vault-Scoped)

- `outerToken + MAIN innerToken` => vault `admin`
- `outerToken + SUB innerToken` => vault `user`

That is the project RBAC role model. There is no separate `admin/admin123` style login table.


## Documentation

- Project Architecture Guide: docs/PROJECT_DOCUMENTATION.md
- API Requests Guide: docs/JSON_API_REQUESTS_PRO_GUIDE.md
- Encryption Reference: docs/ENCRYPTION_REFERENCE.md
- Security Limits Reference: docs/SECURITY_LIMITS_REFERENCE.md

## Core Flows

- Upload: MAIN inner token + files -> vault creation + Drive upload
- Download: outer token/QR + inner token -> single-file download or batch ZIP download + logical delete
- Sub-token management: MAIN-only scoped SUB token creation and reassignment
- Security: one-time CAPTCHA solve window + rate limiting + session auditing
- Batch download cap is controlled by `BATCH_DOWNLOAD_MAX_FILES` (default `10`)
- Vault access UX: outer token can be typed or scanned from QR
- Portfolio security API layer:
  - `POST /api/auth/login`
  - `GET /api/auth/isAuth`
  - RBAC CRUD under `/api/portfolio`
  - tamper detection at `/api/security/unauthorized-check`
  - audit log file at `backend/logs/audit.log`
  - SQL indexing evidence in `backend/reports`
- B+ tree indexing integration:
  - custom B+ Tree integration under `module_a/`
  - Ghost Drop-specific index paths and benchmark scripts

## B+ Tree Indexing Mapping

The existing Python B+ tree implementation is reused through a project-local integration layer in:

- `module_a/`

It demonstrates Ghost Drop-specific custom indexing for:

- `outer_token -> vault_id`
- `expires_at -> vault_id[]`
- `(vault_id, status, created_at) -> file_id[]`
- `(session_id, attempt_time) -> auth_attempt_id[]`

This keeps the relational DB authoritative while showing how a custom B+ Tree can accelerate real project access paths.

## Portfolio Security API Mapping

### Login and Session Validation

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

The login API validates `outerToken + innerToken`, resolves the vault role, and returns a session token for protected APIs.

For the Ghost Drop access UI:

- outer token can be entered manually or scanned through the browser camera
- inner token remains the private vault credential

### RBAC

- `MAIN` inner token => `admin`
- `SUB` inner token => `user`

Permissions:

- `admin` can create, read, update, and delete portfolio entries for the vault
- `user` can read and update only portfolio entries owned by that SUB token

### CRUD Choice

Existing file/folder display alone is not enough to represent a full protected CRUD surface. To complete the feature set, this project includes `portfolio_entries`, a vault-scoped resource specifically for:

- protected CRUD
- role enforcement
- unauthorized DB modification detection
- SQL indexing demonstration

APIs:

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

### Unauthorized DB Modification Detection

- `GET /api/security/unauthorized-check`

Each portfolio row carries an integrity hash. Direct DB edits that bypass the app can be detected by this route.

## Schema Optimization Notes

The project now includes a startup schema reconciler in `backend/src/services/schemaOptimization.js` so existing local databases can be brought in line with the latest index design.

Important additions:

- indexed token prefiltering through `inner_tokens.token_lookup_hash`
- `file_key_access(inner_token_id)` for token-first access mapping
- `download_logs(file_id, download_time)` and `download_logs(inner_token_id)`
- `files(deleted_at)` for cleanup scans
- `auth_attempts(session_id, attempt_time, success)` for session analysis
- `portfolio_entries(integrity_hash)` for tamper-related lookups
- reordered `vaults(status, expires_at)` and `expiry_jobs(processed, scheduled_time)`
- `vaults.outer_token` uses the `UNIQUE` key directly for discovery lookups, so the separate `idx_vault_token` index was removed as redundant

Current query-to-index matchups:

- `SELECT ... FROM vaults WHERE outer_token = ?` uses the `UNIQUE` key on `outer_token`
- `SELECT ... FROM vaults WHERE status = ? ORDER BY expires_at` uses `idx_vault_expiry`
- `SELECT ... FROM inner_tokens WHERE token_lookup_hash = ? AND vault_id = ? AND status = ?` uses `idx_inner_tokens_lookup_hash`
- `SELECT ... FROM files WHERE vault_id = ? AND status = ? ORDER BY created_at DESC` uses `idx_files_vault_status`
- `SELECT ... FROM files WHERE deleted_at IS NOT NULL` uses `idx_files_deleted_at`
- `SELECT ... FROM download_logs WHERE file_id = ? ORDER BY download_time DESC` uses `idx_download_file_time`
- `SELECT ... FROM download_logs WHERE inner_token_id = ?` uses `idx_download_token`
- `SELECT ... FROM auth_attempts WHERE session_id = ? ORDER BY attempt_time DESC` uses `idx_auth_attempts_session_time`
- `SELECT ... FROM portfolio_entries WHERE vault_id = ? AND status = ? ORDER BY updated_at DESC` uses `idx_portfolio_vault_status`
- `SELECT ... FROM portfolio_entries WHERE vault_id = ? AND owner_token_id = ? AND status = ? ORDER BY updated_at DESC` uses `idx_portfolio_vault_owner_status`

## ER Diagram

The current database model is documented visually here:

- Basic ER diagram: add `docs/er/ghostdrop_er_basic.png` if you want image-based schema documentation in-repo.
- Formal ER diagram: add `docs/er/ghostdrop_er_formal.png` for full cardinality notation.

These diagrams reflect the schema in `backend/sql/init_schema.sql`, including the `portfolio_entries` table added for authenticated portfolio CRUD.

## Key Backend Files

- `backend/src/routes/auth.js`
- `backend/src/routes/portfolio.js`
- `backend/src/routes/security.js`
- `backend/src/services/authSession.js`
- `backend/src/services/portfolioIntegrity.js`
- `backend/src/services/fileAuditLogger.js`
- `backend/sql/init_schema.sql`
- `backend/reports/index_benchmark.js`
- `backend/reports/optimization_report.md`

## Key Frontend Files

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`

## Prerequisites

1. Node.js 18+
2. MySQL 8+
3. Google Drive credentials for the Ghost Drop file-storage flow

## Quick Start

1. Initialize schema:

```bash
mysql -u root -p < backend/sql/init_schema.sql
```

PowerShell alternative:

```powershell
Get-Content ".\backend\sql\init_schema.sql" | mysql --force -u root -p ghostdrop_proto
```

2. Configure `backend/.env`

3. Run:

```bash
cd backend
npm install
npm run dev
```

4. App URLs:

- App: `http://localhost:4000`
- Health: `http://localhost:4000/api/health`

## Current Access UX

- vault creator receives an outer token and QR
- vault recipient can:
  - type the outer token
  - scan the outer-token QR with the browser camera
- if abuse protection triggers, the user solves one CAPTCHA challenge and the pending action is retried without immediately prompting again

## Portfolio Security API Demo Flow

1. Create a vault with a MAIN token using the Ghost Drop upload flow.
2. Create at least one SUB token for that vault.
3. Log in as vault admin:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"outerToken\":\"OUTER123\",\"innerToken\":\"MainInner123\"}"
```

4. Use the returned session token in `Authorization: Bearer <token>`.
5. Call `GET /api/auth/isAuth`.
6. Use `/api/portfolio`:
   - admin creates/deletes entries
   - SUB user reads/updates only owned entries
7. Check `backend/logs/audit.log`.
8. Run `node reports/index_benchmark.js`.
9. Call `GET /api/security/unauthorized-check` as admin.

## Notes

- `TRUST_PROXY=true` is now required before `x-forwarded-for` is trusted.
- CAPTCHA double-counting was removed from the request precheck path.
- the frontend now keeps a short-lived solved-CAPTCHA window to avoid repeated prompts during the same protected flow
- the access screen now supports browser-based QR scanning for the outer token
- SUB token secret storage is encrypted at rest in `sub_token_secrets` (`secret_ciphertext`, `secret_iv`, `secret_auth_tag`, `secret_version`)
- SUB token admin reveal is available at `GET /api/files/:outerToken/sub-tokens/:tokenId/reveal`
- The legacy Ghost Drop routes remain intact; the portfolio security API layer is additive.
- Encryption details are documented in `docs/ENCRYPTION_REFERENCE.md`.
