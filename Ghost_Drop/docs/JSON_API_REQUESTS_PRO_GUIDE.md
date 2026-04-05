# Ghost Drop API Requests Guide (Pro-Level)

## 1) What this document explains

This guide explains, end-to-end:

- Request types used between client and server
- JSON API structure
- Which endpoints exist and what each one does
- Request/response examples
- How complete user flows move through multiple endpoints

This content is based on the current backend route mounts in `backend/src/app.js`:

- `/api/auth`
- `/api/portfolio`
- `/api/module-b`
- `/api/vaults`
- `/api/files`
- `/api/security`

---

## 2) API communication model 

### 2.1 Protocol and style

- Protocol: HTTP
- API style: REST-like endpoints
- Primary payload format: JSON
- Frontend client: browser `fetch(...)` for most requests
- Upload transport: `XMLHttpRequest` + `FormData` for progress bars

### 2.2 Request method types used

- `GET`: read/fetch data
- `POST`: create resources or execute actions
- `PUT`: update existing resources
- `DELETE`: revoke/remove resources (logical/soft in many cases)

### 2.3 Content types used

- JSON endpoints:
  - Request header: `Content-Type: application/json`
  - Body: `JSON.stringify({...})`
- Upload endpoints:
  - `multipart/form-data` (from `FormData`)
  - Used for file binaries + metadata (`relativePaths`)

### 2.4 JSON error convention

Most failed responses follow:

```json
{
  "error": "Human readable error message"
}
```

Some endpoints include additional fields, for example:

```json
{
  "error": "Rate limit exceeded.",
  "code": "RATE_LIMIT",
  "retryAfterSeconds": 60,
  "captchaRequired": true
}
```

---

## 3) Authentication and authorization model

The system uses **two layers**:

1. Vault credential layer (`outerToken` + `innerToken`)
2. App session layer (`sessionToken`) for protected admin/user APIs like portfolio/module-b

### 3.1 Vault credential layer

- User sends `outerToken` and `innerToken` to vault/file endpoints.
- Server validates against DB token hashes.
- MAIN token gives admin-like vault privileges.
- SUB token gives scoped file access.

### 3.2 App session layer

- `POST /api/auth/login` returns a `sessionToken`.
- Protected routes use middleware `requireAuth` or `requireAdmin`.
- Session token can be sent through:
  - `Authorization: Bearer <sessionToken>`
  - `x-session-token: <sessionToken>`
  - `?sessionToken=<sessionToken>`

---

## 4) Request method definitions (quick reference)

### GET

Used to retrieve data without changing server state.

Examples:

- `GET /api/vaults/:outerToken/public-info`
- `GET /api/files/:outerToken/list?innerToken=...`

### POST

Use when creating something or executing an action.

Examples:

- `POST /api/vaults/` (create vault)
- `POST /api/vaults/:outerToken/access` (verify inner token and fetch access view)
- `POST /api/files/:fileId/download` (action endpoint)
- `POST /api/files/download-batch` (batch action endpoint)

### PUT

Use when updating an existing entity/mapping.

Examples:

- `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`
- `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`
- `PUT /api/portfolio/:entryId`

### DELETE

Use when revoking/deleting an entity.

Examples:

- `DELETE /api/files/:outerToken/sub-tokens/:tokenId`
- `DELETE /api/portfolio/:entryId` (soft delete: status becomes `DELETED`)

---

## 5) Endpoint catalog with examples

## 5.1 Security API (`/api/security`)

### `GET /api/security/captcha`
Purpose: create captcha challenge when brute-force protection is active.

Success example:

```json
{
  "captchaRequired": true,
  "challengeId": "c7f6...",
  "question": "8 + 6 = ?"
}
```

### `POST /api/security/captcha/verify`
Purpose: validate captcha answer.

Request:

```json
{
  "challengeId": "c7f6...",
  "answer": "14"
}
```

Success:

```json
{
  "message": "Captcha verified."
}
```

### `GET /api/security/captcha/required`
Purpose: tells whether current client should solve captcha.

Success:

```json
{
  "captchaRequired": false
}
```

### `GET /api/security/status`
Purpose: returns current anti-abuse status (rate-limit/block state).

### `GET /api/security/unauthorized-check` (admin session required)
Purpose: integrity check for portfolio tampering evidence.

---

## 5.2 Vault API (`/api/vaults`)

### `POST /api/vaults/`
Purpose: create a vault with MAIN token (no file upload here).

Request:

```json
{
  "innerToken": "MainDemo1234",
  "expiresInDays": 7
}
```

Success:

```json
{
  "message": "Vault created.",
  "outerToken": "OUTERABC1",
  "expiresInDays": 7
}
```

### `GET /api/vaults/:outerToken/public-info`
Purpose: public vault status summary before authentication.

Success:

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

### `POST /api/vaults/:outerToken/access`
Purpose: verify inner token and return file visibility for that token.

Request:

```json
{
  "innerToken": "MainDemo1234"
}
```

Success:

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

### `POST /api/vaults/:outerToken/sub-tokens`
Purpose: legacy/simple sub-token creation path.

### `GET /api/vaults/:outerToken/qr`
Purpose: generates QR code data URL for outer token.

---

## 5.3 Files API (`/api/files`)

### `POST /api/files/new-vault-upload` (multipart/form-data)
Purpose: create a new vault and upload initial files in one operation.

Form fields:

- `innerToken`
- `expiresInDays`
- `files` (repeated)
- `relativePaths` (repeated; aligned with files)

Success:

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

### `POST /api/files/:outerToken/upload` (multipart/form-data)
Purpose: upload more files to existing vault (MAIN token only).

Form fields:

- `innerToken`
- `files` (repeated)
- `relativePaths` (repeated)

### `GET /api/files/:outerToken/list?innerToken=...`
Purpose: list files accessible by given token.

### `POST /api/files/:outerToken/sub-tokens`
Purpose: create scoped SUB token and map files (main endpoint used by UI).

Request:

```json
{
  "mainInnerToken": "MainDemo1234",
  "subInnerToken": "SubDemo12345",
  "fileIds": ["file-uuid-1", "file-uuid-2"],
  "forceReassign": false
}
```

Success:

```json
{
  "message": "Sub-token created successfully.",
  "subTokenId": "token-uuid",
  "subInnerToken": "SubDemo12345",
  "reassignedConflicts": 0
}
```

### `GET /api/files/:outerToken/sub-tokens?mainInnerToken=...`
Purpose: list active sub-tokens and mapped files.

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`
Purpose: replace file mapping set for a sub-token.

Request:

```json
{
  "mainInnerToken": "MainDemo1234",
  "fileIds": ["file-uuid-3", "file-uuid-4"]
}
```

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`
Purpose: store encrypted-at-rest recoverable value for sub-token.

Request:

```json
{
  "mainInnerToken": "MainDemo1234",
  "subInnerToken": "SubDemo12345"
}
```

### `GET /api/files/:outerToken/sub-tokens/:tokenId/reveal?mainInnerToken=...`
Purpose: reveal stored sub-token value (MAIN token only).

Success:

```json
{
  "subInnerToken": "SubDemo12345"
}
```

### `DELETE /api/files/:outerToken/sub-tokens/:tokenId`
Purpose: revoke sub-token.

Request:

```json
{
  "mainInnerToken": "MainDemo1234"
}
```

### `POST /api/files/:fileId/download`
Purpose: one-time file retrieval endpoint.

Request:

```json
{
  "outerToken": "OUTERXYZ9",
  "innerToken": "MainDemo1234"
}
```

Success: binary file stream  
Failure: JSON error (for example invalid token or file already consumed)

### `POST /api/files/download-batch`
Purpose: download multiple files in one request as a ZIP archive.

Request:

```json
{
  "outerToken": "OUTERXYZ9",
  "innerToken": "MainDemo1234",
  "fileIds": ["file-uuid-1", "file-uuid-2", "file-uuid-3"]
}
```

Notes:
- Maximum file count per request is controlled by `BATCH_DOWNLOAD_MAX_FILES` (default: `10`).
- Response is `application/zip` and contains the requested files.
- One-time semantics still apply: each successfully delivered file is marked `DELETED`.

---

## 5.4 Auth API (`/api/auth`)

### `POST /api/auth/login`
Purpose: creates in-memory session token for protected app APIs.

Request:

```json
{
  "outerToken": "OUTERXYZ9",
  "innerToken": "MainDemo1234"
}
```

Success:

```json
{
  "message": "Vault session established.",
  "sessionToken": "session-uuid",
  "vaultId": "vault-uuid",
  "outerToken": "OUTERXYZ9",
  "tokenType": "MAIN",
  "role": "admin",
  "expiresAt": "2026-04-11T10:20:00.000Z",
  "remainingSeconds": 600000
}
```

### `GET /api/auth/isAuth`
Purpose: checks whether provided session token is currently valid.

---

## 5.5 Portfolio API (`/api/portfolio`) (session protected)

### Required auth

Send one of:

- `Authorization: Bearer <sessionToken>`
- `x-session-token: <sessionToken>`

### Endpoints

- `GET /api/portfolio/` -> list entries visible to current role
- `GET /api/portfolio/:entryId` -> get one entry
- `POST /api/portfolio/` (admin only) -> create entry
- `PUT /api/portfolio/:entryId` -> update entry
- `DELETE /api/portfolio/:entryId` (admin only) -> soft-delete entry

Create request example:

```json
{
  "title": "Security Note",
  "content": "Token rotation completed.",
  "ownerTokenId": "optional-owner-token-uuid"
}
```

---

## 5.6 Module B API (`/api/module-b`)

### `GET /api/module-b/evidence` (admin only)
Purpose: returns security evidence bundle:

- index metadata (`SHOW INDEX`)
- query plan (`EXPLAIN`)
- integrity findings
- audit summary

---

## 6) End-to-end flows (how requests chain together)

## Flow A: New vault + first upload + QR

1. Frontend calls `POST /api/files/new-vault-upload` with multipart form.
2. Server creates vault, main token, file rows, metadata rows, access mappings.
3. Client receives `outerToken`.
4. Client calls `GET /api/vaults/:outerToken/qr`.
5. UI displays token and QR for sharing.

## Flow B: Recipient access and file listing

1. Client calls `GET /api/vaults/:outerToken/public-info`.
2. User enters inner token.
3. Client calls `POST /api/vaults/:outerToken/access`.
4. Server validates token and returns only accessible files.

## Flow C: Scoped sub-token lifecycle

1. Admin calls `POST /api/files/:outerToken/sub-tokens`.
2. Server creates SUB token + file mappings.
3. Optional: `PUT /.../secret` to store recoverable sub-token value.
4. Optional: `PUT /.../files` to remap accessible files.
5. Optional: `DELETE /.../:tokenId` to revoke.

## Flow D: One-time download semantics

1. Client calls `POST /api/files/:fileId/download`.
2. Server verifies token-file mapping.
3. Server returns file bytes.
4. Server marks file `DELETED`, removes key mappings, logs download event.
5. Next download attempt returns gone/not found behavior.

## Flow D2: Batch download semantics

1. Client calls `POST /api/files/download-batch`.
2. Server verifies token access for all requested file IDs.
3. Server decrypts/validates each file and packages them into one ZIP response.
4. Server marks each delivered file `DELETED`, removes key mappings, and logs download events.
5. Any later download attempt for those same files returns gone/not found behavior.

## Flow E: Session-based admin portfolio APIs

1. Call `POST /api/auth/login` to get `sessionToken`.
2. Call protected APIs with bearer/session header.
3. Portfolio CRUD and module evidence endpoints enforce role checks.

---

## 7) Client implementation notes (frontend behavior)

- `fetchJson(...)` helper throws on non-2xx and propagates server error message.
- Upload uses `XMLHttpRequest` to expose `upload.onprogress`.
- Captcha retry flow wraps sensitive actions and replays pending action after success.
- MAIN users can multi-select files in the Files view and use `Download Selected` (batch ZIP endpoint).
- Download API returns blob (single-file) or ZIP blob (batch), then frontend triggers browser download.

---

## 8) Practical cURL examples

### 8.1 Access vault

```bash
curl -X POST "http://localhost:4000/api/vaults/OUTERXYZ9/access" \
  -H "Content-Type: application/json" \
  -d "{\"innerToken\":\"MainDemo1234\"}"
```

### 8.2 Create sub-token

```bash
curl -X POST "http://localhost:4000/api/files/OUTERXYZ9/sub-tokens" \
  -H "Content-Type: application/json" \
  -d "{\"mainInnerToken\":\"MainDemo1234\",\"subInnerToken\":\"SubDemo12345\",\"fileIds\":[\"file-uuid-1\"]}"
```

### 8.3 Batch download (ZIP)

```bash
curl -X POST "http://localhost:4000/api/files/download-batch" \
  -H "Content-Type: application/json" \
  -d "{\"outerToken\":\"OUTERXYZ9\",\"innerToken\":\"MainDemo1234\",\"fileIds\":[\"file-uuid-1\",\"file-uuid-2\"]}"
```

### 8.4 Login + call admin evidence endpoint

```bash
curl -X POST "http://localhost:4000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"outerToken\":\"OUTERXYZ9\",\"innerToken\":\"MainDemo1234\"}"
```

Then:

```bash
curl "http://localhost:4000/api/module-b/evidence" \
  -H "Authorization: Bearer <sessionToken>"
```

---

## 9) Summary

This system uses a mixed API model:

- JSON REST requests for control/auth/metadata operations
- multipart upload requests for file ingestion
- binary stream response for single download
- ZIP stream response for batch download
- layered security with captcha/rate-limit, token verification, scoped access, and role-based session APIs

This design is suitable for production-style API documentation and repository publication.


