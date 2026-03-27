# API Evidence

This folder contains the packaged request/response proof for the assignment-facing Module B API behavior.

## Packaged files

- `admin_login_request_response.txt`
- `admin_isauth_response.txt`
- `user_login_request_response.txt`
- `portfolio_list_admin.txt`
- `portfolio_create_admin.txt`
- `portfolio_get_single.txt`
- `portfolio_update.txt`
- `portfolio_delete.txt`
- `user_denied_action.txt`
- `unauthorized_check.txt`
- `summaries/module_b_evidence_overview.txt`
- `summaries/api_summary.txt`
- `summaries/api_evidence_summary.md`
- `summaries/api_matrix.md`

## What this evidence proves

Taken together, these files demonstrate:

- successful admin login
- successful user login
- working session validation
- admin CRUD behavior
- user restrictions under RBAC
- successful unauthorized-check execution
- availability of the examiner-facing evidence route

## Core endpoints represented in this folder

- `POST /api/auth/login`
- `GET /api/auth/isAuth`
- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`
- `GET /api/security/unauthorized-check`
- `GET /api/module-b/evidence`

## Recommended reading order

1. `summaries/api_evidence_summary.md`
2. `summaries/api_matrix.md`
3. `admin_login_request_response.txt`
4. `admin_isauth_response.txt`
5. `portfolio_list_admin.txt`
6. `portfolio_create_admin.txt`
7. `portfolio_update.txt`
8. `portfolio_delete.txt`
9. `user_login_request_response.txt`
10. `user_denied_action.txt`
11. `unauthorized_check.txt`
12. `summaries/module_b_evidence_overview.txt`
13. `summaries/api_summary.txt`

## Reproducible demo basis

The packaged evidence was captured against the deterministic dataset created by:

- `Module_B/app/backend/reports/seed_module_b_demo.js`

That script creates:

- one active vault
- one MAIN token
- one SUB token
- portfolio rows suitable for both positive and negative authorization proof
