# Schema Inventory

This file explains the meaning of the packaged database snapshot in `01_db_snapshot.txt`.

## Core tables present in the package

| Table | Purpose |
| --- | --- |
| `vaults` | stores vault identity, outer token, expiry, and status |
| `inner_tokens` | stores MAIN/SUB token records and hashed credentials |
| `files` | stores file-level metadata and lifecycle state |
| `file_metadata` | stores upload naming and path details |
| `file_key_access` | maps tokens to files they can access |
| `sessions` | stores request-session tracking data |
| `auth_attempts` | stores security-sensitive access attempts |
| `download_logs` | stores download audit rows |
| `captcha_tracking` | stores CAPTCHA enforcement state |
| `expiry_jobs` | stores vault-expiry processing metadata |
| `portfolio_entries` | stores the Module B CRUD resource |

## Important Module B columns

| Table | Column | Why it matters |
| --- | --- | --- |
| `portfolio_entries` | `owner_token_id` | identifies which token owns a row for RBAC |
| `portfolio_entries` | `created_by_token_id` | ties mutations to the acting token |
| `portfolio_entries` | `integrity_hash` | supports tamper detection |
| `portfolio_entries` | `status` | enables soft delete |
| `inner_tokens` | `token_lookup_hash` | supports indexed login prefiltering |

## Important indexes visible in the package

| Index | Purpose |
| --- | --- |
| `idx_portfolio_vault_owner_status` | user-scoped RBAC listing query |
| `idx_portfolio_vault_status` | admin-scoped vault listing query |
| `idx_portfolio_integrity_hash` | integrity-related lookups |
| `idx_inner_tokens_lookup_hash` | token prefiltering during login |
| `idx_auth_attempts_session_time` | session-attempt analysis |
| `idx_download_file_time` | per-file download-history access |
| `idx_download_token` | token-centric audit/history access |
| `idx_file_key_access_token` | token-to-file joins and cleanup |
| `idx_vault_expiry` | active-expiry worker scans |
| `idx_expiry_jobs_sched` | expiry queue ordering |

## Submission significance

The schema snapshot matters because it shows that the Module B submission is backed by a real normalized database design rather than a thin demo API. The presence of both business tables and optimized indexes supports the assignment’s emphasis on integrity, authorization, and database optimization.
