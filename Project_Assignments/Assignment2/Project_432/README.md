# BlindDrop Initial Prototype (`Project_432`)

This project now serves three purposes:

- BlindDrop temporary vault/file-sharing prototype
- Module B aligned local API app using vault credentials as authentication
- Module A aligned integration surface using the existing Python custom B+ Tree for BlindDrop-shaped indexing demonstrations

## Current Model  :- specific to a vault

- `outerToken + MAIN innerToken` => vault `admin`
- `outerToken + SUB innerToken` => vault `user`

That is the Module B role model for this project. There is no separate `admin/admin123` style login table.

## Core Flows

- Upload: MAIN inner token + files -> vault creation + Drive upload
- Download: outer token/QR + inner token -> one-time download + logical delete
- Sub-token management: MAIN-only scoped SUB token creation and reassignment
- Security: one-time CAPTCHA solve window + rate limiting + session auditing
- Vault access UX: outer token can be typed or scanned from QR
- Module B alignment:
  - `POST /api/auth/login`
  - `GET /api/auth/isAuth`
  - RBAC CRUD under `/api/portfolio`
  - tamper detection at `/api/security/unauthorized-check`
  - audit log file at `backend/logs/audit.log`
  - SQL indexing evidence in `backend/reports`
- Module A alignment:
  - custom B+ Tree integration under `module_a/`
  - BlindDrop-specific index paths and benchmark scripts

## Module A Mapping

The existing Python Module A implementation is reused through a project-local integration layer in:

- `module_a/`

It demonstrates BlindDrop-specific custom indexing for:

- `outer_token -> vault_id`
- `expires_at -> vault_id[]`
- `(vault_id, status, created_at) -> file_id[]`
- `(session_id, attempt_time) -> auth_attempt_id[]`

This keeps the relational DB authoritative while showing how a custom B+ Tree can accelerate real project access paths.

## Module B Mapping

### Login and Session Validation

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

The login API validates `outerToken + innerToken`, resolves the vault role, and returns a session token for protected APIs.

For the BlindDrop access UI:

- outer token can be entered manually or scanned through the browser camera
- inner token remains the private vault credential

### RBAC

- `MAIN` inner token => `admin`
- `SUB` inner token => `user`

Permissions:

- `admin` can create, read, update, and delete portfolio entries for the vault
- `user` can read and update only portfolio entries owned by that SUB token

### CRUD Choice

Existing file/folder display alone is not enough to represent full Module B CRUD cleanly. To make the mapping complete, this project now includes `portfolio_entries`, a vault-scoped resource specifically for:

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
3. Google Drive credentials for the BlindDrop file-storage flow

## Quick Start

1. Initialize schema:

```bash
mysql -u root -p < backend/sql/init_schema.sql
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

## Module B Demo Flow

1. Create a vault with a MAIN token using the BlindDrop upload flow.
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
- The legacy BlindDrop routes remain intact; the Module B layer is additive.
