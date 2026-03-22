# Assignment 3: ACID Testing for BlindDrop + Custom B+ Tree

## A. Assignment Intent
Validate transaction correctness under realistic concurrency and failure conditions, specifically for:
1. Relational DB state
2. Custom B+ Tree state
3. Cross-layer consistency between both

## B. Test Philosophy
This assignment is not only about passing SQL checks. It must prove:
1. No partial state leaks to users
2. Security invariants remain intact under load
3. Crash/restart never corrupts authority or index parity

## C. Preconditions
1. Deterministic seed dataset loaded
2. Assignment 2 application flows and index integration available
3. Test harness supports concurrent clients and fault injection
4. Logging enabled for transaction IDs and index mutation IDs

## D. Invariants to Protect
1. Successful download implies file status is `DELETED`
2. Downloaded file has no valid wrapped key path for future access
3. No vault has more than one `MAIN` token
4. No file/token access mapping crosses vault boundaries
5. Failed transaction leaves both DB and B+ Tree unchanged
6. Committed transaction survives restart/crash

## E. ACID Test Matrix
## E1. Atomicity
1. `A1 Upload rollback after partial write`
   - Fault: fail after `files` insert, before `file_metadata` + index update
   - Expected: no persistent row in `files`, no metadata, no index key
2. `A2 Download rollback during revocation`
   - Fault: fail after status update, before key access deletion
   - Expected: entire operation undone; file remains `ACTIVE`

## E2. Consistency
1. `C1 Duplicate MAIN token attempt`
   - Action: parallel insert of two MAIN tokens for same vault
   - Expected: exactly one success, one rejection
2. `C2 Cross-vault mapping attempt`
   - Action: map token from vault A to file in vault B
   - Expected: rejection by validation/constraint
3. `C3 State transition correctness`
   - Action: attempt `DELETED -> ACTIVE`
   - Expected: blocked as invalid transition

## E3. Isolation
1. `I1 Parallel auth attempts`
   - Action: 100 concurrent verifications on same vault
   - Expected: no dirty reads, correct attempt counters
2. `I2 Double-download race`
   - Action: two sessions request same file simultaneously
   - Expected: only one success, one deterministic conflict/failure
3. `I3 Expiry vs download race`
   - Action: expiry worker and download hit same vault
   - Expected: serializable business result, no split-brain state

## E4. Durability
1. `D1 Commit then controlled crash`
   - Action: commit download, kill process, restart
   - Expected: `DELETED` state and logs persist
2. `D2 Uncommitted crash`
   - Action: crash before commit
   - Expected: no user-visible changes after recovery
3. `D3 Index durability`
   - Action: commit index mutation then restart
   - Expected: key search returns committed result

## F. Workload Profiles
1. Upload-heavy profile
   - 50 parallel uploads across 10 vaults
2. Auth-heavy profile
   - 500 token checks/minute with mixed valid/invalid tokens
3. Conflict-heavy profile
   - repeated same-file download contention
4. Mixed profile
   - auth + download + expiry worker running together

## G. Execution Protocol
1. Capture baseline snapshot (DB + index stats)
2. Execute one test case
3. Inject fault (when applicable)
4. Capture final snapshot
5. Validate invariants with SQL + index inspection
6. Store pass/fail record with evidence IDs

## H. Verification Queries (Core)
1. One-time download status
```sql
SELECT file_id, status, deleted_at
FROM files
WHERE file_id = :file_id;
```

2. Wrapped key revocation check
```sql
SELECT COUNT(*) AS key_access_count
FROM file_key_access
WHERE file_id = :file_id;
```

3. MAIN token uniqueness
```sql
SELECT vault_id, COUNT(*) AS main_count
FROM inner_tokens
WHERE token_type = 'MAIN'
GROUP BY vault_id
HAVING COUNT(*) > 1;
```

4. Cross-vault mapping integrity
```sql
SELECT f.file_id, f.vault_id AS file_vault, t.vault_id AS token_vault
FROM file_key_access a
JOIN files f ON f.file_id = a.file_id
JOIN inner_tokens t ON t.inner_token_id = a.inner_token_id
WHERE f.vault_id <> t.vault_id;
```

## I. Result Reporting Template
For each case, report:
1. Case ID
2. Input workload
3. Fault injection point
4. Observed DB state
5. Observed B+ Tree state
6. Verdict (`PASS`/`FAIL`)
7. Root cause notes (if fail)

## J. Pass/Fail Gate
Assignment passes only if:
1. Zero invariant violations in all ACID suites
2. No DB-index divergence after restart tests
3. Conflict tests produce deterministic, safe outcomes
4. Durability tests preserve only committed effects

## K. Viva Demonstration Plan
1. Live race test for double download
2. Live rollback test with injected exception
3. Crash-and-restart durability proof
4. SQL and B+ Tree parity proof after each test

## L. Deliverables Mapping
1. ACID test matrix: sections E and F
2. Execution plan: section G
3. Validation evidence model: sections H and I
4. Acceptance rubric: section J
