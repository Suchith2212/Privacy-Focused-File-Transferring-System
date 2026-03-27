# EXPLAIN Plan Table

| Stage | type | possible_keys | key | rows | Extra |
| --- | --- | --- | --- | ---: | --- |
| Baseline full scan | `ALL` | `None` | `None` | 4999 | `Using where; Using filesort` |
| Composite lookup index | `ref` | `idx_portfolio_benchmark_lookup` | `idx_portfolio_benchmark_lookup` | 1 | `Backward index scan` |
| Composite + covering comparison | `ref` | `idx_portfolio_benchmark_lookup,idx_portfolio_benchmark_covering` | `idx_portfolio_benchmark_lookup` | 1 | `Backward index scan` |