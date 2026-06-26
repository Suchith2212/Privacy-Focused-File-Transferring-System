# 1. Executive Technical Overview

Ghost Drop is a vault-scoped secure file transfer system implemented as a single Node.js/Express service with a static browser frontend, a MySQL relational core, and Google Drive as external blob storage. The system separates public vault discovery from private authorization by using a two-token model:

- `outer_token`: short public locator used to identify a vault
- `inner_token`: secret credential used to authorize actions inside that vault

The implementation extends that transfer model with an authenticated Portfolio Security API layer, allowing the same vault credentials to establish a role-bearing session and operate on a protected CRUD resource (`portfolio_entries`). The result is one coherent architecture rather than two unrelated systems: file sharing, role-based access, anti-abuse controls, tamper detection, and audit logging are all anchored to the same vault and token identities.

The backend enforces:

- vault lifecycle control through `ACTIVE`, `EXPIRED`, and `DELETED` states
- `MAIN` versus `SUB` token role separation
- one-time download semantics by marking files deleted after successful delivery
- file-level scoped sharing through `file_key_access`
- PBKDF2-based token verification with HMAC-based indexed prefiltering
- encrypted file storage using per-file keys and AES-256-GCM
- encrypted-at-rest recoverable SUB token secret storage
- adaptive abuse prevention with IP limits, principal limits, CAPTCHA escalation, and temporary blocking
- tamper-evident operational auditing through a chained JSON log
- portfolio row integrity verification using a secret-derived SHA-256 hash

This document describes the system as implemented in `Ghost_Drop`, not as an aspirational design. Where behavior is inferred from code rather than explicitly documented, it is marked as **Architectural Inference**.

# 2. High-Level System Architecture

## 2.1 Component Topology

```text
Browser Frontend
  |
  | HTTP/JSON, multipart/form-data, binary download, ZIP download
  v
Express Application (backend/src/app.js)
  |
  +--> Route Layer
  |     - /api/vaults
  |     - /api/files
  |     - /api/auth
  |     - /api/portfolio
  |     - /api/security
  |     - /api/module-b
  |
  +--> Service Layer
  |     - vaultAccess
  |     - authSession
  |     - security
  |     - driveService
  |     - fileSecurityMetadata
  |     - portfolioIntegrity
  |     - fileAuditLogger
  |
  +--> MySQL
  |     - vault metadata
  |     - token hashes and access mappings
  |     - file metadata and lifecycle state
  |     - session/audit support tables
  |     - portfolio CRUD data
  |
  +--> Google Drive
        - ciphertext blob storage
```

## 2.2 Security-Layer Placement

```text
Incoming Request
  |
  +--> trust proxy gate for X-Forwarded-For
  +--> IP risk evaluation
  +--> adaptive blocking check
  +--> CAPTCHA requirement check
  +--> IP/global route rate-limit check
  +--> principal rate-limit check (selected authenticated APIs)
  +--> vault/token/session verification
  +--> route business logic
  +--> DB mutation / Drive I/O / audit logging
```

## 2.3 Storage Separation Model

```text
MySQL stores:
  - vaults
  - hashed tokens
  - wrapped per-file keys
  - metadata
  - lifecycle state
  - sessions
  - audit-support tables
  - portfolio integrity state

Google Drive stores:
  - encrypted file ciphertext only

Environment secrets store:
  - token lookup HMAC secret
  - SUB token encryption key seed
  - portfolio integrity secret
  - Google API credentials
```

## 2.4 Frontend, Backend, Database, Session, Encryption Relationships

| Layer | Primary responsibility | Security role | Failure implications |
|---|---|---|---|
| Frontend | collect tokens, upload files, display results, retry CAPTCHA, trigger downloads | does not enforce trust, only transmits and reacts | UI can fail without compromising backend controls |
| Express backend | authoritative request validation and orchestration | primary policy enforcement layer | route/service bugs directly affect confidentiality and integrity |
| MySQL | authoritative metadata, token hashes, lifecycle state, RBAC data | enforces FK integrity and trigger constraints | DB compromise exposes metadata; secrets and plaintext files remain partially separated |
| Google Drive | external ciphertext object store | stores encrypted blobs, not authorization state | Drive compromise leaks ciphertext, not automatically plaintext |
| Session layer | role-bearing short-lived access for portfolio/security APIs | revalidates vault and token state | current in-memory design limits horizontal scaling |
| Encryption layer | file encryption, key wrapping, SUB secret encryption | protects file confidentiality and secret recoverability | secret leakage collapses confidentiality guarantees |

# 3. Core Design Philosophy

## 3.1 Zero-Trust Assumptions

The code assumes that possession of an `outer_token` is insufficient for authorization. All meaningful access requires:

- vault resolution by outer token
- independent verification of an `inner_token`
- route-specific checks on token type, file mapping, session role, or vault status

This is a practical zero-trust posture at the application layer: public discoverability does not imply private access.

## 3.2 Separation of Keys and Storage

The system deliberately avoids storing plaintext files in MySQL and avoids storing decryptable file keys without a token-derived wrapping key. Google Drive receives encrypted file bytes; MySQL stores only metadata and wrapped keys. This reduces the blast radius of a single storage-domain compromise.

## 3.3 One-Time Access Philosophy

Single-file and batch-download routes both mark files `DELETED`, delete all `file_key_access` rows for the file, log the download, and then best-effort delete the Drive object. This is not just presentation logic. It is the core one-time-consumption policy.

## 3.4 Scoped Access Model

`MAIN` tokens are vault administrators. `SUB` tokens are restricted identities mapped to selected files through `file_key_access`. The system therefore models sharing as explicit cryptographic and relational access delegation rather than broad vault-level read access.

## 3.5 Layered Security

The implementation uses multiple non-substitutable controls:

- hashed credentials
- deterministic token prefilter lookup hashes
- AES-GCM encryption
- principal and IP rate limiting
- CAPTCHA escalation
- temporary blocking
- integrity hashing
- database triggers
- chained audit logs

Each addresses a different failure mode. No single control is treated as sufficient.

# 4. Full Technology Stack

## 4.1 Backend Runtime

| Technology | Role in project | Why used here |
|---|---|---|
| Node.js | application runtime | aligns with single-process API plus static frontend serving |
| Express | HTTP routing and middleware | lightweight route composition without framework overhead |
| mysql2/promise | async MySQL access | parameterized SQL, pooled connections, transactions |
| multer | in-memory multipart parsing | required for multi-file upload workflows |
| googleapis | Drive API client | external object storage integration |
| uuid | stable identifiers | vaults, tokens, sessions, logs, files, portfolio entries |
| jszip | batch ZIP assembly | batch-download endpoint output |
| qrcode | outer-token QR generation | public locator sharing UX |
| redis | optional security-state backend | production-oriented alternative to in-memory anti-abuse counters |

## 4.2 Frontend Stack

The frontend is plain HTML/CSS/JavaScript served from `frontend/`. It uses:

- `fetch` for JSON and blob requests
- `XMLHttpRequest` for upload progress
- `FormData` for multipart uploads
- `getUserMedia` plus `BarcodeDetector` for QR scanning

There is no SPA framework, state library, or build step in the active frontend.

## 4.3 Data and Storage Systems

| System | Role |
|---|---|
| MySQL 8+ / InnoDB | relational authority, foreign keys, transaction boundaries |
| Google Drive | encrypted blob persistence |
| local filesystem | audit logs and sealed audit blocks |
| optional Redis | distributed security-state persistence |

## 4.4 Cryptographic Libraries

The code uses Node’s built-in `crypto` module for:

- PBKDF2-HMAC-SHA256
- AES-256-GCM
- HMAC-SHA256
- SHA-256
- timing-safe equality
- secure random generation

# 5. Backend Architecture

## 5.1 Application Entry Point

`backend/src/app.js` initializes:

- environment loading
- integrity-secret safety assertion
- startup index reconciliation via `ensurePerformanceIndexes()`
- route mounting
- trust-proxy setting controlled by `TRUST_PROXY`
- static frontend serving
- global Multer and generic error handlers
- optional periodic portfolio integrity background scan

## 5.2 Route Organization

| Mount path | File | Responsibility |
|---|---|---|
| `/api/vaults` | `routes/vaults.js` | vault creation, public info, vault access, QR generation, legacy SUB creation |
| `/api/files` | `routes/files.js` | upload flows, file listing, scoped SUB token management, download flows |
| `/api/auth` | `routes/auth.js` | session login and `isAuth` |
| `/api/portfolio` | `routes/portfolio.js` | vault-scoped RBAC CRUD |
| `/api/security` | `routes/security.js` | CAPTCHA, status, diagnostics, unauthorized-change scan |
| `/api/module-b` | `routes/moduleB.js` | evidence aggregation for protected portfolio subsystem |

## 5.3 Middleware and Gatekeeping

### Purpose

Middleware exists in two main forms:

- explicit Express middleware (`requireAuth`, `requireAdmin`, `upload`)
- route-local precheck logic (`precheckSecurity`) in vault and file routes

### Architecture

- `middleware/authSession.js` resolves bearer/header/query session tokens and validates them against DB state
- `middleware/upload.js` configures Multer memory storage and file-count/size caps
- `precheckSecurity` combines block, CAPTCHA, risk, and rate-limit logic before sensitive route execution

### Security implications

- authenticated session checks are not enough without DB revalidation; the implementation does revalidate
- upload parsing is in memory, which simplifies flow but increases RAM pressure under heavy load

### Failure handling

- Multer file-size and file-count errors are normalized to HTTP JSON errors
- non-production mode may expose `err.message` in global error responses

### Scaling implications

- in-memory upload buffering and in-memory session state both constrain horizontal scale

## 5.4 Request Lifecycle Pattern

A typical sensitive route follows this sequence:

1. Resolve client IP through `getClientIp(req)`.
2. Check adaptive block state.
3. Evaluate static IP risk signals.
4. Require and verify CAPTCHA when risk or failures demand it.
5. Record IP/global and route-specific attempts.
6. Apply IP/global and route rate limits.
7. Resolve vault by `outer_token`.
8. Verify `inner_token` or session token.
9. Execute DB transaction and optional Drive operation.
10. Record auth attempts, download logs, or audit events.
11. Return JSON, binary file, or ZIP.

## 5.5 Validation Layers

Validation is distributed:

- token format validation: base62, length 10-20 for inner tokens
- file payload validation: buffer presence plus MIME sniff via `file-type`
- route-body shape validation for portfolio APIs
- vault-status and expiry checks before authorization
- ownership checks before portfolio read/update
- file-vault membership checks before mapping or download

# 6. Database Architecture

## 6.1 Relational Model

```text
vaults
  1 -> many inner_tokens
  1 -> many files
  1 -> many auth_attempts
  1 -> one expiry_jobs
  1 -> many portfolio_entries
  1 -> many sub_token_secrets

inner_tokens
  1 -> many file_key_access
  1 -> many download_logs
  1 -> many portfolio_entries (owner / creator)

files
  1 -> one file_metadata
  1 -> many file_key_access
  1 -> many download_logs
```

## 6.2 Table-by-Table Documentation

### `vaults`

| Aspect | Detail |
|---|---|
| Purpose | top-level container for files, tokens, expiry, and RBAC scope |
| Key columns | `vault_id`, `outer_token`, `created_at`, `expires_at`, `status` |
| Relationships | parent of `inner_tokens`, `files`, `auth_attempts`, `expiry_jobs`, `portfolio_entries`, `sub_token_secrets` |
| Access pattern | outer-token lookup; status/expiry sweeps |
| Indexing strategy | `UNIQUE outer_token`, `idx_vault_expiry(status, expires_at)` |
| Security relevance | outer token is public locator, not an auth secret |

### `inner_tokens`

| Aspect | Detail |
|---|---|
| Purpose | stores `MAIN` and `SUB` credentials for a vault |
| Key columns | `inner_token_id`, `vault_id`, `token_type`, `token_hash`, `token_lookup_hash`, `salt`, `key_iterations`, `status` |
| Relationships | child of `vaults`; parent of `file_key_access`, `download_logs`, `portfolio_entries`, `sub_token_secrets` |
| Access pattern | lookup by deterministic HMAC prefilter then PBKDF2 verification |
| Indexing strategy | `idx_inner_tokens_vault_status`, `idx_inner_tokens_lookup_hash(token_lookup_hash, vault_id, status)` |
| Security relevance | actual secrets are not stored; PBKDF2 and per-row salt defend at-rest credential exposure |

### `files`

| Aspect | Detail |
|---|---|
| Purpose | authoritative lifecycle row for each uploaded file |
| Key columns | `file_id`, `vault_id`, `drive_file_id`, `file_key_iv`, `file_auth_tag`, `file_hmac`, `file_plain_hash`, `status`, `deleted_at` |
| Relationships | child of `vaults`; parent of `file_metadata`, `file_key_access`, `download_logs` |
| Access pattern | by vault/status listing; by file ID during download; by deleted-at cleanup scans |
| Indexing strategy | unique `drive_file_id`, `idx_files_vault_status(vault_id, status, created_at)`, `idx_files_deleted_at(deleted_at)` |
| Security relevance | holds encrypted-file metadata but not plaintext content |

### `file_metadata`

| Aspect | Detail |
|---|---|
| Purpose | user-facing metadata separated from core lifecycle row |
| Key columns | `metadata_id`, `file_id`, `original_filename`, `relative_path`, `mime_type`, `file_size` |
| Relationships | one-to-one with `files` via `uq_file_metadata_file` |
| Access pattern | joined in list/download UI responses |
| Indexing strategy | unique key on `file_id` |
| Security relevance | contains presentation information; no authorization state |

### `file_key_access`

| Aspect | Detail |
|---|---|
| Purpose | maps file access to a specific token and stores the wrapped per-file key |
| Key columns | `file_id`, `inner_token_id`, `encrypted_file_key`, `key_wrap_iv`, `key_wrap_tag`, `key_wrap_salt`, `key_wrap_iterations`, `key_wrap_version` |
| Relationships | child of `files` and `inner_tokens` |
| Access pattern | token-specific file listing; file-specific access lock during download; rewrap during SUB-token provisioning |
| Indexing strategy | unique `(file_id, inner_token_id)`, `idx_file_key_access_token(inner_token_id)` |
| Security relevance | core enforcement point for scoped file access and cryptographic key delegation |

### `sub_token_secrets`

| Aspect | Detail |
|---|---|
| Purpose | stores recoverable SUB token values encrypted at rest for admin reveal/update workflows |
| Key columns | `inner_token_id`, `vault_id`, `secret_ciphertext`, `secret_iv`, `secret_auth_tag`, `secret_version` |
| Relationships | child of `inner_tokens` and `vaults` |
| Access pattern | reveal, set secret, file remapping for SUB tokens |
| Indexing strategy | PK on `inner_token_id`, `idx_sub_token_secrets_vault`, `idx_sub_token_secrets_updated` |
| Security relevance | recoverability requires encryption rather than hashing; plaintext column is retained only for legacy compatibility |

### `sessions`

| Aspect | Detail |
|---|---|
| Purpose | client activity anchoring for audit and CAPTCHA tracking, distinct from in-memory auth-session map |
| Key columns | `session_id`, `ip_address`, `user_agent`, `created_at`, `last_activity` |
| Relationships | parent of `auth_attempts` and `captcha_tracking`; referenced by `download_logs` |
| Access pattern | upsert-like client session reuse via IP+UA map in memory |
| Indexing strategy | `idx_sessions_ip_created(ip_address, created_at)` |
| Security relevance | supports forensic context, not authentication by itself |

### `auth_attempts`

| Aspect | Detail |
|---|---|
| Purpose | records authentication-related success and failure events |
| Key columns | `attempt_id`, `session_id`, `vault_id`, `attempt_time`, `success` |
| Relationships | child of `sessions` and optional child of `vaults` |
| Access pattern | timeline analysis, security evidence, session analytics |
| Indexing strategy | `idx_auth_attempts_time`, `idx_auth_attempts_vault_time`, `idx_auth_attempts_session_time(session_id, attempt_time, success)` |
| Security relevance | durable evidence of credential activity |

### `download_logs`

| Aspect | Detail |
|---|---|
| Purpose | records completed file deliveries |
| Key columns | `download_id`, `file_id`, `inner_token_id`, `session_id`, `download_time` |
| Relationships | child of `files`, `inner_tokens`, optional child of `sessions` |
| Access pattern | file and token-centric history lookup |
| Indexing strategy | `idx_download_time`, `idx_download_file_time(file_id, download_time)`, `idx_download_token(inner_token_id)` |
| Security relevance | audit trail for one-time access usage |

### `captcha_tracking`

| Aspect | Detail |
|---|---|
| Purpose | database-side record of challenge requirement and attempt count per client session |
| Key columns | `captcha_id`, `session_id`, `attempts`, `required`, `last_attempt` |
| Relationships | child of `sessions` |
| Access pattern | upsert from verification routes |
| Indexing strategy | unique `uq_captcha_session(session_id)` |
| Security relevance | durable support record for CAPTCHA enforcement |

### `expiry_jobs`

| Aspect | Detail |
|---|---|
| Purpose | schedules vault expiry processing |
| Key columns | `job_id`, `vault_id`, `scheduled_time`, `processed` |
| Relationships | child of `vaults` |
| Access pattern | upsert on vault creation/update and background worker-style scans |
| Indexing strategy | unique `uq_expiry_job_vault`, `idx_expiry_jobs_sched(processed, scheduled_time)` |
| Security relevance | supports timely vault invalidation |

### `portfolio_entries`

| Aspect | Detail |
|---|---|
| Purpose | vault-scoped protected CRUD resource for RBAC and integrity controls |
| Key columns | `entry_id`, `vault_id`, `owner_token_id`, `created_by_token_id`, `title`, `content`, `integrity_hash`, `status`, `updated_at` |
| Relationships | child of `vaults`; two FKs to `inner_tokens` |
| Access pattern | vault-wide admin listing, token-owned user listing, point reads, updates, soft deletes |
| Indexing strategy | `idx_portfolio_vault_owner_status`, `idx_portfolio_vault_status`, `idx_portfolio_integrity_hash` |
| Security relevance | protected by application-level integrity hash plus trigger-based immutability rules |

## 6.3 Database-Level Protection

The trigger `before_portfolio_update_guard` blocks mutation of:

- `created_at`
- `created_by_token_id`

This prevents silent provenance rewriting through direct SQL updates.

# 7. Token System Architecture

## 7.1 Token Taxonomy

| Token class | Stored where | User-visible | Purpose |
|---|---|---|---|
| Outer token | `vaults.outer_token` | yes | public vault locator |
| MAIN inner token | hashed in `inner_tokens` | yes | vault admin authority |
| SUB inner token | hashed in `inner_tokens`, optionally encrypted in `sub_token_secrets` | yes | scoped file/user authority |
| Session token | in-memory `Map` | yes, API bearer token | protected API access |

## 7.2 Hierarchy

```text
Vault
  |
  +--> Outer Token
  |
  +--> MAIN Inner Token
        |
        +--> Session role: admin
        +--> Can upload
        +--> Can create/reassign/revoke SUB tokens
        +--> Can access all portfolio entries in vault
        +--> Can run security diagnostics
        |
        +--> Can re-wrap file keys for SUB tokens

  +--> SUB Inner Token(s)
        |
        +--> Session role: user
        +--> Can access only mapped files
        +--> Can read/update only owned portfolio entries
```

## 7.3 Token Verification Flow

1. Compute deterministic `token_lookup_hash = HMAC_SHA256(innerToken, TOKEN_LOOKUP_SECRET)`.
2. Query `inner_tokens` by `(token_lookup_hash, vault_id, status='ACTIVE')`.
3. For candidate rows, perform PBKDF2 verification using row-specific salt and iterations.
4. If indexed lookup finds nothing, fall back to scanning active token rows for the vault.
5. If a fallback match lacked `token_lookup_hash`, backfill it.

This design separates:

- fast candidate narrowing
- slow authoritative credential verification

## 7.4 Why the Lookup Hash Exists

PBKDF2 outputs depend on per-row salt and therefore cannot be deterministically indexed for direct lookup by raw token value. The HMAC lookup hash exists to avoid full-vault token scans on every access attempt while preserving salted PBKDF2 as the real credential verifier.

## 7.5 Session Token System

Session tokens are UUIDs stored in an in-memory `Map`. Each record carries:

- `vaultId`
- `outerToken`
- `innerTokenId`
- `tokenType`
- `role`
- `issuedAt`
- `lastSeenAt`
- `expiresAtMs`

Validation is two-stage:

1. resolve in-memory session
2. recheck corresponding vault and token rows in MySQL

This prevents stale sessions from surviving token revocation or vault expiry.

# 8. Encryption Architecture

## 8.1 Cryptographic Primitives in Use

| Primitive | Implementation role |
|---|---|
| AES-256-GCM | file encryption and SUB secret encryption |
| PBKDF2-HMAC-SHA256 | token hashing and file-key wrapping-key derivation |
| HMAC-SHA256 | deterministic token lookup hash |
| SHA-256 | file plaintext hash, file HMAC helper, portfolio integrity hash, audit entry hash |

## 8.2 File Encryption Design

The live file flow uses envelope encryption:

```text
plaintext file
  -> random fileKey (32 bytes)
  -> AES-256-GCM(fileKey, random IV)
  -> ciphertext stored in Google Drive

fileKey
  -> PBKDF2(innerToken, wrapSalt, wrapIterations)
  -> AES-256-GCM(wrappingKey, random IV)
  -> wrapped key stored in file_key_access
```

## 8.3 Upload Encryption Lifecycle

```text
Browser file buffer
  |
  +--> validate MIME
  +--> generate fileKey
  +--> encrypt plaintext => ciphertext + file IV + auth tag
  +--> compute plaintext SHA-256
  +--> upload ciphertext to Drive
  +--> wrap fileKey for MAIN token
  +--> store file row + metadata + wrapped key mapping
```

## 8.4 Decryption Lifecycle

```text
Download request
  |
  +--> verify vault + token + file mapping
  +--> fetch wrapped file key from file_key_access
  +--> derive wrapping key from provided inner token
  +--> unwrap fileKey
  +--> download ciphertext from Drive
  +--> decrypt via AES-256-GCM
  +--> verify plaintext SHA-256
  +--> return plaintext bytes
```

## 8.5 IV Handling

- file encryption IV: random 12-byte IV, stored as `files.file_key_iv`
- file-key wrapping IV: random 12-byte IV, stored as `file_key_access.key_wrap_iv`
- SUB secret encryption IV: random 12-byte IV, stored as `sub_token_secrets.secret_iv`

GCM IVs are not secret but must be unique per encryption invocation.

## 8.6 Authentication Tags and Integrity

AES-GCM provides ciphertext authenticity. The implementation stores:

- `files.file_auth_tag`
- `file_key_access.key_wrap_tag`
- `sub_token_secrets.secret_auth_tag`

In addition, plaintext file integrity is separately checked using `file_plain_hash`, which detects corruption after decryption.

## 8.7 SUB Secret Encryption

Recoverable SUB secrets are encrypted with a key derived from `SUB_TOKEN_SECRET_KEY`:

```text
SUB token plaintext
  -> SHA-256(seed env var) => 32-byte AES key
  -> AES-256-GCM(random IV)
  -> secret_ciphertext + secret_iv + secret_auth_tag
```

This is different from login-token storage because SUB reveal requires reversibility.

## 8.8 Architectural Inference: “Outer / MAIN / SUB / Derived Keys”

The code does not implement a cryptographic “outer token key.” The practical key hierarchy is:

- outer token: locator only
- MAIN/SUB inner token: user-secret credential
- PBKDF2-derived wrapping key: transient derivation from the provided inner token
- file key: random per-file symmetric key

That is the effective hierarchy the implementation enforces.

# 9. File Storage Architecture

## 9.1 Purpose

The file-storage subsystem exists to:

- keep large binary data out of MySQL
- preserve per-file cryptographic isolation
- support scoped sharing without re-encrypting file contents for every recipient
- enforce one-time retrieval

## 9.2 Upload Lifecycle

1. Frontend sends multipart upload to `/api/files/new-vault-upload` or `/api/files/:outerToken/upload`.
2. Backend validates files and quotas.
3. Each file is encrypted with a random file key.
4. Ciphertext is uploaded to Google Drive at a folder path derived from `relative_path`.
5. MySQL stores metadata, Drive ID, file IV/tag/hash, and wrapped key access.
6. Initial portfolio entry is created as a side effect for auditability and protected CRUD evidence.

## 9.3 Metadata Storage

Split between:

- `files`: authoritative lifecycle and crypto metadata
- `file_metadata`: display-oriented name/path/size data

This allows storage and lifecycle fields to evolve without overloading presentation metadata.

## 9.4 Ciphertext Handling

Drive receives the ciphertext buffer only. The backend never stores plaintext file bytes persistently in the database.

## 9.5 Wrapped Key Handling

Every file-token access relationship can hold its own wrapped version of the file key. This is what makes:

- `MAIN` access independent
- `SUB` access scope-specific
- future rewrapping possible without re-encrypting the file contents

## 9.6 Deletion Lifecycle

After successful download:

1. file row is marked `DELETED`
2. `deleted_at` is set
3. all `file_key_access` rows for that file are removed
4. `download_logs` entry is created
5. Drive deletion is attempted best-effort

## 9.7 One-Time Download Semantics

The authoritative enforcement is relational state, not the frontend. Any later request sees:

- file absent from accessible listings due to missing access rows and non-`ACTIVE` status
- `410 Gone` semantics for already-consumed rows when locked rows are still found

# 10. API Architecture

## 10.1 Vault Endpoints

### `POST /api/vaults`

Creates an empty vault and a `MAIN` token.

- Auth: none
- Flow: validate inner token -> validate expiry days -> insert vault -> insert main token -> schedule expiry job
- Security checks: token format only; no `precheckSecurity` on this route
- DB: `vaults`, `inner_tokens`, `expiry_jobs`, `auth_attempts`
- Response: outer token and expiry metadata

### `GET /api/vaults/:outerToken/public-info`

Public status lookup for a vault.

- Auth: outer token only
- Flow: security precheck -> resolve vault -> count active files
- Security checks: IP/risk/CAPTCHA/rate limits
- DB: `vaults`, `files`, `auth_attempts`
- Response: vault status, expiry, remaining time, active file count

### `POST /api/vaults/:outerToken/access`

Verifies an inner token for a vault and returns accessible files.

- Auth: outer token + inner token
- Flow: security precheck -> resolve vault -> verify token -> join accessible files
- Security checks: full `precheckSecurity`, active vault check, token verification
- DB: `vaults`, `inner_tokens`, `files`, `file_metadata`, `file_key_access`, `auth_attempts`
- Response: token type, file list, `canCreateSubToken`

### `POST /api/vaults/:outerToken/sub-tokens`

Legacy/simple SUB creation path.

- Auth: `MAIN` inner token
- Flow: security precheck -> verify MAIN token -> validate target files -> create SUB token -> create file mappings
- Security checks: `MAIN`-only, vault active, file membership
- DB: `inner_tokens`, `files`, `file_key_access`
- Limitation: this path inserts access mappings without wrapped key material and predates the richer files-route version

### `GET /api/vaults/:outerToken/qr`

Returns a QR data URL encoding the outer token.

- Auth: none
- DB: `vaults`
- Response: `qrDataUrl`

## 10.2 File Endpoints

### `POST /api/files/new-vault-upload`

Creates a vault and uploads initial files.

- Auth: proposed `MAIN` token in request body
- Flow: security precheck -> quota checks -> encrypt/upload files -> transaction insert vault/token/files/metadata/access -> create portfolio entry -> schedule expiry
- Security checks: IP/risk/CAPTCHA/rate limits, token format, quota enforcement, file validation
- DB: `vaults`, `inner_tokens`, `files`, `file_metadata`, `file_key_access`, `portfolio_entries`, `expiry_jobs`, `auth_attempts`
- External I/O: Google Drive upload

### `POST /api/files/:outerToken/upload`

Uploads additional files into an existing vault.

- Auth: active `MAIN` inner token
- Flow: security precheck -> resolve vault -> verify token -> verify `MAIN` -> quota checks -> encrypt/upload -> transaction insert file rows
- Security checks: same as above plus `MAIN` enforcement
- DB: `files`, `file_metadata`, `file_key_access`, `portfolio_entries`, `auth_attempts`

### `GET /api/files/:outerToken/list`

Lists files accessible to a given token.

- Auth: `innerToken` query parameter
- Flow: resolve vault -> verify token -> join accessible files
- Security checks: token verification only; this route does not apply `precheckSecurity`
- DB: `vaults`, `inner_tokens`, `files`, `file_metadata`, `file_key_access`

### `POST /api/files/:outerToken/sub-tokens`

Primary scoped-sharing endpoint.

- Auth: `MAIN` inner token
- Flow: ensure secret/crypto schema -> verify `MAIN` -> reject duplicate SUB secret -> detect file mapping conflicts -> create SUB token -> rewrap file keys per selected file -> upsert encrypted SUB secret -> create portfolio entry
- Security checks: `MAIN` required, target files must exist and be active, optional conflict reassignment gating
- DB: `inner_tokens`, `files`, `file_key_access`, `sub_token_secrets`, `portfolio_entries`
- Why it exists: this is the production-grade scoped-sharing path; unlike the legacy vault route, it preserves cryptographic delegation

### `GET /api/files/:outerToken/sub-tokens`

Lists active SUB tokens and their mapped files.

- Auth: `MAIN` inner token
- DB: `inner_tokens`, `sub_token_secrets`, `file_key_access`, `files`, `file_metadata`
- Response: token IDs, creation time, `has_secret`, mapped filenames, mapped file IDs

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`

Replaces file scope for a SUB token.

- Auth: `MAIN` inner token
- Flow: verify main -> load stored SUB secret -> validate files -> delete old mappings -> rewrap file keys for new file set -> insert new mappings
- Security checks: cannot proceed if recoverable SUB secret is unavailable
- DB: `sub_token_secrets`, `file_key_access`, `files`, `inner_tokens`

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`

Stores encrypted recoverable value for an existing SUB token.

- Auth: `MAIN` inner token
- Flow: verify main -> verify supplied SUB value matches hashed token -> encrypt and upsert secret
- Security checks: prevents arbitrary secret overwrite unrelated to the actual token
- DB: `inner_tokens`, `sub_token_secrets`

### `GET /api/files/:outerToken/sub-tokens/:tokenId/reveal`

Reveals stored SUB secret to a `MAIN` holder.

- Auth: `MAIN` inner token
- Flow: verify main -> verify target SUB exists -> load and decrypt secret -> re-upsert normalized encrypted record -> audit
- Security checks: explicit audit logging for deny/missing/success cases
- DB: `inner_tokens`, `sub_token_secrets`

### `DELETE /api/files/:outerToken/sub-tokens/:tokenId`

Revokes a SUB token.

- Auth: `MAIN` inner token
- Flow: verify main -> set token status `REVOKED` -> delete stored secret row
- Security checks: vault-bound token ownership
- DB: `inner_tokens`, `sub_token_secrets`

### `POST /api/files/download-batch`

Downloads multiple accessible files as a ZIP and consumes them.

- Auth: outer token + inner token
- Flow: security precheck -> verify vault/token -> transaction lock file rows -> decrypt each file -> verify hash -> mark all deleted -> remove access rows -> insert download logs -> commit -> best-effort Drive delete -> emit ZIP
- Security checks: max file-count cap, access-row enforcement, row locking, integrity verification
- DB: `files`, `file_metadata`, `file_key_access`, `download_logs`
- External I/O: Drive download and delete

### `POST /api/files/:fileId/download`

Downloads one file and consumes it.

- Same semantics as batch route but for a single file

## 10.3 Auth Endpoints

### `POST /api/auth/login`

Creates a session for portfolio/security APIs.

- Auth: outer token + inner token
- Flow: resolve active vault -> verify token -> create in-memory session -> audit success/denial
- DB: `vaults`, `inner_tokens`; audit log file
- Response: `sessionToken`, role, token type, vault metadata

### `GET /api/auth/isAuth`

Checks session presence and remaining time.

- Auth: session token via bearer/header/query
- Flow: read in-memory session only
- Note: this route does not call `validateSessionAgainstDb`; protected routes do

## 10.4 Portfolio Endpoints

All portfolio routes are session-protected and principal-rate-limited.

### `GET /api/portfolio`

- Auth: any valid session
- Flow: ensure schema -> require auth -> principal limit -> query visible active entries -> exclude tampered rows -> audit tamper blocks
- DB: `portfolio_entries`
- RBAC: admin sees all vault entries; user sees only owned entries

### `GET /api/portfolio/:entryId`

- Auth: any valid session
- Flow: fetch row -> ownership check -> integrity check -> return
- Denied reads are audited

### `POST /api/portfolio`

- Auth: admin session only
- Flow: payload shape validation -> owner-token validation -> compute integrity hash -> insert row -> audit
- DB: `portfolio_entries`, `inner_tokens`

### `PUT /api/portfolio/:entryId`

- Auth: any valid session with access to the row
- Flow: shape validation -> access check -> integrity check -> validate reassigned owner if admin -> recompute integrity hash -> update row -> audit

### `DELETE /api/portfolio/:entryId`

- Auth: admin session only
- Flow: fetch row -> integrity check -> soft delete by status + integrity hash recomputation -> audit

## 10.5 Security Endpoints

### `GET /api/security/captcha`

- creates a challenge or returns provider config

### `POST /api/security/captcha/verify`

- verifies challenge answer or provider token
- updates `captcha_tracking`

### `GET /api/security/captcha/required`

- reports whether current IP should solve CAPTCHA

### `GET /api/security/status`

- returns block state, failure counters, CAPTCHA state, risk score, and rate metadata

### `GET /api/security/inspect`

- admin-only diagnostics for security counters and policy visibility

### `GET /api/security/unauthorized-check`

- admin-only portfolio tamper scan for the current vault

## 10.6 Evidence Endpoint

### `GET /api/module-b/evidence`

Admin-only portfolio evidence bundle:

- RBAC mapping
- tamper summary
- audit log chain validity
- `SHOW INDEX` output
- `EXPLAIN` output for listing query

# 11. Authentication & Session Architecture

## 11.1 Login Flow

1. Client submits `outerToken` and `innerToken`.
2. Backend resolves vault by outer token.
3. Backend verifies vault status and expiry.
4. Backend verifies hashed token within that vault.
5. Backend derives role from token type:
   - `MAIN` -> `admin`
   - `SUB` -> `user`
6. Session UUID is issued and stored in memory.
7. Audit log records success or denial.

## 11.2 Session Creation and Storage

Sessions are stored in a process-local `Map`. They expire when:

- vault expiry time is reached
- `lastSeenAt + 12h` is exceeded
- associated vault/token DB state becomes invalid during protected-route validation

## 11.3 Middleware Authorization Logic

- `requireAuth` calls `validateSessionAgainstDb`
- `requireAdmin` wraps `requireAuth` and enforces `req.authSession.role === 'admin'`

## 11.4 Admin vs User Permissions

| Capability | Admin (`MAIN`) | User (`SUB`) |
|---|---|---|
| upload additional files | yes | no |
| create SUB tokens | yes | no |
| list all portfolio entries in vault | yes | no |
| read owned portfolio entries | yes | yes |
| update owned portfolio entries | yes | yes |
| update any portfolio entry in vault | yes | no |
| delete portfolio entries | yes | no |
| run unauthorized-check | yes | no |
| reveal SUB secrets | yes | no |

# 12. RBAC & Access Control Model

## 12.1 MAIN vs SUB Capabilities

The role model is not an extra user table. It is derived directly from `inner_tokens.token_type`.

## 12.2 Ownership Checks

Portfolio ownership is enforced by `owner_token_id`.

- admin can access any active row in the same vault
- user can access only rows whose `owner_token_id === session.innerTokenId`

## 12.3 Scoped File Access

Files are not granted by vault membership alone. A valid token must also have a `file_key_access` row for the target file. This is the key boundary that makes SUB scoping enforceable.

## 12.4 Vault Boundaries

All privileged operations validate that referenced tokens and files belong to the current vault. Cross-vault access is blocked by SQL predicates, not by frontend assumptions.

# 13. Security Architecture

## 13.1 Purpose

The security subsystem regulates behavior before and after authentication. It protects against:

- brute force against inner tokens
- scraping and repeated download attempts
- route flooding
- abusive use of compromised valid tokens

## 13.2 Rate Limiting Layers

| Layer | Default implementation value | Scope |
|---|---:|---|
| IP per minute | 10 | global request pressure |
| IP per day | 100 | sustained abuse |
| principal per minute | 60 | authenticated token behavior |
| principal per day | 600 | authenticated token behavior |
| route-specific limits | per route key | route sensitivity |

Route-specific limits are configurable through `ROUTE_RATE_LIMITS_JSON`.

## 13.3 CAPTCHA Escalation Logic

CAPTCHA is required when either:

- failures per minute >= 8
- weighted failure score in 10 minutes >= 10

CAPTCHA verification supports:

- local math challenge
- hCaptcha
- reCAPTCHA

Math fallback can be disabled with `CAPTCHA_ALLOW_MATH_FALLBACK=false`.

## 13.4 Weighted Risk Scoring

Failure weights:

- normal failure: 1
- CAPTCHA invalid: 2
- CAPTCHA max attempts: 4

Temporary blocks are imposed when:

- failures/minute >= 20
- weighted score/10min >= 22

## 13.5 Adaptive Blocking

Block duration starts at 15 minutes and doubles with repeated strikes within the strike window, capped at 24 hours.

## 13.6 Static IP Risk Intelligence

Risk signals come from environment-configured lists:

- `RISK_BAD_IPS`
- `RISK_TOR_IPS`
- `RISK_VPN_IPS`

Scores:

- known bad IP: +95
- TOR exit: +60
- VPN/datacenter: +40

Per-route `captchaThreshold` and `blockThreshold` are configurable via `ROUTE_RISK_POLICY_JSON`.

## 13.7 Storage Backend

Security state can live in:

- memory
- Redis

If `SECURITY_STORE=redis` and `REDIS_URL` is valid, counters and block state can be shared across processes. Otherwise the system remains process-local.

# 14. Integrity Protection System

## 14.1 Portfolio Integrity Hashes

Each portfolio row stores:

```text
SHA256(vaultId | ownerTokenId | title | content | status | PORTFOLIO_INTEGRITY_SECRET)
```

The hash is recomputed on create, update, and delete transitions.

## 14.2 Read-Time Tamper Detection

Portfolio read routes actively check row integrity. Tampered rows are:

- omitted from list output or rejected on point read
- logged as `CRITICAL`
- surfaced as security errors

## 14.3 Unauthorized-Check Flow

Admin route `/api/security/unauthorized-check`:

1. scans all portfolio rows in current vault
2. recomputes expected hashes
3. returns tampered entries
4. writes an audit event containing tampered count

## 14.4 Audit Evidence Model

The audit log forms a chained sequence:

```text
entry_n.previousHash = entry_(n-1).entryHash
entry_n.entryHash = SHA256(JSON(payload including previousHash))
```

This makes deletion or reordering detectable.

## 14.5 Background Scan

If `PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS > 0`, the backend periodically scans all portfolio rows and logs critical events for tampered entries.

# 15. Operational Security

## 15.1 Environment Secrets

Key environment-controlled secrets and controls:

| Variable | Role |
|---|---|
| `DB_*` | database connectivity |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | OAuth2 Drive access |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | service-account Drive access alternative |
| `GOOGLE_DRIVE_FOLDER_ID` | Drive storage root |
| `PBKDF2_ITERATIONS` | credential-hardening cost |
| `TOKEN_LOOKUP_SECRET` | deterministic lookup HMAC |
| `SUB_TOKEN_SECRET_KEY` | SUB secret encryption seed |
| `PORTFOLIO_INTEGRITY_SECRET` | portfolio integrity hashing secret |
| `REDIS_URL` | distributed security store |
| `TRUST_PROXY` | proxy IP trust gate |

## 15.2 KMS Considerations

The code stores encryption seeds in environment variables. That is acceptable for local or prototype deployment, but production-grade deployments should externalize:

- `SUB_TOKEN_SECRET_KEY`
- `PORTFOLIO_INTEGRITY_SECRET`
- `TOKEN_LOOKUP_SECRET`
- Google credentials

to KMS or secrets-management infrastructure.

## 15.3 Redis Considerations

Redis is optional and used only for anti-abuse state. Session tokens still remain in-process. Therefore enabling Redis improves distributed rate limiting but does not by itself make the system fully horizontally scalable.

## 15.4 Logging Constraints

The code avoids logging raw inner tokens in the main audit logger. This is a strong baseline. However, any deployment should still treat:

- audit logs
- DB exports
- ad hoc debugging output

as sensitive artifacts because they contain vault IDs, token IDs, IP addresses, and security events.

## 15.5 Proxy Handling

`x-forwarded-for` is only trusted when `TRUST_PROXY=true`. This prevents blind trust of spoofed forwarding headers when the service is not behind a trusted reverse proxy.

# 16. SQL Optimization & Indexing

## 16.1 Strategy

The schema and runtime optimizer target real query shapes, not generic indexing.

Key examples:

- `vaults(status, expires_at)` for expiry scans
- `inner_tokens(token_lookup_hash, vault_id, status)` for token prefilter lookup
- `files(vault_id, status, created_at)` for visible file lists
- `portfolio_entries(vault_id, owner_token_id, status, updated_at)` for RBAC user listings

## 16.2 Why Column Order Matters

Indexes are ordered to favor:

1. equality filters first
2. bounded scope next
3. ordering column last

For example, `idx_portfolio_vault_owner_status` matches:

```sql
WHERE vault_id = ?
  AND owner_token_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
```

## 16.3 Benchmark Strategy

`backend/reports/index_benchmark.js`:

- creates a benchmark table
- measures repeated query duration before indexing
- applies a composite lookup index
- measures again
- adds a wider covering-style index and measures again
- captures `EXPLAIN` plans throughout

## 16.4 Lookup Acceleration

The most important optimization is `token_lookup_hash`. Without it, every vault-access attempt would require scanning all active token rows in the vault and performing PBKDF2 on each candidate.

## 16.5 Query Plan Implications

The intended plan shape is:

- point or narrow-range lookup on vault and token identity
- reduced examined rows
- ordered retrieval without large sort work for common listing endpoints

# 17. Frontend Interaction Model

## 17.1 Fetch and Upload Behavior

The frontend uses:

- `fetchJson()` for JSON APIs
- `uploadWithProgress()` over `XMLHttpRequest` for multipart uploads
- blob responses for single downloads
- blob ZIP responses for batch downloads

## 17.2 Vault Access Flow

1. User enters or scans outer token.
2. Frontend calls public-info endpoint.
3. User enters inner token.
4. Frontend calls vault access endpoint.
5. UI switches to vault-detail view and renders scoped files.

## 17.3 QR Scanning

QR scanning is browser-dependent:

- requires camera support
- requires `BarcodeDetector`
- fills outer-token field and auto-submits the outer-token verification form

## 17.4 CAPTCHA Replay Window

The frontend keeps `captchaSolvedUntil` for roughly 9 minutes and replays the blocked action after successful verification. This reduces repeated prompts during the same interaction window.

## 17.5 Download Handling

- single-file download sends JSON credentials and triggers browser file save from blob response
- batch download sends selected file IDs and saves a ZIP response
- after successful batch download, frontend refreshes file listing because files become consumed

## 17.6 Multi-File and Folder Upload Handling

Relative paths are preserved by sending:

- `files`
- aligned repeated `relativePaths`

Folders selected through `webkitdirectory` become path-preserving uploads.

# 18. Complete End-to-End Lifecycle Flows

## 18.1 Vault Creation

1. User chooses files and a `MAIN` token.
2. Frontend builds multipart payload.
3. Backend performs security precheck.
4. Backend validates token, expiry, quotas, and file types.
5. Backend generates `outer_token`, `vault_id`, and `mainTokenId`.
6. Backend encrypts each file and uploads ciphertext to Drive.
7. Backend inserts vault, main token, file rows, metadata, and wrapped key mapping.
8. Backend creates initial portfolio entry and expiry job.
9. Frontend receives outer token and fetches QR.

## 18.2 Upload More

1. `MAIN` holder opens upload-more view.
2. Frontend posts multipart data with current inner token.
3. Backend re-verifies `MAIN` authority.
4. Files are encrypted, uploaded, and persisted with wrapped keys for `MAIN`.
5. Activity portfolio entry is created.

## 18.3 Access Verification

1. Client requests public vault info.
2. Client submits inner token.
3. Backend verifies token using lookup hash + PBKDF2.
4. Backend returns token type and only mapped accessible files.

## 18.4 Sub-Token Creation

1. Admin selects files.
2. Frontend posts `mainInnerToken`, `subInnerToken`, `fileIds`.
3. Backend verifies `MAIN`.
4. Backend detects mapping conflicts.
5. Backend creates SUB token row.
6. Backend unwraps each selected file’s key from the main token mapping.
7. Backend re-wraps each file key for the SUB token.
8. Backend stores encrypted SUB secret.
9. Backend creates a portfolio activity row.

## 18.5 File Download

1. Client posts `outerToken` and `innerToken` to file download endpoint.
2. Backend performs security precheck.
3. Backend verifies token and file mapping.
4. Backend locks file row and associated access row.
5. Backend downloads ciphertext from Drive.
6. Backend unwraps file key and decrypts plaintext.
7. Backend verifies plaintext hash.
8. Backend marks file deleted, deletes access mappings, logs download.
9. Backend commits and returns file bytes.
10. Backend best-effort deletes Drive blob.

## 18.6 Batch Download

1. Admin selects multiple files.
2. Frontend posts file ID array.
3. Backend validates batch size cap.
4. Backend locks all requested file rows.
5. Backend decrypts each file and verifies integrity.
6. Backend soft-deletes all files and removes access mappings atomically.
7. Backend inserts download logs for all files.
8. Backend packages buffers into ZIP and returns it.

## 18.7 Session Login

1. Client posts `outerToken` and `innerToken` to `/api/auth/login`.
2. Backend resolves vault and verifies token.
3. Backend derives role and issues session token.
4. Protected APIs use bearer/header/query session token.

## 18.8 Portfolio CRUD

1. Authenticated client calls session-protected portfolio route.
2. Middleware validates session and DB state.
3. Principal rate limiting is applied.
4. RBAC and ownership rules are enforced.
5. Integrity hash is checked before read/update/delete.
6. Mutations recompute integrity hash and write audit events.

# 19. Threat Model

## 19.1 Database Compromise

Exposed:

- vault metadata
- token hashes
- wrapped file keys
- file metadata
- portfolio contents

Not automatically exposed:

- plaintext files in Drive
- decryptable file keys without token values
- SUB plaintext values without `SUB_TOKEN_SECRET_KEY`

Residual risk:

- weak user-chosen inner tokens remain brute-force targets
- portfolio contents are stored in plaintext in DB

## 19.2 Token Theft

If an attacker obtains a valid inner token:

- file access remains limited to mapped files for SUB tokens
- principal limits and route limits constrain abuse volume
- one-time download semantics limit replay after successful use

If an attacker obtains a `MAIN` token, they effectively control that vault.

## 19.3 Replay Attempts

One-time file semantics mitigate repeated file retrieval by consuming the file after first successful delivery.

## 19.4 Distributed Attacks

Principal limits mitigate token abuse across many IPs. IP-only limits would not be sufficient.

## 19.5 Brute Force

PBKDF2 plus CAPTCHA escalation plus temporary blocking plus route rate limits are the primary defenses.

## 19.6 Scraping

Attackers can still enumerate accessible content if they possess a valid token, but:

- route limits
- principal limits
- one-time file deletion

reduce bulk-exfiltration efficiency.

## 19.7 Storage Compromise

Drive compromise exposes ciphertext. DB compromise exposes wrapped keys. Full recovery of plaintext files generally requires both stored data and either valid inner tokens or token-equivalent secrets.

# 20. Production Readiness Analysis

## 20.1 Current Readiness

The codebase contains several production-oriented controls but remains prototype-grade in core deployment aspects:

- sessions are in-memory
- upload buffering is in-memory
- no built-in worker for expiry processing
- no containerization in active codebase
- optional Redis covers only security counters

## 20.2 Scaling Limitations

| Area | Limitation |
|---|---|
| sessions | process-local memory prevents horizontal scale |
| anti-abuse | Redis helps, but only if configured |
| uploads | memory buffering penalizes large concurrent uploads |
| batch downloads | ZIP assembly is memory-bound |
| Drive I/O | synchronous per-request network dependency |

## 20.3 Redis Migration Implications

Moving only security counters to Redis is insufficient for stateless scaling. Session storage also needs migration to a shared store.

## 20.4 KMS Integration Implications

Externalizing `SUB_TOKEN_SECRET_KEY`, `TOKEN_LOOKUP_SECRET`, and `PORTFOLIO_INTEGRITY_SECRET` to KMS would materially reduce accidental secret exposure and support controlled rotation.

## 20.5 Distributed Deployment Implications

To run multiple application instances safely, the system would need:

- shared session store
- shared anti-abuse store
- consistent secret distribution
- careful handling of Drive delete race conditions

# 21. Architectural Strengths

- Coherent single-identity model across file sharing and RBAC APIs.
- Strong separation between public vault discovery and private authorization.
- File-level scoped sharing implemented both relationally and cryptographically.
- Envelope encryption avoids file re-encryption for sharing changes.
- Deterministic token lookup hash solves an actual PBKDF2 indexing problem cleanly.
- One-time download semantics are enforced server-side, not cosmetically.
- Portfolio integrity system combines application hash checks, route-time enforcement, and DB trigger constraints.
- Chained audit logs provide tamper evidence beyond ordinary flat logging.
- Security controls distinguish between IP abuse and authenticated-principal abuse.

# 22. Architectural Limitations

- Session tokens are process-local and non-persistent.
- File upload and ZIP assembly are memory-heavy.
- `/api/auth/isAuth` reads from in-memory session state without DB revalidation, unlike protected routes.
- `GET /api/files/:outerToken/list` lacks the same precheck security wrapper used by other sensitive file/vault routes.
- Portfolio content is integrity-protected but not encrypted at rest in the database.
- Expiry scheduling metadata exists, but expiry execution worker logic is not present in the active backend.
- Legacy `/api/vaults/:outerToken/sub-tokens` path is weaker than the richer `/api/files/.../sub-tokens` implementation and could confuse maintainers.

# 23. Future Improvement Opportunities

- Move session storage to Redis or database-backed session infrastructure.
- Stream uploads directly to encryption/storage pipeline instead of whole-buffer memory handling.
- Stream batch ZIP generation for large result sets.
- Add unified security precheck coverage to all credential-sensitive routes, including file listing.
- Encrypt portfolio content at rest if DB confidentiality becomes a stronger requirement.
- Add explicit expiry worker that marks stale vaults and cleans residual Drive artifacts.
- Consolidate legacy and primary SUB-token creation APIs to remove duplicated behavior.
- Introduce formal secrets/KMS integration and secret rotation procedures.
- Add structured metrics and tracing for Drive latency, download consumption, and abuse events.

# 24. Final System Summary

Ghost Drop is a vault-centric secure transfer platform whose implementation is built around one central idea: vault location is public, authorization is private, and actual data release is narrowly scoped and ephemeral. MySQL holds identity, policy, and lifecycle state. Google Drive holds ciphertext. Inner tokens do not directly encrypt files; they derive wrapping keys that unlock per-file keys. `MAIN` tokens administer a vault, while `SUB` tokens represent constrained recipients whose permissions are defined per file and per portfolio row ownership.

The backend’s important architectural properties are:

- authorization is vault-bound and token-bound
- file sharing is enforced by explicit access mappings
- downloads are destructive by design
- integrity checking is active, not passive
- anti-abuse protection is layered and adaptive
- audit evidence is tamper-evident

The system is technically stronger than a simple CRUD demonstration because its security and operational model are tied to real transfer semantics. Its main production gaps are session persistence, shared-state scaling, and deployment hardening, not a lack of architectural direction. The implemented code already expresses a clear security model, a meaningful storage separation strategy, and a defensible request lifecycle for sensitive data exchange.
