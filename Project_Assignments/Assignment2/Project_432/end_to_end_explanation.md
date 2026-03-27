# Project_432 End-To-End Explanation

## 1. What This File Is

This document is meant to take a person from zero knowledge of `Project_432` to full working understanding.

It explains:

- what problem the project solves
- why the project is designed this way
- what technologies are used
- how the database is structured
- how authentication and authorization work
- how files move through the system
- how the Module B assignment requirements are satisfied
- how integrity checking, audit logging, and indexing work
- what has been hardened beyond the original version

If someone reads this file carefully, they should be able to understand the entire project at both conceptual and implementation level.

## 2. Project Identity

`Project_432` is a project called **BlindDrop**.

At the product level, BlindDrop is a **secure temporary vault-based file transfer system**.

The main idea is:

- a sender creates a vault
- uploads one or more files
- receives an **outer token** for vault discovery
- controls access with one or more **inner tokens**
- can optionally create restricted SUB tokens for limited access
- files can be downloaded securely and then invalidated

At the assignment level, the project was extended to satisfy **Module B** requirements such as:

- login and session validation
- role-based access control
- CRUD API endpoints
- audit logging
- unauthorized direct database modification detection
- SQL indexing and performance evidence

So the project is not just a CRUD assignment. It is a real file-sharing application with an academic RBAC/API layer added in a technically consistent way.

It now also includes a **Module A integration layer** inside `CS432_Track1_Submission/Module_A/integration`, which reuses the existing Python B+ Tree to demonstrate custom indexing on BlindDrop-shaped query paths.

## 3. Core Idea in Simple Words

Most file-sharing systems either:

- keep a permanent account model
- expose files too broadly
- do not separate public discovery from private authorization

BlindDrop does something different:

- **outer token** is public-ish and can be shared to identify the vault
- **inner token** is private and is needed for actual access

This creates a layered security model:

- the outer token alone is not enough
- the inner token alone is not enough unless used with the correct vault

This is the core security model of the product.

## 4. Why This Project Was Extended for Module B

The assignment needed a protected CRUD resource and RBAC proof.

The original BlindDrop model already had:

- `vaults`
- `inner_tokens`
- `files`
- download rules
- Google Drive integration
- rate limiting and CAPTCHA

But these tables were not ideal as a clean RBAC CRUD demo resource.

### Why existing tables were not enough

`vaults`
- represent containers, not ordinary user-managed records

`inner_tokens`
- are credentials and security secrets
- treating them as CRUD content would be poor design

`files`
- are tightly coupled to upload/download lifecycle
- include one-time deletion behavior
- include Drive blob metadata and file-key mappings
- would make CRUD evaluation confusing

### Solution

A dedicated table called `portfolio_entries` was added.

This table is:

- vault-scoped
- owner-aware
- role-protected
- integrity-protected
- suitable for CRUD evaluation
- suitable for indexing and benchmark demonstration

This was the correct design decision because it keeps the product model clean while still satisfying the assignment.

## 5. High-Level Architecture

The project is divided into several layers.

### Frontend

Files:

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`

Purpose:

- shows landing page and features
- creates vaults
- uploads files/folders
- scans QR codes
- accesses vaults
- manages SUB tokens
- shows file list
- handles CAPTCHA retry
- gives UI feedback for errors and security alerts

### Backend

Main server:

- `backend/src/app.js`

Purpose:

- loads environment configuration
- mounts API routes
- serves static frontend
- exposes health check
- runs global error handling
- starts optional background integrity scan

### Database

Technology:

- MySQL
- InnoDB

Purpose:

- stores vault metadata
- stores token records
- stores file metadata
- stores session and audit-related records
- stores portfolio CRUD data
- supports indexing and relational integrity

### External Blob Storage

Technology:

- Google Drive API

Purpose:

- stores actual file contents
- database stores metadata and access control

### Local Audit Logging

Location:

- `backend/logs/audit.log`

Purpose:

- stores structured JSON-line log events
- now includes a tamper-evident hash chain

### Module A Integration Layer

Location:

- `CS432_Track1_Submission/Module_A/integration`

Purpose:

- reuse the existing Python B+ Tree implementation from the legacy Module A deliverable
- map it to actual BlindDrop access paths
- provide a project-specific demo and benchmark

## 6. Technology Stack

### Backend stack

- Node.js
- Express
- mysql2/promise
- dotenv
- multer
- googleapis
- qrcode
- uuid
- cors

### Frontend stack

- plain HTML
- plain CSS
- plain JavaScript
- browser APIs such as:
  - `fetch`
  - `getUserMedia`
  - `BarcodeDetector`

### Why this stack makes sense

- Express is simple and appropriate for local API work
- MySQL is suitable for structured RBAC/data relationships
- Google Drive avoids storing file blobs directly in MySQL
- vanilla frontend keeps deployment and explanation simple

## 7. Folder Structure

Important areas:

- `Project_432/backend/`
- `Project_432/frontend/`
- `Project_432/docs/`
- `CS432_Track1_Submission/`

### Backend substructure

- `src/app.js`
- `src/routes/`
- `src/services/`
- `src/middleware/`
- `sql/init_schema.sql`
- `reports/index_benchmark.js`

### Frontend substructure

- `index.html`
- `app.js`
- `styles.css`

### Track 1 package substructure

Contains:

- report documents
- demo guide
- API reference
- video guide
- presentation script
- evidence generator
- examiner cheat sheet

## 8. The Security Model

This is one of the most important parts of the project.

### Outer token

The outer token is:

- public-facing
- short
- used to identify the vault
- can be typed or scanned via QR

The outer token does **not** grant access by itself.

### Inner token

The inner token is:

- private
- required for real authorization
- either `MAIN` or `SUB`

### MAIN token

The MAIN token is the full-control token.

It acts as:

- vault admin
- uploader
- SUB-token creator
- full portfolio admin in the Module B layer

### SUB token

The SUB token is restricted.

It acts as:

- limited vault user
- file-scoped recipient
- restricted portfolio user in the Module B layer

## 9. Module B Role Mapping

The assignment required RBAC.

The project maps the real product roles directly:

- `MAIN` -> `admin`
- `SUB` -> `user`

This is better than inventing fake credentials, because:

- it matches the product logic
- it avoids a second inconsistent auth system
- it makes the RBAC explanation cleaner

## 10. Authentication Flow

### Product access flow

The product access flow is:

1. user knows the outer token
2. user supplies inner token
3. backend resolves vault
4. backend verifies inner token belongs to that vault
5. backend returns accessible files and token type

### Module B login flow

Separate routes were added:

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

The login flow:

1. user sends `outerToken` and `innerToken`
2. backend resolves vault
3. backend verifies token hash
4. backend derives role from token type
5. backend creates a session token

The session token is then used for protected portfolio APIs.

## 11. Session Model

The project uses in-memory session tokens for Module B routes.

Session information includes:

- session token
- vault ID
- outer token
- inner token ID
- token type
- role
- issue time
- last seen time
- vault expiry time

### Important hardening

Originally, in-memory session existence alone could have been enough.

That was strengthened.

Now protected requests also revalidate:

- vault status in MySQL
- vault expiry
- token status in MySQL

So if:

- a vault expires
- a token is revoked

then the session becomes invalid immediately on protected access.

## 12. Database Schema Overview

Main schema file:

- `backend/sql/init_schema.sql`

### Core product tables

`vaults`
- stores vault identity
- stores outer token
- stores expiry and status

`inner_tokens`
- stores MAIN and SUB token records
- stores PBKDF2 hash, salt, iteration count, status

`files`
- stores file metadata and lifecycle state
- links to vault
- stores Drive file ID

`file_metadata`
- stores display metadata such as filename and path

`file_key_access`
- maps which token can access which file

`sessions`
- stores browser/session-level metadata used by the security layer

`auth_attempts`
- stores auth-related audit attempts

`download_logs`
- stores download activity

`captcha_tracking`
- stores CAPTCHA enforcement state

`expiry_jobs`
- stores vault expiry scheduling metadata

### Module B table

`portfolio_entries`
- the main protected CRUD resource for evaluation

### Runtime helper table

`sub_token_secrets`
- created by the app
- used to store recoverable SUB values for management UI display

## 13. `portfolio_entries` Table

This table is central to the Module B layer.

Fields:

- `entry_id`
- `vault_id`
- `owner_token_id`
- `created_by_token_id`
- `title`
- `content`
- `integrity_hash`
- `status`
- `created_at`
- `updated_at`

### Meaning of important fields

`owner_token_id`
- who owns the row for RBAC purposes

`created_by_token_id`
- who created the row originally

`status`
- `ACTIVE` or `DELETED`

`integrity_hash`
- application-level protection against unauthorized DB changes

## 14. Database-Level Hardening

Hardening was added not only in the app but also at the database layer.

### Immutable-field trigger

A MySQL trigger prevents tampering with:

- `created_at`
- `created_by_token_id`

after insertion.

So even if someone tries to update those fields directly, the database rejects it.

This is stricter than only relying on application logic.

## 15. How Token Storage Works

Inner tokens are never stored as plaintext auth credentials.

They are processed through:

- PBKDF2-SHA256
- random salt
- configurable iterations

The project uses timing-safe comparison for verification.

This is important because:

- leaked DB rows should not reveal raw tokens
- brute-force resistance is higher than plain hashing

## 16. Vault Creation Flow

Main route:

- `POST /api/files/new-vault-upload`

Process:

1. validate security prechecks
2. validate files
3. upload files to Google Drive
4. create vault row
5. create MAIN token row
6. create file metadata rows
7. create access mapping rows
8. create initial portfolio activity entry
9. create expiry job

Result:

- vault exists
- outer token is generated
- MAIN token is active
- files are available

## 17. Existing Vault Access Flow

Main route:

- `POST /api/vaults/:outerToken/access`

Process:

1. outer token is resolved to a vault
2. vault status and expiry are checked
3. inner token is verified
4. token type is identified
5. allowed files are returned

If user is `MAIN`:

- broader access
- can create SUB tokens

If user is `SUB`:

- only scoped files are returned

## 18. SUB Token Flow

Main routes:

- `POST /api/files/:outerToken/sub-tokens`
- `GET /api/files/:outerToken/sub-tokens`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`
- `DELETE /api/files/:outerToken/sub-tokens/:tokenId`

Purpose:

- allow a MAIN user to create restricted recipients
- map only selected files to each SUB token
- allow reassignment and revocation

This is one of the product’s strongest features because it provides scoped sharing rather than all-or-nothing sharing.

## 19. File Download Flow

Main route:

- `POST /api/files/:fileId/download`

Process:

1. validate outer token and inner token
2. verify file belongs to the vault
3. verify token can access the file
4. lock DB row
5. download blob from Drive
6. logically delete file row
7. delete file key mappings
8. insert download log
9. attempt Drive cleanup

This supports the product goal of temporary secure file retrieval.

## 20. Portfolio CRUD APIs

Main routes:

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

### Admin behavior

Admin can:

- list all active entries in the vault
- create entries
- update any active visible entry in the vault
- delete entries

### User behavior

User can:

- list only owned active entries
- read owned active entries
- update owned active entries

User cannot:

- create entries
- delete entries
- access entries owned by others

## 21. Passive Integrity Guard

This is a major hardening feature.

Originally, tamper detection was only on-demand.

That means an admin had to call:

- `GET /api/security/unauthorized-check`

to detect corruption.

### Improvement

Now portfolio reads also check integrity automatically.

This means:

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`

perform integrity validation before returning data.

If a row is tampered:

- it is blocked from being shown
- a `CRITICAL` audit event is logged
- the API returns a security-alert response

This is better because the system actively protects the user.

## 22. Integrity Hashing

Integrity hash is computed from:

- `vaultId`
- `ownerTokenId`
- `title`
- `content`
- `status`
- `PORTFOLIO_INTEGRITY_SECRET`

Hash algorithm:

- SHA-256

If the row changes directly in MySQL but the hash is not recomputed, the system identifies a mismatch.

## 23. Integrity Secret Safety

The code includes a development default secret.

However, production was hardened:

- if `PORTFOLIO_INTEGRITY_SECRET` is still the default in production mode
- the server fails at startup

This prevents accidental insecure deployment.

## 24. Unauthorized Check Route

Route:

- `GET /api/security/unauthorized-check`

Purpose:

- admin-only integrity review
- scans portfolio rows
- returns tampered entries

This is useful for:

- admin audit review
- demo evidence
- examiner proof

## 25. Background Integrity Scan

An optional background scan can run based on:

- `PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS`

If enabled:

- the backend periodically scans all portfolio rows
- logs critical events for tampered entries

This complements passive read-time protection and admin-triggered checks.

## 26. Audit Logging

Audit logger file:

- `backend/src/services/fileAuditLogger.js`

Audit output:

- `backend/logs/audit.log`

### What gets logged

- login success
- login denial
- portfolio create/update/delete
- denied portfolio access
- unauthorized-check execution
- passive tamper block events
- background integrity scan events

## 27. Chained Audit Log Design

The project goes beyond ordinary flat logging.

Each log entry includes:

- timestamp
- severity
- session ID when available
- IP address
- user agent
- previous hash
- entry hash

### Why this matters

If someone deletes or reorders lines in the log:

- the chain becomes invalid

So the audit log becomes **tamper-evident**.

## 28. Log Rotation and Sealed Blocks

Another hardening feature:

- active audit log rotates after a configured number of entries
- default block size is `1000`

Behavior:

- current `audit.log` is renamed to `audit_block_N.log.sealed`
- new `audit.log` begins
- the new chain starts from the final hash of the previous block

This solves the problem of unbounded growth and keeps validation practical.

## 29. Security and Rate Limiting

Security service:

- `backend/src/services/security.js`

### Existing IP-based protections

- per-minute rate limiting
- per-day rate limiting
- CAPTCHA triggering
- weighted failure scores
- temporary blocks

### Added token-based protection

Portfolio APIs now also rate-limit by authenticated principal.

This means:

- even if an attacker changes IP
- one valid token cannot spam `/api/portfolio` indefinitely

This is stricter than IP-only defense.

## 30. CAPTCHA Design

The project uses a simple arithmetic challenge.

Why this is okay:

- assignment scope is local
- goal is to demonstrate challenge/response protection
- avoids unnecessary third-party service dependency

Also improved:

- short CAPTCHA solved window
- same user can retry protected flow without immediate re-prompt

## 31. Input Validation

Portfolio routes now reject unexpected fields.

This prevents attempts to submit fields such as:

- `integrity_hash`
- `created_at`
- other non-API-managed columns

This is important because a strict API should not accept extra attacker-controlled fields silently.

## 32. Error Handling

In development:

- more details can be exposed for debugging

In production:

- the backend avoids returning raw internal details by default

This reduces error leakage such as:

- raw SQL errors
- internal server internals

## 33. Frontend UI Design

The frontend is not a placeholder.

It includes:

- landing page
- feature overview
- create-vault view
- access view
- vault details view
- file list
- token management
- upload-more view
- QR scan UI
- CAPTCHA UI

It is intended to make the project feel like a real product, not just a backend demo.

## 34. Frontend Security Feedback

If the passive integrity guard blocks a portfolio entry:

- backend sends `securityAlert: true`

The frontend then:

- shows a special error style
- labels it as a security alert

This is better than a generic error because it tells the user:

- the system is actively protecting them from suspicious data

## 35. SQL Indexing

The project added indexes based on actual query patterns.

Main indexes:

```sql
idx_portfolio_vault_owner_status (vault_id, owner_token_id, status, updated_at)
idx_portfolio_vault_status (vault_id, status, updated_at)
idx_portfolio_integrity_hash (integrity_hash)
idx_inner_tokens_lookup_hash (token_lookup_hash, vault_id, status)
idx_file_key_access_token (inner_token_id)
idx_download_file_time (file_id, download_time)
idx_download_token (inner_token_id)
idx_auth_attempts_session_time (session_id, attempt_time, success)
idx_files_deleted_at (deleted_at)
```

### Why this order

Because the query usually filters by:

- vault
- owner
- active status

and orders by:

- `updated_at DESC`

This makes the query much more efficient.

The vault worker indexes were also reordered to align with equality-first filtering:

- `idx_vault_expiry (status, expires_at)`
- `idx_expiry_jobs_sched (processed, scheduled_time)`

## 36. Benchmarking

Benchmark file:

- `backend/reports/index_benchmark.js`

Purpose:

- prove index effect with actual timings
- compare full scan vs indexed access
- extended to compare covering-style stage too

Observed result already captured:

- before index: about `270.93 ms`
- after composite index: about `21.12 ms`

This is strong evidence because it uses:

- timing
- `EXPLAIN`
- before/after comparison

## 37. Module B Evidence Route

Route:

- `GET /api/module-b/evidence`

Purpose:

- make evaluation easy

It returns:

- RBAC mapping
- integrity summary
- tampered count
- audit totals
- hash-chain validity
- current portfolio indexes
- `EXPLAIN` plan

This is extremely useful for:

- demos
- viva
- instructor evaluation

## 38. Routes Overview

### Auth routes

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

### Portfolio routes

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

### Security routes

- `GET /api/security/captcha`
- `POST /api/security/captcha/verify`
- `GET /api/security/captcha/required`
- `GET /api/security/status`
- `GET /api/security/unauthorized-check`

### Module B route

- `GET /api/module-b/evidence`

### Vault routes

- `POST /api/vaults`
- `GET /api/vaults/:outerToken/public-info`
- `POST /api/vaults/:outerToken/access`
- `POST /api/vaults/:outerToken/sub-tokens`
- `GET /api/vaults/:outerToken/qr`

### File routes

- `POST /api/files/new-vault-upload`
- `POST /api/files/:outerToken/upload`
- `GET /api/files/:outerToken/list`
- `POST /api/files/:outerToken/sub-tokens`
- `GET /api/files/:outerToken/sub-tokens`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`
- `DELETE /api/files/:outerToken/sub-tokens/:tokenId`
- `POST /api/files/:fileId/download`

## 39. Important Backend Files

These are the files a technical reviewer should know first.

### App startup

- `backend/src/app.js`

### Routes

- `backend/src/routes/auth.js`
- `backend/src/routes/portfolio.js`
- `backend/src/routes/security.js`
- `backend/src/routes/moduleB.js`
- `backend/src/routes/vaults.js`
- `backend/src/routes/files.js`

### Services

- `backend/src/services/authSession.js`
- `backend/src/services/security.js`
- `backend/src/services/portfolioIntegrity.js`
- `backend/src/services/fileAuditLogger.js`
- `backend/src/services/portfolioService.js`
- `backend/src/services/driveService.js`
- `backend/src/services/crypto.js`
- `backend/src/services/vaultAccess.js`

### Database

- `backend/sql/init_schema.sql`

### Benchmark

- `backend/reports/index_benchmark.js`

## 40. Important Frontend Files

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`

## 41. How the Project Satisfies Module B

### Login

Yes:

- `POST /api/auth/login`

### Session validation

Yes:

- `GET /api/auth/isAuth`

### RBAC

Yes:

- `MAIN` as admin
- `SUB` as user

### CRUD

Yes:

- `portfolio_entries` resource

### Unauthorized direct DB modification detection

Yes:

- integrity hash
- unauthorized-check route
- passive read-time guard

### Audit log

Yes:

- structured hash-chained audit log

### SQL optimization

Yes:

- composite indexes
- benchmark evidence
- explain plans

## 42. Why This Project Is Stronger Than a Minimal Assignment

Many assignments only do:

- simple login
- simple CRUD
- simple role check

This project goes further:

- real product context
- real security model
- scoped file sharing
- QR-based access flow
- CAPTCHA and abuse protection
- audit trail
- tamper-evident logs
- database triggers
- passive integrity blocking
- benchmark-backed indexing
- evaluator evidence route

That makes it technically richer and easier to defend in viva.

## 43. Current Limitations

No project is perfect.

Important limitations:

- session storage is still in-memory
- some security state is also in-memory
- full roles/permissions table is not implemented yet
- Google Drive configuration is needed for full file-flow demo
- integrity protection currently focuses on portfolio resource, not every table

These do not break the project, but they are honest architectural boundaries.

## 44. If Someone Wants to Understand the Project Quickly

Read in this order:

1. this file
2. `backend/src/app.js`
3. `backend/src/routes/portfolio.js`
4. `backend/src/services/portfolioIntegrity.js`
5. `backend/src/services/fileAuditLogger.js`
6. `backend/sql/init_schema.sql`
7. `backend/reports/index_benchmark.js`
8. `frontend/app.js`

That order gives a fast but strong understanding.

## 45. If Someone Wants to Explain the Project in One Minute

Use this:

`Project_432, or BlindDrop, is a secure temporary vault-based file transfer system built with Node.js, Express, MySQL, Google Drive, and a static frontend. It uses an outer token for vault discovery and inner tokens for authorization. MAIN tokens act as admins and SUB tokens act as restricted users. For Module B, the project adds authenticated session APIs, RBAC CRUD on a dedicated portfolio_entries table, direct DB tamper detection through integrity hashing, hash-chained audit logging, and benchmark-backed SQL indexing. It also includes passive protection so tampered portfolio rows are blocked before reaching the user.`

## 46. Final Understanding

At the deepest level, `Project_432` is about **controlled access to sensitive data**.

It combines:

- vault isolation
- layered token authorization
- scoped sharing
- file lifecycle control
- application-level and database-level tamper defenses
- audit visibility
- performance optimization

So the project is not just about “making APIs work.”

It is about designing a coherent secure system where:

- data access is deliberate
- roles are meaningful
- unauthorized changes are detectable
- logs are trustworthy
- performance is measurable
- the evaluator can clearly verify all of it

That is the complete end-to-end understanding of `Project_432`.
