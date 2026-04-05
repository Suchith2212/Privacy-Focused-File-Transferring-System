# Module A ACID Evidence Summary (7-Relation Domain-Aligned)

## Relation Model Used
- `vaults`
- `inner_tokens`
- `files`
- `sessions`
- `download_logs`
- `expiry_jobs`
- `portfolio_entries`

## Executed Command
```powershell
python ..\Project_Assignments\Assignment3\module_a\tests\test_acid.py
```

## Test Results
```text
[PASS] Atomicity (crash before commit)
[PASS] Atomicity (explicit rollback, 7 relations)
[PASS] Consistency (valid references across 7 relations)
[PASS] Consistency (engine rejects negative file size)
[PASS] Consistency (engine rejects missing reference)
[PASS] Isolation (concurrent file inserts)
[PASS] Isolation (no dirty read)
[PASS] Isolation (serialized write conflict ordering)
[PASS] Atomicity (mid-commit failure injection rollback)
[PASS] API blocks non-transactional mutations
[PASS] Negative path: bypass is not durable and not WAL-logged
[PASS] Durability (single commit restart)
[PASS] Durability (multiple commits restart across 7 relations)
[PASS] Durability (multiple commits + incomplete tail)
[PASS] Recovery (commit replay + incomplete ignore)
[PASS] Recovery (idempotent replay across repeated restarts)
[OK] All 16 ACID/recovery checks passed.
```

Detailed machine-readable results:
- `results/acid_test_results_detailed.json`

