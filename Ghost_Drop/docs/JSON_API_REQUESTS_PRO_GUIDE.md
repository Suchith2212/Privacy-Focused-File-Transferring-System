# GhostDrop — API Reference

> Complete request and response documentation for all GhostDrop API endpoints.  
> For setup and configuration see [`../README.md`](../README.md). For the security architecture see [`SECURITY_LIMITS_REFERENCE.md`](SECURITY_LIMITS_REFERENCE.md).

---

## Table of Contents

- [Communication Model](#communication-model)
- [Authentication Model](#authentication-model)
- [Common Response Shapes](#common-response-shapes)
- [Health API](#health-api)
- [Security API](#security-api)
- [Vault API](#vault-api)
- [File API](#file-api)
- [Auth API](#auth-api)
- [Portfolio API](#portfolio-api)
- [Module B API](#module-b-api)
- [End-to-End Flows](#end-to-end-flows)
- [cURL Examples](#curl-examples)

---

## Communication Model

| Property | Value |
|---|---|
| Base URL | `http://localhost:4000/api` |
| Protocol | HTTP (HTTPS enforced by reverse proxy in production) |
| API style | REST-like JSON |
| Upload transport | `multipart/form-data` (file endpoints) |
| Download response | Binary stream (`Content-Disposition: attachment`) or `application/zip` |
| JSON body size limit | 50 KB |
| Request tracing | Every response includes `X-Request-ID` header |

### Content-Type

- All JSON requests: `Content-Type: application/json`
- File upload requests: `Content-Type: multipart/form-data` (set automatically by `FormData`)

---

## Authentication Model

### Layer 1 — Vault Credential Auth (token-based)

Used for vault and file endpoints. The client sends `outerToken` and `innerToken` directly in the request body. No persistent session is created.

- `MAIN innerToken` → admin privileges on the vault
- `SUB innerToken` → access to specific files only

### Layer 2 — Bearer Session Auth (portfolio and security endpoints)

Obtained by calling `POST /api/auth/login`. Returns a `sessionToken` (UUID) valid for the duration of the vault session.

Send the session token in one of three ways (checked in this order):

```http
Authorization: Bearer <sessionToken>
x-session-token: <sessionToken>
?sessionToken=<sessionToken>
```

---

## Common Response Shapes

### Success

HTTP 2xx with a JSON body specific to each endpoint.

### Error

```json
{
  "error": "Human-readable error description.",
  "requestId": "uuid-for-log-correlation"
}
```

Security-related errors include additional fields:

```json
{
  "error": "Rate limit exceeded.",
  "code": "RATE_LIMIT",
  "minuteCount": 11,
  "minuteLimit": 10,
  "retryAfterSeconds": 42,
  "captchaRequired": true,
  "requestId": "uuid"
}
```

### Common Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `TEMP_BLOCK` | 429 | IP temporarily blocked |
| `RISK_BLOCK` | 403 | IP risk score too high |
| `CAPTCHA_REQUIRED` | 403 | Solve CAPTCHA before retrying |
| `CAPTCHA_INVALID` | 403 | Wrong CAPTCHA answer |
| `RATE_LIMIT` | 429 | Global IP rate limit exceeded |
| `ROUTE_RATE_LIMIT` | 429 | Per-endpoint rate limit exceeded |
| `PORTFOLIO_TOKEN_RATE_LIMIT` | 429 | Authenticated token rate limit exceeded |
| `PORTFOLIO_TAMPER_DETECTED` | 409 | Row integrity check failed |

---

## Health API

### `GET /api/health`

Database connectivity check.

**Response 200:**
```json
{ "status": "ok", "requestId": "uuid" }
```

**Response 500** (database down):
```json
{ "status": "error", "error": "Database health check failed.", "requestId": "uuid" }
```

---

### `GET /api/ready`

Full readiness check (database + Redis).

**Response 200:**
```json
{
  "status": "ready",
  "database": "ok",
  "securityStore": { "mode": "redis", "redisConnected": true },
  "requestId": "uuid"
}
```

**Response 503** (Redis not connected):
```json
{
  "status": "not_ready",
  "database": "ok",
  "securityStore": { "mode": "redis", "redisConnected": false },
  "requestId": "uuid"
}
```

---

## Security API

### `GET /api/security/captcha`

Generate a CAPTCHA challenge for the current IP.

**Response 200 (math provider):**
```json
{
  "captchaRequired": true,
  "challengeId": "c7f6a1b2-...",
  "question": "8 + 6 = ?"
}
```

**Response 200 (hCaptcha / reCAPTCHA):**
```json
{
  "captchaRequired": true,
  "provider": "hcaptcha",
  "siteKey": "your-site-key"
}
```

---

### `POST /api/security/captcha/verify`

Verify a math CAPTCHA answer.

**Request:**
```json
{
  "challengeId": "c7f6a1b2-...",
  "answer": "14"
}
```

**Response 200:**
```json
{ "message": "Captcha verified." }
```

**Response 403:**
```json
{ "error": "Wrong answer.", "code": "CAPTCHA_INVALID", "captchaRequired": true }
```

---

### `GET /api/security/captcha/required`

Check whether CAPTCHA is currently required for this IP.

**Response 200:**
```json
{ "captchaRequired": false }
```

---

### `GET /api/security/status`

Current anti-abuse state for the calling IP.

**Response 200:**
```json
{
  "ip": "127.0.0.1",
  "blocked": false,
  "captchaRequired": false,
  "minuteCount": 2,
  "dayCount": 7
}
```

---

### `GET /api/security/unauthorized-check` *(admin session required)*

Scan all portfolio entries in the authenticated vault for rows whose integrity hash does not match the expected value. A mismatch indicates out-of-band database modification.

**Response 200 (no tampering):**
```json
{
  "tamperedCount": 0,
  "tamperedEntries": []
}
```

**Response 200 (tampering detected):**
```json
{
  "tamperedCount": 1,
  "tamperedEntries": [
    {
      "entryId": "uuid",
      "ownerTokenId": "uuid",
      "status": "ACTIVE",
      "updatedAt": "2026-04-10T09:00:00.000Z"
    }
  ]
}
```

---

## Vault API

### `POST /api/vaults`

Create a new vault with a MAIN inner token.

**Request:**
```json
{
  "innerToken": "MainDemo1234",
  "expiresInDays": 7
}
```

- `innerToken`: 10–20 base62 characters (`0-9`, `A-Z`, `a-z`), required
- `expiresInDays`: integer 1–14, default `7`

**Response 201:**
```json
{
  "message": "Vault created.",
  "outerToken": "OUTERABC1",
  "expiresInDays": 7
}
```

---

### `GET /api/vaults/:outerToken/public-info`

Vault status summary — safe to call before authentication.

**Response 200:**
```json
{
  "outerToken": "OUTERABC1",
  "status": "ACTIVE",
  "createdAt": "2026-04-04T10:00:00.000Z",
  "expiresAt": "2026-04-11T10:00:00.000Z",
  "remainingSeconds": 604800,
  "activeFileCount": 3
}
```

`status` is `"ACTIVE"` or `"EXPIRED"`.

---

### `POST /api/vaults/:outerToken/access`

Authenticate with an inner token and retrieve the list of accessible files.

**Request:**
```json
{ "innerToken": "MainDemo1234" }
```

**Response 200:**
```json
{
  "outerToken": "OUTERABC1",
  "expiresAt": "2026-04-11T10:00:00.000Z",
  "remainingSeconds": 603000,
  "tokenType": "MAIN",
  "canCreateSubToken": true,
  "files": [
    {
      "file_id": "uuid",
      "original_filename": "notes.pdf",
      "relative_path": "docs/notes.pdf",
      "mime_type": "application/pdf",
      "file_size": 123456,
      "created_at": "2026-04-04T10:05:00.000Z"
    }
  ]
}
```

Files shown are only those accessible to the provided `innerToken`.

---

### `POST /api/vaults/:outerToken/sub-tokens`

Create a scoped SUB token with access to specific files. **MAIN token required.**

**Request:**
```json
{
  "mainInnerToken": "MainDemo1234",
  "subInnerToken": "SubDemo12345",
  "fileIds": ["file-uuid-1", "file-uuid-2"]
}
```

- `subInnerToken` is optional; if omitted, a random 12-char base62 token is generated.
- `fileIds`: all must belong to this vault and be `ACTIVE`.

**Response 201:**
```json
{
  "message": "SUB token created.",
  "subTokenId": "uuid",
  "subInnerToken": "SubDemo12345",
  "linkedFileCount": 2
}
```

---

### `GET /api/vaults/:outerToken/qr`

Generate a QR code data URL encoding the outer token.

**Response 200:**
```json
{
  "outerToken": "OUTERABC1",
  "qrDataUrl": "data:image/png;base64,..."
}
```

---

## File API

### `POST /api/files/new-vault-upload` *(multipart/form-data)*

Create a new vault and upload files in a single request.

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `innerToken` | string | Yes | MAIN inner token (10–20 base62 chars) |
| `expiresInDays` | number | No | Default 7, max 14 |
| `files` | file(s) | Yes | One or more file parts |
| `relativePaths` | string(s) | No | Path strings aligned with `files` array |

**Response 201:**
```json
{
  "message": "Vault created and files uploaded.",
  "outerToken": "OUTERXYZ9",
  "expiresAt": "2026-04-11T10:20:00.000Z",
  "remainingSeconds": 604800,
  "uploadedFiles": [
    {
      "fileId": "uuid",
      "name": "report.pdf",
      "size": 556677,
      "mimeType": "application/pdf"
    }
  ]
}
```

---

### `POST /api/files/:outerToken/upload` *(multipart/form-data)*

Upload additional files to an existing vault. **MAIN token required.**

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `innerToken` | string | Yes | MAIN inner token |
| `files` | file(s) | Yes | One or more file parts |
| `relativePaths` | string(s) | No | Path strings aligned with `files` |

**Response 201:** same shape as `new-vault-upload` (without `outerToken`).

---

### `GET /api/files/:outerToken/list`

List files accessible to the provided token.

**Query parameters:** `innerToken` (required)

**Response 200:**
```json
{
  "files": [
    {
      "file_id": "uuid",
      "original_filename": "photo.jpg",
      "relative_path": "images/photo.jpg",
      "mime_type": "image/jpeg",
      "file_size": 204800,
      "created_at": "2026-04-05T08:00:00.000Z"
    }
  ]
}
```

---

### `POST /api/files/:outerToken/sub-tokens`

Create a scoped SUB token (files route, used by the UI). Functionally equivalent to `POST /api/vaults/:outerToken/sub-tokens`.

**Request:**
```json
{
  "mainInnerToken": "MainDemo1234",
  "subInnerToken": "SubDemo12345",
  "fileIds": ["file-uuid-1"],
  "forceReassign": false
}
```

---

### `GET /api/files/:outerToken/sub-tokens`

List all active SUB tokens for the vault. **MAIN token required.**

**Query parameters:** `mainInnerToken` (required)

**Response 200:**
```json
{
  "subTokens": [
    {
      "tokenId": "uuid",
      "linkedFiles": ["file-uuid-1", "file-uuid-2"],
      "createdAt": "2026-04-05T09:00:00.000Z"
    }
  ]
}
```

---

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`

Replace the file access set for an existing SUB token. **MAIN token required.**

**Request:**
```json
{
  "mainInnerToken": "MainDemo1234",
  "fileIds": ["file-uuid-3", "file-uuid-4"]
}
```

**Response 200:**
```json
{ "message": "File mapping updated.", "linkedFileCount": 2 }
```

---

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`

Store the raw SUB token value encrypted at rest. **MAIN token required.**

**Request:**
```json
{
  "mainInnerToken": "MainDemo1234",
  "subInnerToken": "SubDemo12345"
}
```

**Response 200:**
```json
{ "message": "Sub-token secret stored." }
```

---

### `GET /api/files/:outerToken/sub-tokens/:tokenId/reveal`

Retrieve the raw SUB token value. **MAIN token required.**

**Query parameters:** `mainInnerToken` (required)

**Response 200:**
```json
{ "subInnerToken": "SubDemo12345" }
```

---

### `DELETE /api/files/:outerToken/sub-tokens/:tokenId`

Revoke a SUB token. Removes its `inner_tokens` record and all associated `file_key_access` rows. **MAIN token required.**

**Request:**
```json
{ "mainInnerToken": "MainDemo1234" }
```

**Response 200:**
```json
{ "message": "Sub-token revoked." }
```

---

### `GET /api/files/:outerToken/download/:fileId`

Download and decrypt a single file. The file is marked `DELETED` after delivery (one-time semantics).

**Query parameters:** `innerToken` (required)

**Response 200:** Binary file stream  
`Content-Type`: original MIME type  
`Content-Disposition`: `attachment; filename="original_filename.ext"`

**Response 404:** File not found, already consumed, or token lacks access.

---

### `POST /api/files/:outerToken/download-batch`

Download up to `BATCH_DOWNLOAD_MAX_FILES` (default 10) files as a single ZIP archive. One-time semantics apply to each file.

**Request:**
```json
{
  "innerToken": "MainDemo1234",
  "fileIds": ["file-uuid-1", "file-uuid-2", "file-uuid-3"]
}
```

**Response 200:** `application/zip` stream  
`Content-Disposition`: `attachment; filename="ghostdrop_batch_<timestamp>.zip"`

**Response 400:** If `fileIds.length > BATCH_DOWNLOAD_MAX_FILES`.

---

## Auth API

### `POST /api/auth/login`

Authenticate with vault credentials and receive a Bearer session token.

**Request:**
```json
{
  "outerToken": "OUTERXYZ9",
  "innerToken": "MainDemo1234"
}
```

**Response 200:**
```json
{
  "message": "Vault session established.",
  "sessionToken": "session-uuid",
  "vaultId": "vault-uuid",
  "outerToken": "OUTERXYZ9",
  "tokenType": "MAIN",
  "role": "admin",
  "expiresAt": "2026-04-11T10:20:00.000Z",
  "remainingSeconds": 604800
}
```

`role` is `"admin"` for MAIN tokens and `"user"` for SUB tokens.

---

### `GET /api/auth/isAuth`

Validate an existing session token.

**Header:** `Authorization: Bearer <sessionToken>`

**Response 200:**
```json
{
  "authenticated": true,
  "outerToken": "OUTERXYZ9",
  "vaultId": "vault-uuid",
  "role": "admin",
  "tokenType": "MAIN",
  "remainingSeconds": 598400
}
```

**Response 401:**
```json
{ "authenticated": false, "error": "Session not found." }
```

---

## Portfolio API

All endpoints require `Authorization: Bearer <sessionToken>`.

### `GET /api/portfolio`

List portfolio entries visible to the current role.
- `admin`: all active entries in the vault
- `user`: only entries where `owner_token_id` matches this token

**Response 200:**
```json
{
  "entries": [
    {
      "entryId": "uuid",
      "vaultId": "vault-uuid",
      "ownerTokenId": "token-uuid",
      "createdByTokenId": "token-uuid",
      "title": "Security Note",
      "content": "Token rotation completed on 2026-04-05.",
      "status": "ACTIVE",
      "createdAt": "2026-04-05T08:00:00.000Z",
      "updatedAt": "2026-04-05T08:00:00.000Z"
    }
  ],
  "tamperedCount": 0
}
```

`tamperedCount` indicates how many rows were silently excluded due to integrity check failure (the details are logged to `audit.log`).

---

### `GET /api/portfolio/:entryId`

Fetch a single portfolio entry. Returns `404` if not accessible to the current role.

**Response 200:**
```json
{
  "entry": {
    "entryId": "uuid",
    "vaultId": "vault-uuid",
    "ownerTokenId": "token-uuid",
    "createdByTokenId": "token-uuid",
    "title": "Security Note",
    "content": "Token rotation completed.",
    "status": "ACTIVE",
    "createdAt": "2026-04-05T08:00:00.000Z",
    "updatedAt": "2026-04-05T08:00:00.000Z"
  }
}
```

**Response 409** (tampered):
```json
{
  "error": "Portfolio entry integrity check failed.",
  "code": "PORTFOLIO_TAMPER_DETECTED",
  "securityAlert": true
}
```

---

### `POST /api/portfolio` *(admin only)*

Create a new portfolio entry.

**Request:**
```json
{
  "title": "Security Note",
  "content": "Token rotation completed on 2026-04-05.",
  "ownerTokenId": "optional-token-uuid"
}
```

- `ownerTokenId`: if omitted, defaults to the creating token; must belong to this vault if provided.
- `title`: max 120 characters.
- Only `title`, `content`, `ownerTokenId` are accepted; extra fields return `400`.

**Response 201:**
```json
{ "entry": { ... } }
```

---

### `PUT /api/portfolio/:entryId`

Update an existing entry.
- `admin`: can update any active entry; can reassign `ownerTokenId`.
- `user`: can update only entries they own; cannot reassign `ownerTokenId`.

**Request:**
```json
{
  "title": "Updated Title",
  "content": "Updated content.",
  "ownerTokenId": "optional-new-owner-token-uuid"
}
```

All fields are optional; omitted fields retain their current values.

**Response 200:**
```json
{ "entry": { ... } }
```

---

### `DELETE /api/portfolio/:entryId` *(admin only)*

Soft-delete an entry. Sets `status = 'DELETED'` and recomputes the integrity hash.

**Response 200:**
```json
{ "message": "Portfolio entry deleted." }
```

---

## Module B API

### `GET /api/module-b/evidence` *(admin session required)*

Returns a security and database evidence bundle for academic demonstration:

- Index metadata from `SHOW INDEX`
- Query execution plans from `EXPLAIN`
- Portfolio integrity scan findings
- Audit log summary

**Response 200:**
```json
{
  "indexes": [ ... ],
  "queryPlans": [ ... ],
  "integrityFindings": { "tamperedCount": 0, "entries": [] },
  "auditSummary": { ... }
}
```

---

## End-to-End Flows

### Flow A — New vault with file upload

```
POST /api/files/new-vault-upload   → { outerToken }
GET  /api/vaults/:outerToken/qr    → { qrDataUrl }
```

### Flow B — Recipient accesses vault

```
GET  /api/vaults/:outer/public-info     → check vault is ACTIVE
POST /api/vaults/:outer/access          → { files[] }
GET  /api/files/:outer/download/:fileId → binary stream (file marked DELETED)
```

### Flow C — Batch download

```
POST /api/vaults/:outer/access          → { files[] }
POST /api/files/:outer/download-batch   → ZIP stream (each file marked DELETED)
```

### Flow D — SUB token sharing lifecycle

```
POST /api/files/:outer/sub-tokens              → { subTokenId, subInnerToken }
PUT  /api/files/:outer/sub-tokens/:id/secret   → store encrypted secret
PUT  /api/files/:outer/sub-tokens/:id/files    → remap accessible files
GET  /api/files/:outer/sub-tokens/:id/reveal   → recover raw sub token
DELETE /api/files/:outer/sub-tokens/:id        → revoke
```

### Flow E — Portfolio admin workflow

```
POST /api/auth/login                    → { sessionToken, role: "admin" }
POST /api/portfolio                     → create entry
GET  /api/portfolio                     → list all vault entries
PUT  /api/portfolio/:entryId            → update entry
GET  /api/security/unauthorized-check   → scan for tampered rows
DELETE /api/portfolio/:entryId          → soft-delete
```

---

## cURL Examples

### Create vault

```bash
curl -X POST http://localhost:4000/api/vaults \
  -H "Content-Type: application/json" \
  -d '{"innerToken":"MainDemo1234","expiresInDays":7}'
```

### Access vault

```bash
curl -X POST http://localhost:4000/api/vaults/OUTERABC1/access \
  -H "Content-Type: application/json" \
  -d '{"innerToken":"MainDemo1234"}'
```

### Upload file (single)

```bash
curl -X POST http://localhost:4000/api/files/OUTERABC1/upload \
  -F "innerToken=MainDemo1234" \
  -F "files=@/path/to/document.pdf" \
  -F "relativePaths=docs/document.pdf"
```

### Download file

```bash
curl -O -J "http://localhost:4000/api/files/OUTERABC1/download/FILE-UUID?innerToken=MainDemo1234"
```

### Batch download (ZIP)

```bash
curl -X POST http://localhost:4000/api/files/OUTERABC1/download-batch \
  -H "Content-Type: application/json" \
  -d '{"innerToken":"MainDemo1234","fileIds":["uuid-1","uuid-2"]}' \
  -o batch_download.zip
```

### Login and call portfolio API

```bash
# Step 1: login
SESSION=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"outerToken":"OUTERABC1","innerToken":"MainDemo1234"}' \
  | jq -r '.sessionToken')

# Step 2: create portfolio entry
curl -X POST http://localhost:4000/api/portfolio \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SESSION" \
  -d '{"title":"Security Note","content":"Rotation complete."}'

# Step 3: tamper check
curl -H "Authorization: Bearer $SESSION" \
  http://localhost:4000/api/security/unauthorized-check
```

### Create sub-token

```bash
curl -X POST http://localhost:4000/api/vaults/OUTERABC1/sub-tokens \
  -H "Content-Type: application/json" \
  -d '{"mainInnerToken":"MainDemo1234","fileIds":["file-uuid-1"]}'
```
