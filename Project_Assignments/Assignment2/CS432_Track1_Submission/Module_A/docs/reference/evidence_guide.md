# Module A Evidence Guide

This guide explains how the packaged Module A evidence should be read during evaluation.

## What the evidence must prove

The Module A evidence should demonstrate:

- the custom B+ Tree exists and runs
- the lightweight database abstraction exists around it
- the tree supports exact lookup and range scans
- the tree is compared against a brute-force baseline
- the tree can be visualized
- the same structure is also integrated into project-shaped access paths
- parity and rebuild behavior can be defended when the database remains authoritative

## Evidence reading order

1. `evidence/evidence_summary.md`
2. `evidence/demo_console.txt`
3. `evidence/demo_output.json`
4. `evidence/parity_summary.md`
5. `integration/db_index_parity_demo_summary.md`
6. `evidence/benchmark_summary.md`
7. `integration/benchmark_ghostdrop_paths_summary.md`
8. the PNG plots in `evidence/` and `integration/`

## Evidence groups

### Demo evidence

- `demo_console.txt`
- `demo_output.json`

These prove that the integrated index manager can execute:

- outer-token lookup
- expiry range scan
- vault-file range scan
- auth-attempt time scan

### Parity and rebuild evidence

- `parity_console.txt`
- `parity_output.json`
- `parity_summary.md`
- `integration/db_index_parity_demo_summary.md`

These prove:

- DB-authoritative commit behavior
- rollback on forced index failure
- parity validation
- lazy repair on read-path miss
- full rebuild from authoritative state

### Benchmark evidence

- `benchmark_console.txt`
- `benchmark_results.json`
- `benchmark_summary.md`
- `integration/benchmark_ghostdrop_paths_summary.md`
- the four domain PNGs in `integration/`
- the detailed benchmark PNGs in `evidence/`

These prove:

- the B+ Tree beats the brute-force baseline on project-shaped lookups
- range scans benefit from linked leaf traversal
- broader insertion/search/delete/range trends are visible across increasing dataset sizes
- memory and mixed-workload behavior were also measured
- both the domain benchmark and the detailed benchmark now include dashboard-level visual summaries

### Visualization evidence

- `integration/bptree_v2/*.png`
- `integration/bptree_v2/render_manifest.json`

These show the actual tree structure, the 19 rendered Ghost Drop-oriented indexes, and the snapshot/row-count metadata behind the rendered visuals.

## Final defense line

`Module A is not packaged here as a disconnected classroom tree. It is a complete from-scratch B+ Tree implementation, wrapped in a lightweight database layer, benchmarked against brute force, visualized with Graphviz, and then integrated into Ghost Drop-shaped lookup paths for stronger end-to-end justification.`


