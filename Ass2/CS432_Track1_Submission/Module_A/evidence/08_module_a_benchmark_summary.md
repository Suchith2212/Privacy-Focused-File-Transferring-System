# Module A Benchmark Summary

This summary explains the benchmark evidence packaged in:

- `06_module_a_benchmark_console.txt`
- `07_module_a_benchmark_results.json`
- `benchmark_detailed.json`
- the PNG plots in `evidence/`
- `Module_A/integration/benchmark_blinddrop_paths_summary.md`

## Source dataset

The current benchmark package is anchored to:

- `Project_432/backend/database_export.json`

That export provides the real BlindDrop-shaped rows used by the integration layer. The domain benchmark amplifies those rows into larger deterministic datasets so the benchmark stays project-aligned while still showing scaling behavior.

## Benchmark layers

### Domain benchmark

The domain benchmark is produced by `integration/benchmark_blinddrop_paths.py`.

It currently includes:

- 20 measured points from 500 to 19,500 rows
- outer-token lookup
- expiry range scan
- vault-file range scan
- auth-attempt range scan
- per-path line charts
- `benchmark_path_dashboard.png`
- `benchmark_path_speedup.png`

Headline outcome from the packaged run:

- outer lookup average speedup: `17.6x`
- expiry range average speedup: `36.7x`
- file range average speedup: `62.0x`
- auth range average speedup: `8.4x`

### Detailed benchmark

The detailed benchmark is produced by `integration/benchmark_detailed.py`.

It currently includes:

- 22 measured points from 500 to 21,500 rows
- 2 averaged runs per point
- insertion, search, deletion, and selective range-query plots
- mixed random-workload plot
- speedup plot
- retained-size memory plot
- peak-allocation memory plot
- post-delete memory plot
- `benchmark_operation_dashboard.png`
- `benchmark_memory_dashboard.png`

## Interpretation

Across both benchmark layers, the same performance pattern is visible:

- exact lookup cost remains comparatively stable for the B+ Tree as the dataset grows
- brute-force lookup time grows steadily with dataset size
- range-oriented paths show even larger gains because the B+ Tree can traverse ordered leaves
- the detailed benchmark confirms the same scaling trend across generic insert/search/delete/range workloads
- memory is now reported in separate retained-size and peak-allocation views so the package does not mix long-lived structure size with temporary allocator spikes
- in this implementation, the brute-force list remains heavier in both retained-size checkpoints:
  - `1,000` records: `90.73 KB` vs `59.37 KB`
  - `21,000` records: `1891.66 KB` vs `1239.85 KB`

## Submission significance

This benchmark package is stronger than the earlier lightweight draft because it now combines:

- a project-aligned benchmark driven by the real exported backend dataset
- denser plots with 20-point and 22-point sweeps
- dashboard visualizations that compare multiple operations in one figure
- a refreshed aggregate JSON file, `07_module_a_benchmark_results.json`, that now matches the current detailed benchmark output
