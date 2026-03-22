# API Reference

## 1. API groups

- `/api/auth/*`
  Module B login and session validation
- `/api/portfolio/*`
  portfolio CRUD with RBAC and integrity checks
- `/api/module-b/*`
  evaluator-facing evidence route
- `/api/security/*`
  CAPTCHA, status, and unauthorized modification checks
- `/api/vaults/*`
  vault lifecycle and access routes
- `/api/files/*`
  file upload, listing, SUB token management, and download routes

## 2. Authentication APIs

### `POST /api/auth/login`

Purpose:

- validate `outerToken + innerToken`
- resolve the effective role from token type
- issue a session token for protected Module B routes

Request body:

```json
{
  "outerToken": "OUTER123",
  "innerToken": "MainInner123"
}
```

Success response fields:

- `message`
- `sessionToken`
- `vaultId`
- `outerToken`
- `tokenType`
- `role`
- `expiresAt`
- `remainingSeconds`

### `GET /api/auth/isAuth`

Purpose:

- verify whether a session token is still valid

Accepted session transport:

- `Authorization: Bearer <token>`
- `x-session-token: <token>`
- `?sessionToken=<token>`

Success response fields:

- `authenticated`
- `outerToken`
- `vaultId`
- `role`
- `tokenType`
- `remainingSeconds`

## 3. Portfolio APIs

All `/api/portfolio` routes require a valid session token issued by `POST /api/auth/login`.

### `GET /api/portfolio`

Purpose:

- list visible active portfolio entries in the current vault

Behavior:

- `admin` sees all active entries in the vault
- `user` sees only owned active entries
- passive integrity validation runs before rows are returned
- tampered rows are withheld and counted separately

### `GET /api/portfolio/:entryId`

Purpose:

- fetch a single visible active portfolio entry

Behavior:

- returns not found when the row is outside the vault, deleted, or not visible to the current session
- denied reads are audit-logged
- tampered rows are blocked rather than returned

### `POST /api/portfolio`

Purpose:

- create a new portfolio entry

Authorization:

- `admin` only

Request body:

```json
{
  "title": "Admin Note",
  "content": "Module B verification entry.",
  "ownerTokenId": "optional-owner-token-id"
}
```

Validation:

- `title` is required
- `content` is required
- `ownerTokenId`, if supplied, must belong to the same vault and be active
- unexpected extra fields are rejected

### `PUT /api/portfolio/:entryId`

Purpose:

- update an existing active portfolio entry

Authorization:

- `admin` can update any accessible active row in the vault
- `user` can update only owned active rows

Behavior:

- integrity hash is recomputed on successful update
- denied update attempts are audit-logged
- tampered rows cannot be updated through the normal route

### `DELETE /api/portfolio/:entryId`

Purpose:

- soft delete an active portfolio entry

Authorization:

- `admin` only

Behavior:

- `status` becomes `DELETED`
- integrity hash is recomputed for the deleted state
- the row is no longer returned by active-list queries

## 4. Security APIs

### `GET /api/security/captcha`

Purpose:

- issue a CAPTCHA challenge when required

Response may include:

- `captchaRequired`
- `challengeId`
- `question`
- `expiresInSeconds`
- `maxAttempts`

### `POST /api/security/captcha/verify`

Purpose:

- verify a previously issued CAPTCHA challenge

Request body:

```json
{
  "challengeId": "...",
  "answer": "..."
}
```

### `GET /api/security/captcha/required`

Purpose:

- check whether CAPTCHA is currently required for the requesting IP

### `GET /api/security/status`

Purpose:

- inspect the current anti-abuse state for the requesting IP

Typical response fields:

- `blocked`
- `blockedSeconds`
- `captchaRequired`
- `captchaSolved`
- `failureCountMinute`
- `failureWeight10m`
- `lastFailureReason`

### `GET /api/security/unauthorized-check`

Purpose:

- detect `portfolio_entries` rows whose values no longer match the stored `integrity_hash`

Authorization:

- `admin` only

## 5. Module B evidence API

### `GET /api/module-b/evidence`

Purpose:

- return an evaluator-friendly summary of current Module B evidence

Authorization:

- `admin` only

Response includes:

- role mapping
- integrity-check summary
- audit event totals
- hash-chain validation state
- portfolio index information
- `EXPLAIN` plan summary

## 6. Vault APIs

### `POST /api/vaults`

Purpose:

- create a vault and MAIN token without initial file upload

### `GET /api/vaults/:outerToken/public-info`

Purpose:

- return public vault state such as expiry and active file count

### `POST /api/vaults/:outerToken/access`

Purpose:

- verify an inner token and return accessible file metadata

### `POST /api/vaults/:outerToken/sub-tokens`

Purpose:

- create a SUB token scoped to selected files

### `GET /api/vaults/:outerToken/qr`

Purpose:

- generate a QR representation of the outer token

## 7. File APIs

### `POST /api/files/new-vault-upload`

Purpose:

- create a new vault and upload initial files in one flow

### `POST /api/files/:outerToken/upload`

Purpose:

- upload more files to an existing vault

### `GET /api/files/:outerToken/list`

Purpose:

- list active files visible to the supplied token context

### `POST /api/files/:outerToken/sub-tokens`

Purpose:

- create a SUB token for selected file IDs with conflict handling

### `GET /api/files/:outerToken/sub-tokens`

Purpose:

- list active SUB tokens and their mapped files

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/files`

Purpose:

- replace the file mapping for an existing SUB token

### `PUT /api/files/:outerToken/sub-tokens/:tokenId/secret`

Purpose:

- store or restore the visible SUB token value in the helper table

### `DELETE /api/files/:outerToken/sub-tokens/:tokenId`

Purpose:

- revoke a SUB token

### `POST /api/files/:fileId/download`

Purpose:

- perform a one-time secure download, then logically delete and de-scope the file

## 8. Authorization summary

- product routes use token verification directly in the request flow
- Module B portfolio routes use the session token returned by `POST /api/auth/login`
- `MAIN` maps to `admin`
- `SUB` maps to `user`
- all protected Module B routes remain scoped to the current vault
- protected requests revalidate vault and token status against MySQL

## 9. Recommended evaluation endpoints

If time is limited, the strongest demonstration sequence is:

1. `POST /api/auth/login`
2. `GET /api/auth/isAuth`
3. `GET /api/portfolio`
4. `POST /api/portfolio`
5. `PUT /api/portfolio/:entryId`
6. denied user action or restricted visibility proof
7. `DELETE /api/portfolio/:entryId`
8. `GET /api/security/unauthorized-check`
9. `GET /api/module-b/evidence`
