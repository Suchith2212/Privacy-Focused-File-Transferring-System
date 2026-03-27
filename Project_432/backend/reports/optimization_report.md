# Portfolio Index Optimization Report

This report aligns `Project_432` to Module B style SQL optimization evidence using both the protected `portfolio_entries` access path and the higher-frequency BlindDrop security lookups.

## Query Target

The RBAC portfolio view repeatedly filters by:

```sql
WHERE vault_id = ?
  AND owner_token_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 25
```

## Added Index

```sql
CREATE INDEX idx_portfolio_vault_owner_status
ON portfolio_entries(vault_id, owner_token_id, status, updated_at);
```

Supporting production indexes now also include:

```sql
CREATE INDEX idx_portfolio_vault_status
ON portfolio_entries(vault_id, status, updated_at);

CREATE INDEX idx_portfolio_integrity_hash
ON portfolio_entries(integrity_hash);

CREATE INDEX idx_inner_tokens_lookup_hash
ON inner_tokens(token_lookup_hash, vault_id, status);

CREATE INDEX idx_file_key_access_token
ON file_key_access(inner_token_id);

CREATE INDEX idx_download_file_time
ON download_logs(file_id, download_time);

CREATE INDEX idx_download_token
ON download_logs(inner_token_id);

CREATE INDEX idx_auth_attempts_session_time
ON auth_attempts(session_id, attempt_time, success);

CREATE INDEX idx_files_deleted_at
ON files(deleted_at);
```

Reordered worker-oriented indexes:

```sql
CREATE INDEX idx_vault_expiry ON vaults(status, expires_at);
CREATE INDEX idx_expiry_jobs_sched ON expiry_jobs(processed, scheduled_time);
```

## Token Lookup Correction

The original idea of indexing `inner_tokens(token_hash)` is not correct for this project because `token_hash` is a salted PBKDF2 output. The implementation now uses a separate deterministic `token_lookup_hash` for indexed prefiltering and still performs PBKDF2 verification as the real authentication check.

## Benchmark Script

Run from [`backend`](/F:/SEM%20IV/lessons/DB/Project/Project_432/backend):

```bash
node reports/index_benchmark.js
```

The script:
- seeds a dedicated benchmark table
- captures `EXPLAIN` before indexing
- times 150 repeated queries before indexing
- creates the composite lookup index
- captures `EXPLAIN` after indexing
- times the same workload again

## Expected Result

- before index: broader scan with more rows examined
- after index: indexed lookup on `(vault_id, owner_token_id, status, updated_at)`
- improved latency for the RBAC portfolio listing path
- reduced auth cost for repeated vault access attempts because token verification now prefilters through `token_lookup_hash`
