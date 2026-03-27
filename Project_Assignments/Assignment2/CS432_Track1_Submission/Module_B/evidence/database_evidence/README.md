# Database Evidence

This folder contains the packaged database-side proof for Module B. It shows that the schema, indexes, and tamper-detection model described in the report are present in the actual database state used for the submission.

## Packaged files

- `db_snapshot.txt`
- `summaries/schema_inventory.md`
- `tamper_before_check.txt`
- `tamper_detection_result.txt`
- `ER_Diagrams/ghostdrop_er_basic.png`
- `ER_Diagrams/ghostdrop_er_basic.pdf`
- `ER_Diagrams/ghostdrop_er_formal.png`
- `ER_Diagrams/ghostdrop_er_formal.pdf`

Direct ERD source:

- [ER_Diagrams/ghostdrop_er_basic.gv](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/evidence/database_evidence/ER_Diagrams/ghostdrop_er_basic.gv)
- [ER_Diagrams/ghostdrop_er_formal.gv](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/evidence/database_evidence/ER_Diagrams/ghostdrop_er_formal.gv)
- [ER_Diagrams/generate_er_diagrams.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_B/evidence/database_evidence/ER_Diagrams/generate_er_diagrams.py)

## What this evidence demonstrates

- `portfolio_entries` exists as the dedicated Module B CRUD table
- the relational schema includes the expected core and security tables
- the optimized indexes exist on the relevant tables
- `integrity_hash` is present on the portfolio table
- the tamper-detection workflow can identify direct database changes
- the regenerated ER diagrams match the updated schema

## Useful SQL inspection commands

```sql
SHOW TABLES;
DESCRIBE portfolio_entries;
SHOW INDEX FROM portfolio_entries;
SHOW INDEX FROM inner_tokens;
SHOW INDEX FROM auth_attempts;
SHOW INDEX FROM download_logs;
SHOW INDEX FROM files;
SHOW INDEX FROM file_key_access;
SHOW INDEX FROM vaults;
SHOW INDEX FROM expiry_jobs;
SELECT entry_id, vault_id, owner_token_id, created_by_token_id, title, status, updated_at FROM portfolio_entries;
SELECT inner_token_id, vault_id, token_type, token_lookup_hash, status FROM inner_tokens;
SELECT file_id, vault_id, original_filename, status FROM files;
```

## How to read the packaged files

1. Open `db_snapshot.txt` for the concrete table/index snapshot
2. Open `summaries/schema_inventory.md` for the written explanation of what the tables and indexes mean
3. Open `tamper_before_check.txt` and `tamper_detection_result.txt` for the tamper-detection proof sequence

