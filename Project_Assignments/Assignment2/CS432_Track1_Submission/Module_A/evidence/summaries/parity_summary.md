# DB and B+ Tree Parity Proof

This proof demonstrates the Assignment 2 contract in executable form on top of the packaged Ghost Drop-shaped snapshot:

- relational state is authoritative
- the custom B+ Tree is synchronized before commit becomes visible
- forced index failure prevents partial visibility
- parity divergence can be detected
- read-path lazy repair can heal a missing index entry
- full rebuild can restore parity from authoritative state

Source snapshot: `F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment2\Ghost_Drop\backend\database_export.json`

| Seeded vaults | Seeded files | Seeded auth attempts | Final vaults | Final files | Final auth attempts |
| --- | --- | --- | --- | --- | --- |
| 120 | 500 | 1200 | 121 | 501 | 1201 |

## Key Outcomes

- `initial_state`: parity ok = `True`
- `commit_vault_success`: parity ok = `True`
- `commit_file_success`: parity ok = `True`
- `commit_auth_attempt_success`: parity ok = `True`
- `forced_index_failure_with_rollback`: rollback worked = `True`, failed vault visible = `False`
- `manual_divergence_detection`: parity ok = `False`
- `read_path_lazy_repair`: repaired = `True`, parity ok after repair = `True`
- `full_rebuild_from_authoritative_db`: parity before rebuild = `False`, after rebuild = `True`

## Viva Line

`The write path is DB-authoritative. If index mutation fails, the DB snapshot is not committed. If the index diverges later, parity checks detect it, lazy repair can restore a missed key during reads, and a full rebuild can reconstruct the complete B+ Tree from the authoritative relational state.`


