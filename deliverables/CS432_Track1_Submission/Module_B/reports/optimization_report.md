# Module B Optimization Report

## Objective

Demonstrate that SQL indexing improves the performance of a representative application query in Module B.

## Query Under Test

The benchmark measures this join/filter/order path:

```sql
SELECT m.member_id, m.email, p.skills
FROM members m
JOIN portfolios p ON p.member_id = m.member_id
WHERE m.group_name = ?
ORDER BY m.email;
```

This query is representative because it combines:

- filtering on `members.group_name`
- join on `member_id`
- ordered output by `email`

## Indexes Applied

The benchmark applies these indexes:

- `idx_members_group_email ON members(group_name, email)`
- `idx_portfolios_updated_at ON portfolios(updated_at)`

The main optimization for the measured query is `idx_members_group_email`, because it supports both the `WHERE group_name = ?` filter and the `ORDER BY email` requirement.

## Observed Benchmark Output

Observed run in this workspace on March 18, 2026:

- before index: `0.004426933330250904` seconds average
- after index: `0.004011079996901875` seconds average

## Query Plan Comparison

### Before index

- `SCAN m`
- `SEARCH p USING INDEX sqlite_autoindex_portfolios_1 (member_id=?)`
- `USE TEMP B-TREE FOR ORDER BY`

Interpretation:
- SQLite performs a scan on `members`
- it needs extra sorting work for the final order

### After index

- `SEARCH m USING INDEX idx_members_group_email (group_name=?)`
- `SEARCH p USING INDEX sqlite_autoindex_portfolios_1 (member_id=?)`

Interpretation:
- SQLite uses the composite index instead of scanning `members`
- the access path is narrower and more selective

## Conclusion

The indexed version reduced average execution time and replaced the full scan with indexed lookup. Even though the absolute timing difference is small on this dataset, the query plan improvement is clear and is expected to matter more as table size grows.

## Files

- benchmark script: `reports/index_benchmark.py`
- generated chart: `reports/index_benchmark.png`
- schema: `sql/schema.sql`
- indexes: `sql/indexes.sql`

## Final Submission Note

Add your demo video link here if your instructor expects the optimization report to include it.
