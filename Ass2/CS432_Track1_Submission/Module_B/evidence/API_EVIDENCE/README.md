# API Evidence

This folder contains the packaged request/response proof for the assignment-facing Module B API behavior.

## Packaged files

- `01_admin_login_request_response.txt`
- `02_admin_isauth_response.txt`
- `03_user_login_request_response.txt`
- `04_portfolio_list_admin.txt`
- `05_portfolio_create_admin.txt`
- `06_portfolio_get_single.txt`
- `07_portfolio_update.txt`
- `08_portfolio_delete.txt`
- `09_user_denied_action.txt`
- `10_unauthorized_check.txt`
- `11_module_b_evidence.txt`
- `12_api_evidence_summary.md`
- `13_api_matrix.md`

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

1. `12_api_evidence_summary.md`
2. `13_api_matrix.md`
3. `01_admin_login_request_response.txt`
4. `02_admin_isauth_response.txt`
5. `04_portfolio_list_admin.txt`
6. `05_portfolio_create_admin.txt`
7. `07_portfolio_update.txt`
8. `08_portfolio_delete.txt`
9. `03_user_login_request_response.txt`
10. `09_user_denied_action.txt`
11. `10_unauthorized_check.txt`
12. `11_module_b_evidence.txt`

## Reproducible demo basis

The packaged evidence was captured against the deterministic dataset created by:

- `Module_B/app/backend/reports/seed_module_b_demo.js`

That script creates:

- one active vault
- one MAIN token
- one SUB token
- portfolio rows suitable for both positive and negative authorization proof
