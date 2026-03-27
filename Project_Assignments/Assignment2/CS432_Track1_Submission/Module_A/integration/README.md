# Module A Integration Layer

This folder contains the BlindDrop-specific integration layer for Module A. It reuses the standalone Python B+ Tree from `Module_A/database/` and maps it to real project-shaped index paths.

## Purpose

The assignment can be satisfied by a standalone B+ Tree implementation, but this package goes further by showing how the same structure can index actual application data without replacing MySQL as the authoritative store.

The integration rule is:

- **MySQL or exported relational state remains authoritative**
- **the custom B+ Tree acts as the educational indexing layer**

## Main artifacts

- `blinddrop_index_manager.py`
  Main integration facade. Wraps the B+ Tree and brute-force baseline in duplicate-key-friendly posting-list indexes.
- `blinddrop_index_demo.py`
  Demonstrates the project-shaped lookup and range-scan paths.
- `db_index_parity_manager.py`
  Manages the authoritative-state vs custom-index contract.
- `db_index_parity_demo.py`
  Demonstrates rollback, parity validation, lazy repair, and rebuild.
- `benchmark_blinddrop_paths.py`
  Benchmarks the B+ Tree wrapper against the brute-force baseline on BlindDrop-shaped paths derived from the exported backend snapshot.
- `benchmark_detailed.py`
  Runs a broader multi-size benchmark suite with additional plots, dashboard views, and memory measurements.
- `render_bptree_v2.py` and `visualize_blinddrop_indexes.py`
  Regenerate the Graphviz visualizations for the integrated indexes.
- `bptree_v2/`
  Generated PNG visualizations of the integrated index structures plus `render_manifest.json`.

## Indexed paths used in the integration

1. `outer_token -> vault_id`
2. `expires_at_epoch -> vault_id[]`
3. `(vault_id, status, created_at_epoch) -> file_id[]`
4. `(session_id, attempt_time_epoch) -> auth_attempt_id[]`

These were chosen because they match meaningful application access paths:

- vault discovery
- expiry scanning
- file listing by vault and status
- auth-attempt timeline inspection

## Commands

From `Module_A/integration`:

```powershell
python blinddrop_index_demo.py
python db_index_parity_demo.py
python benchmark_blinddrop_paths.py
python benchmark_detailed.py
python render_bptree_v2.py
```

By default these scripts resolve snapshots in this order:

1. `Project_432/backend/database_export.json`
2. `CS432_Track1_Submission/Module_B/app/backend/database_export.json`
3. `Module_A/integration/amplified_snapshot.json`

## Important generated outputs

- `blinddrop_index_demo_output.json`
- `db_index_parity_demo_output.json`
- `reports/db_index_parity_report.md`
- `benchmark_blinddrop_paths.json`
- `reports/blinddrop_paths_benchmark.md`
- `path_speedup_benchmark.png`
- `outer_lookup_benchmark.png`
- `Module_A/evidence/detailed_benchmark_results.json`
- `Module_A/evidence/memory_dashboard.png`
- `Module_A/evidence/insertion_benchmark.png`
- `Module_A/evidence/search_benchmark.png`
- `Module_A/evidence/deletion_benchmark.png`
- `Module_A/evidence/range_benchmark.png`
- `Module_A/evidence/random_workload_benchmark.png`
- `Module_A/evidence/speedup_comparison.png`
- `Module_A/evidence/retained_memory_after_insert.png`
- `Module_A/evidence/peak_python_allocations.png`
- `Module_A/evidence/retained_memory_after_delete.png`

## Why this is a strong Module A story

This integration turns Module A from a generic data-structure exercise into a project-aligned indexing demonstration. It preserves the standalone B+ Tree implementation required by the assignment while proving that the same structure can support meaningful point lookups, range scans, and parity/rebuild workflows on application-shaped data.
