# Module B Compliance Checklist

This note maps the packaged Module B submission directly to the common evaluator checks from the Track 1 Assignment 2 brief.

## 1. SQL folder is present and usable

- Submission-facing schema copy: [sql/init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/sql/init_schema.sql)
- Runtime schema copy: [app/backend/sql/init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/sql/init_schema.sql)
- SQL folder guide: [sql/README.md](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/sql/README.md)

The packaged `sql/` folder now exposes one clear schema entry point instead of stale alternate copies.

## 2. Core tables and project-specific tables are separated

Core BlindDrop tables are defined in the same schema script and include:

- `vaults`
- `inner_tokens`
- `files`
- `file_key_access`
- `audit_logs`
- `auth_attempts`
- `sessions`
- `download_logs`
- `captcha_tracking`
- `expiry_jobs`

Project-specific Module B table:

- `portfolio_entries`

The assignment-facing CRUD surface is intentionally isolated to `portfolio_entries`.

## 3. Session validation is enforced on protected APIs

Auth middleware:

- [app/backend/src/middleware/authSession.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/middleware/authSession.js)

Direct middleware use:

- [app/backend/src/routes/portfolio.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/portfolio.js)
  `router.use(requireAuth, ...)` applies session validation to the portfolio surface before CRUD handlers run.
- [app/backend/src/routes/security.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/security.js)
  `GET /api/security/unauthorized-check` is guarded by `requireAdmin`.
- [app/backend/src/routes/moduleB.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/moduleB.js)
  `GET /api/module-b/evidence` is guarded by `requireAdmin`.

Middleware behavior:

- extracts the session token from cookies or `Authorization`
- validates the session against MySQL
- attaches `req.authSession`
- rejects invalid sessions with `401`

## 4. RBAC is enforced, not just documented

Role mapping source:

- [app/backend/src/routes/auth.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/routes/auth.js)
- [app/backend/src/services/authSession.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/authSession.js)

Assignment mapping:

- `MAIN` inner token => `admin`
- `SUB` inner token => `user`

Behavioral enforcement:

- admins can create and delete portfolio entries
- users can only read and update their own active entries
- users cannot access the admin-only tamper-check endpoint

Packaged end-to-end verification:

- [app/backend/reports/verify_module_b_e2e.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/reports/verify_module_b_e2e.js)

## 5. Audit logs are meaningful

Audit writer:

- [app/backend/src/services/fileAuditLogger.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/fileAuditLogger.js)

Recorded actions include:

- `portfolio.create`
- `portfolio.update`
- `portfolio.delete`
- `portfolio.read.denied`
- `security.unauthorized-check`
- integrity-check related events

Packaged evidence:

- [logs/audit.log](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/logs/audit.log)
- `evidence/AUDIT_LOG_EVIDENCE/`

## 6. Unauthorized direct DB modification detection exists

Integrity service:

- [app/backend/src/services/portfolioIntegrity.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/portfolioIntegrity.js)

Protected routes:

- tampered rows are blocked during normal portfolio reads
- admins can run `GET /api/security/unauthorized-check`
- admins can inspect `GET /api/module-b/evidence`

This is the primary packaged tamper-detection path. It is application-visible and does not rely on elevated trigger privileges.

## 7. Indexing rationale and EXPLAIN evidence are present

Index definitions:

- [app/backend/sql/init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/sql/init_schema.sql)
- [app/backend/src/services/schemaOptimization.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/src/services/schemaOptimization.js)

Benchmark and EXPLAIN source:

- [app/backend/reports/index_benchmark.js](/F:/SEM%20IV/lessons/DB/Project/CS432_Track1_Submission/Module_B/app/backend/reports/index_benchmark.js)

Packaged benchmark evidence:

- `evidence/BENCHMARK_EVIDENCE/01_benchmark_results.txt`
- `evidence/BENCHMARK_EVIDENCE/06_explain_plan_table.md`
- `evidence/BENCHMARK_EVIDENCE/07_benchmark_results.json`

The measured protected query uses `vault_id`, `owner_token_id`, `status`, and `updated_at`, which is why the composite lookup index follows that order.

## 8. Submission cleanliness

The final package should exclude transient dependency caches and local install artifacts. During cleanup, remove:

- `app/backend/node_modules/`
- `.npm-cache/`

Those folders are not part of the graded source submission.
