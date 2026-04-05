# Module A Worklog

## Goal
Implement transaction management, crash recovery, and ACID validation on custom B+ Tree storage aligned to project-domain relations.

## Implemented Relation Set (7)
- `vaults`
- `inner_tokens`
- `files`
- `sessions`
- `download_logs`
- `expiry_jobs`
- `portfolio_entries`

## Tasks
- [x] Bring/implement B+ Tree engine in this folder
- [x] Enforce Assignment 3 B+Tree-only table backend
- [x] Add transaction manager (BEGIN/COMMIT/ROLLBACK)
- [x] Add write-ahead log
- [x] Add crash recovery replay/ignore-incomplete behavior
- [x] Add engine-side consistency checks (schema + cross-reference)
- [x] Add read-only table views to block non-transactional mutation paths
- [x] Add ACID/recovery tests across project-domain relations

## Verification Commands
```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3\module_a"
python tests\test_acid.py
python transaction_smoke_test.py
python smoke_test.py
```

## Current Result Snapshot
- `test_acid.py`: 16/16 checks PASS
- `transaction_smoke_test.py`: PASS
- `smoke_test.py`: PASS
