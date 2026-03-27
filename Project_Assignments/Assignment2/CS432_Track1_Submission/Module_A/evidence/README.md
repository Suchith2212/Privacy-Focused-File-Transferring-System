# Module A Evidence

This folder contains the packaged Module A evidence used to support the final submission.

## Packaged evidence groups

- demo outputs
- parity and rebuild outputs
- benchmark console captures
- benchmark JSON outputs
- benchmark PNG plots
- summary docs in `summaries/`

## Main packaged files

- `demo_console.txt`
- `demo_output.json`
- `parity_console.txt`
- `parity_output.json`
- `summaries/parity_summary.md`
- `benchmark_console.txt`
- `benchmark_results.json`
- `summaries/benchmark_summary.md`
- `summaries/evidence_summary.md`
- `detailed_benchmark_results.json`
- `memory_dashboard.png`
- `insertion_benchmark.png`
- `search_benchmark.png`
- `deletion_benchmark.png`
- `range_benchmark.png`
- `random_workload_benchmark.png`
- `speedup_comparison.png`
- `retained_memory_after_insert.png`
- `peak_python_allocations.png`
- `retained_memory_after_delete.png`

## What this folder proves

This evidence demonstrates that:

- the custom Python B+ Tree runs correctly
- the integrated demo paths execute correctly
- parity, rollback, repair, and rebuild can be defended
- the B+ Tree outperforms the brute-force baseline on the relevant workloads
- the broader performance trends are supported by concrete plots
- the packaged benchmark evidence now includes both per-operation plots and dashboard-style comparison views
- the memory section now distinguishes retained structure size, peak Python allocations, and post-delete retained size

## Recommended reading order

1. `summaries/evidence_summary.md`
2. `summaries/parity_summary.md`
3. `summaries/benchmark_summary.md`
4. `Module_A/integration/reports/ghostdrop_paths_benchmark.md`
5. the PNG plots in this folder
6. `Module_A/integration/bptree_v2/render_manifest.json`
