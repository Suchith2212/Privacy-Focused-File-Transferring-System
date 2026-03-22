# Module B Optimization Report

This report explains the SQL optimization work packaged inside `CS432_Track1_Submission/Module_B/app/backend/reports`.

## 1. Optimization goal

The main goal was to optimize the protected portfolio listing query used by the Module B RBAC layer. That route is performance-sensitive because it combines:

- vault scoping
- owner scoping for user views
- active-row filtering
- recent-first ordering

## 2. Protected query pattern

```sql
SELECT benchmark_id, title, updated_at
FROM portfolio_benchmark_entries
WHERE vault_id = ?
  AND owner_token_id = ?
  AND status = 'ACTIVE'
ORDER BY updated_at DESC
LIMIT 25;
```

This benchmark query mirrors the same access pattern used by the real `/api/portfolio` logic.

## 3. Main portfolio indexes

```sql
CREATE INDEX idx_portfolio_vault_owner_status
ON portfolio_entries(vault_id, owner_token_id, status, updated_at);

CREATE INDEX idx_portfolio_vault_status
ON portfolio_entries(vault_id, status, updated_at);

CREATE INDEX idx_portfolio_integrity_hash
ON portfolio_entries(integrity_hash);
```

## 4. Supporting production indexes

```sql
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

CREATE INDEX idx_vault_expiry
ON vaults(status, expires_at);

CREATE INDEX idx_expiry_jobs_sched
ON expiry_jobs(processed, scheduled_time);
```

## 5. Token lookup correction

Indexing `inner_tokens(token_hash)` is not useful in this project because `token_hash` is a salted PBKDF2 output. The implementation therefore introduces `token_lookup_hash` for indexed prefiltering while keeping PBKDF2 verification as the real authentication step.

## 6. Benchmark script

Run from `Module_B/app/backend`:

```powershell
node reports/index_benchmark.js
```

The script:

- creates and seeds a dedicated benchmark table
- captures `EXPLAIN` before indexing
- measures repeated query execution before indexing
- creates the benchmark lookup index
- captures `EXPLAIN` after indexing
- measures the same workload again
- adds a comparison stage after introducing a covering index

## 7. Packaged benchmark result

| Stage | Duration (ms) | Plan type | Rows | Extra |
| --- | ---: | --- | ---: | --- |
| Baseline full scan | 452.8318 | `ALL` | 4999 | `Using where; Using filesort` |
| Composite lookup index | 40.0727 | `ref` | 1 | `Backward index scan` |
| Composite + covering comparison stage | 36.8205 | `ref` | 1 | `Backward index scan` |

## 8. Interpretation

- Before indexing, MySQL performed a full table scan and separate sorting.
- After indexing, MySQL switched to an indexed lookup with a backward index scan.
- The composite lookup index stage is about **11.30x faster** than the baseline full scan.
- The composite-plus-covering comparison stage is about **12.30x faster** than the baseline full scan.
- In the captured third-stage plan, MySQL still chose `idx_portfolio_benchmark_lookup`, so the result should be interpreted as a comparison stage rather than proof that the covering index became the selected plan.

## 9. Related packaged evidence

The full packaged evidence derived from this report is available in:

- `Module_B/evidence/BENCHMARK_EVIDENCE/01_benchmark_results.txt`
- `Module_B/evidence/BENCHMARK_EVIDENCE/02_benchmark_summary.md`
- `Module_B/evidence/BENCHMARK_EVIDENCE/03_duration_comparison.png`
- `Module_B/evidence/BENCHMARK_EVIDENCE/04_speedup_comparison.png`
- `Module_B/evidence/BENCHMARK_EVIDENCE/05_rows_examined.png`
- `Module_B/evidence/BENCHMARK_EVIDENCE/06_explain_plan_table.md`
