# Technical Architecture And Stack

## 1. Architectural view

The submission combines one real application domain with two assignment-facing modules:

- **BlindDrop product layer**
  secure temporary file sharing through expiring vaults
- **Module A layer**
  a standalone Python B+ Tree database engine plus BlindDrop-specific indexing and benchmarking
- **Module B layer**
  a local authenticated web application layer with RBAC, auditability, tamper detection, and SQL optimization

This is important because the submission is not a pair of disconnected artifacts. Both modules are grounded in the same product and data domain.

## 2. Core technology stack

### Product and Module B stack

- **Backend runtime:** Node.js
- **Web framework:** Express
- **Database:** MySQL 8 / InnoDB
- **Blob storage:** Google Drive
- **Frontend:** static HTML, CSS, and vanilla JavaScript served by Express

### Module A stack

- **Language:** Python
- **Data structure:** custom B+ Tree implemented from scratch
- **Visualization:** Graphviz-backed rendering scripts
- **Analysis artifacts:** JSON outputs, Markdown summaries, PNG plots, and notebook report

## 3. High-level component model

### 3.1 Frontend

The frontend provides the user-facing BlindDrop flows:

- vault creation
- file upload
- vault access
- QR-based outer-token usage
- SUB token management
- error and feedback handling

It is intentionally lightweight and does not rely on a large frontend framework.

### 3.2 Backend

The Express backend is responsible for:

- serving static frontend assets
- handling API requests
- validating vault and token access
- managing sessions for Module B
- enforcing RBAC on portfolio routes
- maintaining anti-abuse logic
- writing audit logs
- exposing evaluator-friendly evidence endpoints

### 3.3 Database

MySQL stores the authoritative relational state for:

- vaults
- tokens
- files
- access mappings
- sessions and auth attempts
- downloads
- expiry jobs
- portfolio entries

### 3.4 Module A engine

The Python B+ Tree layer is not the authoritative production database. It is the assignment-facing custom index engine. It is used to demonstrate:

- from-scratch B+ Tree logic
- range and exact lookup behavior
- comparison against brute force
- visualization
- domain-specific indexing over the exported BlindDrop dataset

## 4. Module A technical architecture

### 4.1 Standalone engine

The standalone Module A engine consists of:

- `Module_A/database/bplustree.py`
- `Module_A/database/bruteforce.py`
- `Module_A/database/table.py`
- `Module_A/database/db_manager.py`

This layer satisfies the direct assignment requirement for a custom B+ Tree and a lightweight table/database abstraction.

### 4.2 Integration layer

The integration layer uses the exported snapshot at:

- `Project_432/backend/database_export.json`

It derives realistic index paths from the BlindDrop dataset and feeds them into the custom tree implementation.

### 4.3 Indexed paths

The current integrated paths are:

- `outer_token -> vault_id`
- `expires_at_epoch -> vault_id[]`
- `(vault_id, status, created_at_epoch) -> file_id[]`
- `(session_id, attempt_time_epoch) -> auth_attempt_id[]`

### 4.4 Visualization pipeline

Graphviz-backed renderers generate the packaged tree PNGs and the accompanying render manifest. This makes the structure visible rather than leaving it as a purely textual or theoretical claim.

## 5. Module B technical architecture

### 5.1 Authentication and role mapping

Module B reuses the BlindDrop vault credential model:

- `MAIN` token -> `admin`
- `SUB` token -> `user`

Authentication endpoints:

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

Protected requests use a session token while still revalidating vault and token state against MySQL.

### 5.2 CRUD resource design

The project introduces `portfolio_entries` as the Module B evaluation resource. This table was chosen because it supports:

- admin and owner-based visibility rules
- create, read, update, and delete behavior
- integrity hashing
- benchmarkable query patterns

### 5.3 Audit and integrity architecture

Two separate but related controls are implemented:

- **audit logging**
  append-only JSON-line events with chained hashes
- **portfolio integrity protection**
  row-level `integrity_hash` validation for unauthorized direct DB edit detection

### 5.4 Optimization architecture

The SQL optimization work is built around the actual RBAC list query used by the portfolio feature. This makes the benchmark defensible because the measured query path matches the protected application behavior.

## 6. Main backend route groups

- `/api/auth`
  session login and validation
- `/api/portfolio`
  RBAC CRUD over portfolio entries
- `/api/module-b`
  evaluator-facing summary endpoint
- `/api/vaults`
  vault lifecycle and access
- `/api/files`
  upload, listing, SUB token management, and download
- `/api/security`
  CAPTCHA, status, and unauthorized-check logic

## 7. Security architecture

### 7.1 Product security

- outer token for discovery
- inner token for secret authorization
- MAIN and SUB privilege separation
- one-time download behavior
- expiry-aware vault lifecycle

### 7.2 Credential protection

Inner tokens are stored using PBKDF2-SHA256 with salt and configurable iterations. A deterministic lookup hash is stored separately to support indexed candidate prefiltering without replacing the stronger salted verification process.

### 7.3 Session protection

Module B uses session tokens for protected CRUD routes, but authenticated requests still consult the authoritative DB state. This prevents stale sessions from remaining valid after vault expiry or token revocation.

### 7.4 Anti-abuse controls

The security service includes:

- rate limiting
- failure-weight tracking
- CAPTCHA challenge and verification
- temporary blocking
- solved-CAPTCHA reuse window

### 7.5 Auditability

The JSON-line audit log includes:

- timestamp
- severity
- session ID
- IP address
- user agent
- `previousHash`
- `entryHash`

This makes the packaged log evidence structured and tamper-evident.

## 8. Data and evidence architecture

The final submission is intentionally evidence-oriented.

### Module A evidence

- benchmark JSON outputs
- benchmark summaries
- dashboard plots
- rendered tree PNGs
- render manifest
- parity output

### Module B evidence

- API evidence
- DB evidence
- audit-log evidence
- benchmark evidence
- packaged `audit.log`

## 9. Architecture strengths

- one coherent domain across both modules
- real exported dataset feeding Module A integration
- realistic RBAC resource for Module B instead of an artificial user table
- benchmarking tied to real access patterns
- strong submission readability through packaged notebooks, Markdown, logs, and evidence
