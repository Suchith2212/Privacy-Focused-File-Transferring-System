# Module A Integration Implementation Notes

This file documents the implementation-focused side of the Module A integration layer inside `Module_A/integration/`.

## Purpose

The standalone B+ Tree in `Module_A/database/` already satisfies the core assignment requirement. The purpose of this folder is to show how that same tree can be reused as a project-shaped index over BlindDrop-style data.

## Integration model

The integration does not try to replace the authoritative relational system. Instead:

- the authoritative dataset is loaded from a reproducible snapshot
- the Python B+ Tree is built over that data as an educational indexing layer
- benchmark and parity scripts operate against that indexed view

## Important implementation choices

### Posting-list wrapper

Because the base B+ Tree stores one value per key, the integration uses `PostingListIndex` to attach a list of postings to each logical key. This allows:

- multiple vault IDs per expiry timestamp
- multiple file IDs per composite file-range key
- multiple auth-attempt IDs per timeline key

### Composite-key normalization

The integration explicitly normalizes project-shaped keys into tuple form:

- `(vault_id, status, created_at_epoch)`
- `(session_id, attempt_time_epoch)`

This keeps the benchmark and demo behavior deterministic.

### Snapshot-driven reproducibility

The integration resolves reproducible snapshots in a fixed order:

- `Project_432/backend/database_export.json`
- `CS432_Track1_Submission/Module_B/app/backend/database_export.json`
- `amplified_snapshot.json`

This makes the package reproducible without requiring a live backend during every review.

## Main scripts

- `blinddrop_index_demo.py`
  Demonstrates the integrated lookup and range paths.
- `db_index_parity_demo.py`
  Demonstrates rollback, repair, and rebuild semantics.
- `benchmark_blinddrop_paths.py`
  Measures domain-shaped workloads.
- `benchmark_detailed.py`
  Measures broader insertion/search/delete/range/memory trends.
- `render_bptree_v2.py`
  Generates the integrated tree visualizations and writes `bptree_v2/render_manifest.json`.

## Relationship to the submission docs

Use this file for implementation-level explanation. For submission-facing summaries, read:

- `Module_A/docs/MODULE_A_INTEGRATION_REPORT.md`
- `Module_A/docs/15_MODULE_A_INTEGRATION_SUMMARY.md`
