# Module B Technical Documentation

This document describes the **current packaged Module B implementation** in `CS432_Track1_Submission/Module_B`. It is written as a self-contained technical explanation for the submission bundle rather than as a development note for the wider repository.

## 1. Architecture

- **Backend:** Node.js + Express
- **Database:** MySQL (`blinddrop_proto`)
- **Frontend:** static HTML/CSS/JavaScript served by Express
- **Storage for file blobs:** Google Drive in the original BlindDrop workflow
- **Session model:** token-based vault session service
- **Assignment layer:** RBAC portfolio CRUD, audit logging, tamper detection, and SQL optimization evidence

## 2. Authentication and Role Mapping

The application reuses the original BlindDrop credential model instead of introducing a second, unrelated user table.

- `outerToken + MAIN innerToken` => `admin`
- `outerToken + SUB innerToken` => `user`

Module B login routes:

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

Protected routes accept the session token through the `Authorization: Bearer <token>` header and the backend revalidates vault and token state against MySQL on authenticated requests.

## 3. Schema Overview

### Core tables

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

### Assignment-facing table

11. `portfolio_entries`

This is the dedicated Module B CRUD resource. It exists so the submission can demonstrate:

- authenticated create/read/update/delete
- row ownership for RBAC
- unauthorized direct DB modification detection
- realistic index tuning for a protected query path
- a session-backed member portfolio web UI

### Runtime support

12. `sub_token_secrets`

This support table is created by the application for the BlindDrop UI and is not the primary Module B evaluation table.

## 4. Why `portfolio_entries` was added

The core product tables such as `vaults`, `inner_tokens`, and `files` are valid business tables, but they are not clean assignment-facing CRUD targets.

`portfolio_entries` was introduced because it provides:

- a defensible project-specific CRUD resource
- direct owner-based visibility rules
- a clear admin vs user distinction
- a natural place to attach integrity protection
- a realistic SQL optimization story

## 5. API Surface

### Assignment-facing APIs

- `POST /api/auth/login`
- `GET /api/auth/isAuth`
- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`
- `GET /api/security/unauthorized-check`
- `GET /api/module-b/evidence`

### Related security APIs

- `GET /api/security/captcha`
- `POST /api/security/captcha/verify`
- `GET /api/security/captcha/required`
- `GET /api/security/status`

### Original product APIs retained in the package

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

## 6. RBAC Rules

### Admin (`MAIN`)

- can list all active portfolio entries in the vault
- can create entries
- can update any active entry in the vault
- can delete entries
- can run `unauthorized-check`

### User (`SUB`)

- can list only owned active entries
- can read only owned active entries
- can update only owned active entries
- cannot create entries
- cannot delete entries
- cannot run `unauthorized-check`

## 7. Security Model

### Session validation

The session service stores a generated session token in memory and revalidates the token against the current database state. If the vault expires or the token is revoked, the session becomes invalid.

### Tamper detection

Every `portfolio_entries` row stores an `integrity_hash`. The hash is computed from:

- vault ID
- owner token ID
- title
- content
- status
- server-side secret

If the row is modified directly in MySQL without recalculating the hash through the application logic, the backend can detect the mismatch.

### Passive and active checks

- **Passive protection:** tampered rows are blocked on read routes
- **Active protection:** `GET /api/security/unauthorized-check` returns tampered rows for an admin

### Audit logging

The backend writes JSON-lines entries to `logs/audit.log`. Each entry contains:

- timestamp
- severity
- session ID
- IP address
- user agent
- action
- `previousHash`
- `entryHash`

The `previousHash` and `entryHash` fields make the log chain tamper-evident.

### Member lifecycle handling

The current package treats SUB-token administration as explicit member lifecycle management:

- member creation writes both a lifecycle portfolio entry and an audit event
- member scope updates write both a lifecycle portfolio entry and an audit event
- member revocation removes access mappings, deletes helper secret storage, archives member-owned active portfolio entries, and writes both a lifecycle portfolio entry and an audit event

## 8. SQL Optimization Strategy

### Main protected query pattern

```sql
SELECT benchmark_id, title, updated_at
FROM portfolio_benchmark_entries
WHERE vault_id = ?
  AND owner_token_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 25;
```

### Main indexes

```sql
CREATE INDEX idx_portfolio_vault_owner_status
ON portfolio_entries(vault_id, owner_token_id, status, updated_at);

CREATE INDEX idx_portfolio_vault_status
ON portfolio_entries(vault_id, status, updated_at);

CREATE INDEX idx_portfolio_integrity_hash
ON portfolio_entries(integrity_hash);
```

### Supporting indexes

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

CREATE INDEX idx_vault_expiry
ON vaults(status, expires_at);

CREATE INDEX idx_expiry_jobs_sched
ON expiry_jobs(processed, scheduled_time);
```

## 9. Packaged Benchmark Result

The benchmark evidence in `evidence/BENCHMARK_EVIDENCE/` records the following packaged result:

| Stage | Duration (ms) | Plan type | Rows | Extra |
| --- | ---: | --- | ---: | --- |
| Baseline full scan | 452.8318 | `ALL` | 4999 | `Using where; Using filesort` |
| Composite lookup index | 40.0727 | `ref` | 1 | `Backward index scan` |
| Composite + covering comparison stage | 36.8205 | `ref` | 1 | `Backward index scan` |

This is approximately:

- **11.30x faster** for the composite lookup index versus the baseline full scan
- **12.30x faster** for the composite-plus-covering comparison stage versus the baseline full scan

Important note: in the captured `EXPLAIN` output, MySQL still selected `idx_portfolio_benchmark_lookup` even after the covering index was added. The third stage therefore represents a comparison stage with the covering index present, not a proof that the optimizer switched to that covering index.

The backend package now also contains `reports/api_response_benchmark.js`, which benchmarks real HTTP response times for the login, session validation, portfolio list, and evidence endpoints.

## 10. Source files in this package

- [app.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/app.js)
- [auth.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/auth.js)
- [portfolio.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/portfolio.js)
- [security.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/security.js)
- [moduleB.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/moduleB.js)
- [authSession.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/authSession.js)
- [portfolioIntegrity.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/portfolioIntegrity.js)
- [fileAuditLogger.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/fileAuditLogger.js)
- [schemaOptimization.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/schemaOptimization.js)
- [init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/sql/init_schema.sql)

## 11. Supporting documents

- [MODULE_B_FINAL_REPORT.md](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/docs/MODULE_B_FINAL_REPORT.md)
- [MODULE_B_RUNBOOK.md](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/docs/MODULE_B_RUNBOOK.md)
- [optimization_report.md](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/reports/optimization_report.md)
