# API Matrix

This matrix summarizes the expected Module B behavior and points to the packaged evidence files that demonstrate it.

| Endpoint | Actor | Expected behavior | Evidence |
| --- | --- | --- | --- |
| `POST /api/auth/login` | unauthenticated | valid vault credentials return a session token | `01_admin_login_request_response.txt`, `03_user_login_request_response.txt` |
| `GET /api/auth/isAuth` | authenticated | returns session status and resolved role | `02_admin_isauth_response.txt` |
| `GET /api/portfolio` | admin | lists all active entries in the vault | `04_portfolio_list_admin.txt` |
| `POST /api/portfolio` | admin | creates a new entry | `05_portfolio_create_admin.txt` |
| `GET /api/portfolio/:entryId` | admin | returns the created entry | `06_portfolio_get_single.txt` |
| `PUT /api/portfolio/:entryId` | admin | updates the entry and recomputes integrity hash | `07_portfolio_update.txt` |
| `DELETE /api/portfolio/:entryId` | admin | soft deletes the entry | `08_portfolio_delete.txt` |
| `GET /api/portfolio` | user | lists only owned active entries | reflected by role model and seeded data |
| protected portfolio action | user on non-owned row | denied by RBAC | `09_user_denied_action.txt` |
| `GET /api/security/unauthorized-check` | admin | returns tamper summary | `10_unauthorized_check.txt` |
| `GET /api/module-b/evidence` | admin | returns examiner-oriented evidence summary | `11_module_b_evidence.txt` |

## Role summary

- `MAIN` token => `admin`
- `SUB` token => `user`

## Interpretation

The matrix shows that Module B is not only exposing CRUD routes, but also enforcing role-specific behavior over the same dataset. The denied-action artifact is especially important because it proves the system blocks forbidden access rather than merely documenting that it should.
