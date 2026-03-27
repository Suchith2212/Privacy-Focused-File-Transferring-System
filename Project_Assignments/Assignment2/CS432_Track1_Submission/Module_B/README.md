# Module B

This folder is the final **Module B** submission package for **CS432 Track 1 Assignment 2**. It presents the assignment-facing part of `Project_432` as a complete local system with source code, schema scripts, report material, logs, and evaluator-ready evidence.

## Submission objective

Module B requires:

- a local database-backed web application
- local session validation
- Role-Based Access Control with Admin and Regular User behavior
- CRUD over project-specific data
- local security audit logging
- identification of unauthorized direct database modifications
- SQL indexing, profiling, and before/after performance benchmarking

This package satisfies those requirements by adapting the BlindDrop application into a coherent Module B submission.

## System summary

The underlying product is a secure temporary file-sharing application built around expiring vaults. Instead of introducing a separate login table that does not belong to the original domain, Module B reuses the existing vault security model:

- `outerToken + MAIN innerToken` => `admin`
- `outerToken + SUB innerToken` => `user`

The assignment-facing CRUD surface is implemented through the `portfolio_entries` table and the `/api/portfolio` routes.

The packaged frontend now also includes a session-backed **Member Portfolio** panel inside the vault UI, so Module B is no longer API-only for the assignment-facing CRUD workflow.

## Folder structure

- `app/backend/`
  Express backend source, SQL benchmark scripts, demo seeding script, and implementation reports.
- `app/frontend/`
  Static frontend served by the backend.
- `sql/`
  Submission-facing SQL schema copies.
- `docs/reference/`
  Technical documentation, runbook, and compliance checklist.
- `logs/`
  Packaged `audit.log` artifact for submission review.
- `evidence/`
  Organized proof folders for API behavior, database state, audit logs, and benchmarking, with summaries under each folder's `summaries/` subdirectory.
- `report.ipynb`
  Jupyter notebook version of the Module B report.

## Recommended reading order

1. [report.ipynb](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/report.ipynb)
2. [project_documentation.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/docs/reference/project_documentation.md)
3. [runbook.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/docs/reference/runbook.md)
4. [compliance_checklist.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/docs/reference/compliance_checklist.md)
5. `evidence/api_evidence/`
6. `evidence/database_evidence/`
7. `evidence/audit_log_evidence/`
8. `evidence/benchmark_evidence/`

## Requirement mapping

| Assignment requirement | Module B implementation |
| --- | --- |
| Local DB and project-specific tables | `app/backend/sql/init_schema.sql`, `sql/init_schema.sql` |
| Local UI and APIs | `app/frontend/`, `app/backend/src/routes/` |
| Session validation | `src/routes/auth.js`, `src/services/authSession.js` |
| Member portfolio feature | `portfolio_entries`, `/api/portfolio`, frontend Member Portfolio panel |
| Admin vs user RBAC | token-type mapping and route guards |
| Local audit logging | `src/services/fileAuditLogger.js`, `logs/audit.log` |
| Unauthorized DB modification detection | `src/services/portfolioIntegrity.js`, `/api/security/unauthorized-check` |
| SQL indexing and optimization | `src/services/schemaOptimization.js`, `sql/init_schema.sql` |
| Profiling and benchmarking | `app/backend/reports/index_benchmark.js`, `app/backend/reports/api_response_benchmark.js`, `evidence/benchmark_evidence/` |

The packaged schema is intentionally rerunnable on ordinary MySQL setups. Unauthorized direct database modification detection is enforced primarily through the `integrity_hash` model and the application-side verification route, rather than depending on elevated trigger-creation privileges.

## Evaluator shortcuts

- SQL schema folder: [`sql/init_schema.sql`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/sql/init_schema.sql)
- Auth middleware: [`authSession.js`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/middleware/authSession.js)
- Protected CRUD routes: [`portfolio.js`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/portfolio.js)
- Admin-only tamper check: [`security.js`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/security.js)
- EXPLAIN and timing benchmark: [`index_benchmark.js`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/reports/index_benchmark.js)
- Compliance map: [`compliance_checklist.md`](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/docs/reference/compliance_checklist.md)

## Key implementation files

- [app.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/app.js)
- [auth.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/auth.js)
- [portfolio.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/portfolio.js)
- [security.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/security.js)
- [moduleB.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/routes/moduleB.js)
- [app.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/frontend/app.js)
- [authSession.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/services/authSession.js)
- [portfolioIntegrity.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/services/portfolioIntegrity.js)
- [fileAuditLogger.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/services/fileAuditLogger.js)
- [schemaOptimization.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/src/services/schemaOptimization.js)
- [init_schema.sql](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/sql/init_schema.sql)
- [api_response_benchmark.js](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/app/backend/reports/api_response_benchmark.js)

## Submission status

This package now includes:

- source code
- schema scripts
- packaged logs
- markdown reports
- notebook report
- evidence summaries
- benchmark plots and tables

Transient local-install artifacts such as `node_modules/`, `.npm-cache/`, and a live `.env` file are intentionally excluded from the cleaned submission package.

Hosted demo video: https://youtu.be/FzY8OeX4d5E?si=ptfeexguYQ99MdmG

Useful packaged verification commands from `app/backend`:

- `npm run seed:module-b`
- `npm run benchmark:index`
- `npm run verify:e2e`
- `npm run smoke:tamper`
- `npm run smoke:full`

