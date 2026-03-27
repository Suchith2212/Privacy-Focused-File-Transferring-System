# Module A Integration Report

## 1. Objective

This report explains the full Module A story in the packaged `Module_A` submission.

The submission has two layers:

- a standalone Python B+ Tree database layer that directly answers the assignment brief
- a BlindDrop-specific integration layer that demonstrates the same structure on application-shaped paths

## 2. Standalone Module A implementation

The assignment requires a B+ Tree from scratch plus a lightweight DB-style wrapper. That requirement is satisfied in:

- `database/bplustree.py`
- `database/bruteforce.py`
- `database/table.py`
- `database/db_manager.py`

The packaged B+ Tree supports:

- insertion
- deletion
- update
- exact search
- range query
- ordered traversal through linked leaves
- Graphviz visualization

The brute-force baseline provides the linear-time comparison needed for benchmarking.

## 3. Integration design decision

The integration follows a strict rule:

- **authoritative state stays relational/export-driven**
- **the custom B+ Tree remains the assignment-facing index layer**

This means the design does not try to replace MySQL or duplicate the full live backend in Python. Instead, it keeps the custom index in the role it is best suited to defend academically: a standalone from-scratch structure that can also be mapped onto realistic workloads.

## 4. BlindDrop-shaped indexed paths

The integration layer demonstrates four concrete paths:

### 4.1 Outer-token lookup

- key: `outer_token`
- value: `vault_id`
- importance: vault discovery begins with the outer token

### 4.2 Expiry range scan

- key: `expires_at_epoch`
- value: one or more `vault_id` postings
- importance: expiry and maintenance jobs naturally scan ranges

### 4.3 Vault-file range scan

- key: `(vault_id, status, created_at_epoch)`
- value: one or more `file_id` postings
- importance: file listing and file lifecycle queries are range-oriented

### 4.4 Auth-attempt timeline scan

- key: `(session_id, attempt_time_epoch)`
- value: `auth_attempt_id`
- importance: security analysis depends on timeline access patterns

## 5. Duplicate-key handling

The standalone B+ Tree stores one value per key. Real project-shaped indexes often need multiple records per logical key. To handle that without rewriting the whole tree implementation, the integration layer introduces `PostingListIndex`.

That wrapper:

- stores a list of postings as the B+ Tree value
- appends new postings for duplicate logical keys
- updates the list on insert and delete

This is enough to support the integrated paths while preserving the original tree implementation.

## 6. Demonstration layer

`blinddrop_index_demo.py` shows the integrated B+ Tree working on the four project-shaped paths. This is important because it proves the tree is not only correct on synthetic examples, but also meaningful on a domain-aligned dataset.

## 7. Parity, rollback, and rebuild layer

`db_index_parity_demo.py` strengthens the Module A story by proving the contract between authoritative state and the custom index.

It demonstrates:

- successful synchronized write behavior
- successful auth-attempt mutation on top of the seeded snapshot
- forced index failure with rollback
- parity validation
- lazy repair on read-path miss
- full rebuild from authoritative state

This matters because it gives a defensible answer to the question: *what happens if the custom index diverges from the underlying database view?*

## 8. Benchmark layer

The package includes two benchmark styles:

### Domain benchmark

`benchmark_blinddrop_paths.py` compares the B+ Tree wrapper against brute force on:

- outer-token lookup
- expiry range scan
- vault-file range scan
- auth-attempt range scan

The packaged run is driven from `Project_432/backend/database_export.json`, expands that export into 20 deterministic benchmark points, and produces both per-path plots and a combined dashboard plus speedup chart.

### Detailed benchmark

`benchmark_detailed.py` sweeps a larger set of dataset sizes and outputs:

- operations dashboard
- insertion plot
- search plot
- deletion plot
- range-query plot
- random mixed-workload plot
- speedup plot
- retained-size memory plot
- peak-allocation memory plot
- post-delete memory plot
- memory dashboard

The current packaged detailed run contains 22 benchmark points with two averaged runs per point, which gives the report denser trend lines than the earlier lightweight benchmark draft.

The memory evidence is intentionally split because a single graph can be misleading. The package now distinguishes:

- retained structure size after inserts
- temporary Python allocator peaks during the build phase
- retained structure size after deleting 20% of keys

This gives a broader performance story than a single benchmark chart.

## 9. Visualization layer

The package also includes Graphviz-backed visualization evidence:

- the core B+ Tree can be visualized from the standalone implementation
- the integrated indexes can be rendered through `render_bptree_v2.py`
- the generated PNGs under `integration/bptree_v2/` make the tree structure concrete during review
- `integration/bptree_v2/render_manifest.json` records the source snapshot, row counts, and tree statistics for all 19 rendered indexes

## 10. Why this package is strong

This Module A package is stronger than a minimal submission because it provides:

- the required from-scratch tree
- the required brute-force comparison
- the required lightweight DB abstraction
- the required visualization story
- a project-shaped integration layer
- parity/rollback/rebuild proof
- multiple benchmark views and generated artifacts

## 11. Viva explanation

`For Module A, I implemented the B+ Tree and the lightweight database wrapper in Python as required, benchmarked it against a brute-force baseline, and then added a BlindDrop-specific integration layer so I could demonstrate exact lookups, range scans, parity validation, rollback, repair, rebuild, and Graphviz visualization on realistic project-shaped paths.`
