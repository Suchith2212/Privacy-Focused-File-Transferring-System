# API Evidence Summary

## Captured run context

- Base URL: `http://localhost:4000`
- Demo outer token: `OUTERDEMO7`
- Admin role resolved as: `admin`
- User role resolved as: `user`
- Created portfolio entry ID: `9b889139-d22e-484e-8db3-6b2afdd2409f`
- Denied-action proof captured: `True`

## Captured files

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
- `module_b_evidence_overview.txt`

## Verified outcomes

| Check | Result |
| --- | --- |
| Admin login successful | `True` |
| User login successful | `True` |
| User denied-action proof captured | `True` |
| Unauthorized tampered count during this run | `0` |
| Module B evidence route captured | `True` |
| Reported portfolio index rows | `10` |
| Reported audit event count | `18` |
| Audit hash chain valid | `True` |

## Why this set is strong

This API evidence includes both positive and negative cases:

- positive authentication
- positive CRUD behavior
- negative authorization behavior
- active integrity-check route output
- examiner-facing evidence route output

That combination is stronger than success-only API screenshots because it proves the RBAC rules are actually enforced.

