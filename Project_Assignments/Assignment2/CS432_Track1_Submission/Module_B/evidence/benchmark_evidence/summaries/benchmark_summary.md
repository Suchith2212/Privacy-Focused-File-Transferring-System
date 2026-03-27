# Benchmark Summary

This summary was generated from the packaged `benchmark_results.txt` snapshot.

## Result table

| Stage | Duration (ms) | Plan type | Key used | Rows | Extra |
| --- | ---: | --- | --- | ---: | --- |
| Baseline full scan | 452.8318 | `ALL` | `none` | 4999 | `Using where; Using filesort` |
| Composite lookup index | 40.0727 | `ref` | `idx_portfolio_benchmark_lookup` | 1 | `Backward index scan` |
| Composite + covering comparison | 36.8205 | `ref` | `idx_portfolio_benchmark_lookup` | 1 | `Backward index scan` |

## Interpretation

- baseline full scan -> composite lookup index: **11.30x faster**
- baseline full scan -> composite + covering comparison stage: **12.30x faster**
- in the captured EXPLAIN output, MySQL still selected `idx_portfolio_benchmark_lookup` even after the covering index was added
- the result validates the production design of the composite lookup index for the protected portfolio query
