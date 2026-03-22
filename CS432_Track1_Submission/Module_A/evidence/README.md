# Module A Evidence

This folder contains the packaged Module A evidence used to support the final submission.

## Packaged evidence groups

- demo outputs
- parity and rebuild outputs
- benchmark console captures
- benchmark JSON outputs
- benchmark PNG plots
- final evidence summaries

## Main packaged files

- `01_module_a_demo_console.txt`
- `02_module_a_demo_output.json`
- `03_module_a_parity_console.txt`
- `04_module_a_parity_output.json`
- `05_module_a_parity_summary.md`
- `06_module_a_benchmark_console.txt`
- `07_module_a_benchmark_results.json`
- `08_module_a_benchmark_summary.md`
- `09_module_a_plot_explanations.md`
- `13_module_a_evidence_summary.md`
- `benchmark_detailed.json`
- `benchmark_operation_dashboard.png`
- `benchmark_insertion.png`
- `benchmark_search.png`
- `benchmark_deletion.png`
- `benchmark_range.png`
- `benchmark_random_workload.png`
- `benchmark_speedup.png`
- `benchmark_memory.png`
- `benchmark_memory_peak_allocations.png`
- `benchmark_memory_after_delete.png`
- `benchmark_memory_dashboard.png`

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

1. `13_module_a_evidence_summary.md`
2. `05_module_a_parity_summary.md`
3. `08_module_a_benchmark_summary.md`
4. `09_module_a_plot_explanations.md`
5. `Module_A/integration/benchmark_blinddrop_paths_summary.md`
6. the PNG plots in this folder
7. `Module_A/integration/bptree_v2/render_manifest.json`
