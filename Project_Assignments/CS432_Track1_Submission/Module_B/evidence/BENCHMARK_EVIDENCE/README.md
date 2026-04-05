# Benchmark Evidence

This folder contains the packaged SQL-optimization proof for the Module B portfolio query path.

## Packaged files

- `01_benchmark_results.txt`
- `02_benchmark_summary.md`
- `03_duration_comparison.png`
- `04_speedup_comparison.png`
- `05_rows_examined.png`
- `06_explain_plan_table.md`
- `07_benchmark_results.json`
- `08_benchmark_comparison.csv`

## What this evidence demonstrates

- the benchmark query was measured before indexing
- the same query was measured after index creation
- `EXPLAIN` plans were captured for each stage
- the chosen index materially reduces query cost for the protected RBAC listing path

## Packaged benchmark result

| Stage | Duration (ms) | Plan type | Rows | Extra |
| --- | ---: | --- | ---: | --- |
| Baseline full scan | 452.8318 | `ALL` | 4999 | `Using where; Using filesort` |
| Composite lookup index | 40.0727 | `ref` | 1 | `Backward index scan` |
| Composite + covering comparison stage | 36.8205 | `ref` | 1 | `Backward index scan` |

## How to read this folder

1. Open `02_benchmark_summary.md`
2. Open `06_explain_plan_table.md`
3. View the three PNG charts
4. Use `01_benchmark_results.txt` or `07_benchmark_results.json` if raw values are needed
