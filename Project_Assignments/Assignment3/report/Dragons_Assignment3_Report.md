# Assignment 3 Report -- Transaction Management & ACID Validation

---

## Cover Page

| Field | Value |
|-------|-------|
| **Course** | CS432 -- Database Systems |
| **Assignment** | 3 -- Transaction Management & ACID Validation |
| **Track** | 1 |
| **Team** | Dragons |
| **Members** | Suchith (24110313), Hanook (24110378), Sanjay (24110030), Rohith (24110303), Rahul (24110285) |
| **GitHub** | https://github.com/Suchith2212/Privacy-Focused-File-Transferring-System |
| **Video** | `<enter_video_url_after_recording>` -- see `video/demo_link.txt` |
| **Submission Date** | April 5, 2026 |

---

## 1. Objective

This submission extends the custom B+ Tree database engine built in Assignment 2 with a complete **transaction management layer** satisfying all four ACID properties. The deliverable consists of two modules:

- **Module A** -- `TransactionalDatabaseManager` implementing `BEGIN / COMMIT / ROLLBACK`, Write-Ahead Logging (WAL) with `os.fsync()`, a WAL-based crash recovery algorithm (commit-replay and incomplete-transaction-discard), and schema-plus-FK consistency enforcement, validated across seven project-domain relations.
- **Module B** -- A concurrent workload and stress-testing suite that empirically verifies ACID properties under thread-level contention, mid-commit failure injection, one-time-download race conditions, and 1,000+ operation mixed loads spanning all seven relations.

The engine uses **zero external databases, ORMs, or pre-built transaction libraries**. The only storage backend is the custom B+ Tree from Assignment 2.

---

## 2. Requirement-to-Evidence Matrix

| Requirement | Implementation | Evidence File |
|---|---|---|
| Seven domain relations in B+ Tree storage | `module_a/engine/transactional_db.py` | `results/all_experiments_summary.json` |
| `BEGIN / COMMIT / ROLLBACK` | `TransactionalDatabaseManager` | `module_a/tests/test_acid.py` (16/16 PASS) |
| WAL append with `os.fsync()` | `module_a/engine/wal.py` | `logs/*.log` |
| Crash recovery (WAL commit-replay model) | `_recover_from_wal()` | `results/durability_test_results.json` |
| Schema constraint enforcement | `_validate_row_schema()` | `results/consistency_test_results.json` |
| FK referential integrity checks | `_validate_cross_constraints()` | `results/consistency_test_results.json` |
| Isolation -- no dirty reads | `ReadOnlyTableView` + global `RLock` | `results/isolation_test_results.json` |
| Isolation -- no lost updates, deterministic conflict outcome | Strict 2PL serialization | Test: Isolation (serialized write conflict ordering) |
| Atomicity under mid-commit failure | undo-stack in `_apply_operations_atomically` | Test: Atomicity (mid-commit failure injection rollback) |
| Durability with incomplete tail transaction | WAL recovery discards uncommitted tail | Test: Durability (multiple commits + incomplete tail) |
| Idempotent recovery on repeated restart | WAL replay does not append new records | Test: Recovery (idempotent replay across repeated restarts) |
| WAL bypass is not durable | direct B+ Tree write not logged | Test: Negative path: bypass is not durable and not WAL-logged |
| Concurrent vault creation | `module_b_stress_testing/concurrent_vault_test.py` | `results/concurrent_vault_test.json` |
| Race condition -- one-time download | `module_b_stress_testing/race_condition_download_test.py` | `results/race_condition_engine_result.json` |
| Failure injection -- partial-state absence | `module_b_stress_testing/failure_injection_test.py` | `results/failure_injection_results.json` |
| Throughput & latency at scale | `module_b_stress_testing/stress_test_runner.py` | `results/stress_test_metrics.json` |
| End-to-end grader demo | `run_demo.py` | `results/demo_summary.json` |

---

## 3. Architecture

### 3.1 Storage Layer

Every one of the seven GhostDrop relations is backed by an independent B+ Tree instance (order 4, unchanged from Assignment 2). No external storage engine is used.

```
vaults            -> BPlusTree    sessions          -> BPlusTree
inner_tokens      -> BPlusTree    download_logs     -> BPlusTree
files             -> BPlusTree    expiry_jobs       -> BPlusTree
portfolio_entries -> BPlusTree
```

### 3.2 Transaction Lifecycle

```
begin()    -> acquire RLock -> assign UUID tx_id -> write BEGIN to WAL
tx.op()    -> buffer TxOperation in Transaction -> write OP to WAL
commit()   -> _validate_transaction(ops)  [schema + FK on projected state]
           -> write PREPARE to WAL
           -> _apply_operations_atomically(ops)  [undo-stack on failure]
           -> write COMMIT to WAL -> os.fsync()
           -> release RLock
rollback() -> write ROLLBACK to WAL -> discard buffer -> release RLock
```

If an exception occurs anywhere inside `commit()`, the engine writes `ROLLBACK reason=commit_failed`, replays the undo-stack to restore the prior B+ Tree state, and re-raises the exception.

### 3.3 WAL Record Schema

Each line in `logs/*.log` is one JSON object flushed to disk with `os.fsync()`:

| Record Type | Key Fields | Purpose |
|-------------|------------|---------|
| `SCHEMA` | table, index_type, order | Recreate relation on recovery |
| `BEGIN` | tx_id, ts | Mark transaction boundary |
| `OP` | tx_id, op, table, key, value | Log each staged operation |
| `PREPARE` | tx_id, ts | Pre-commit validation fence |
| `COMMIT` | tx_id, ts | Durable commit marker |
| `ROLLBACK` | tx_id, reason, ts | Abort marker (manual or `commit_failed`) |

### 3.4 Recovery Algorithm

```python
_recover_from_wal():
  pending = {}                         # tx_id -> [TxOperation]
  for record in wal_file:
    SCHEMA   -> recreate_table()
    BEGIN    -> pending[tx_id] = []
    OP       -> pending[tx_id].append(TxOperation(...))
    ROLLBACK -> del pending[tx_id]
    COMMIT   -> ops = pending.pop(tx_id)
                _validate_transaction(ops)        # re-validate at replay
                _apply_operations_atomically(ops) # replay into B+ Trees
  # Remaining entries in `pending` never committed -> silently discarded
```

Recovery never appends new WAL records. The same WAL file can be opened multiple times with identical state reconstruction -- confirmed by the idempotent-replay test (Test 16).

---

## 4. Formal ACID Invariants

The following invariants are enforced by the engine and verified by all 16 Module A tests.

### I-1 -- Atomicity

> **For all transactions T: either all operations in T are durably applied, or none are.**

**Enforcement (normal path):** Operations are buffered in a `Transaction` object. The buffer is never applied to the B+ Trees until `_apply_operations_atomically` succeeds entirely. An undo-stack records the pre-image of every mutation; if any single B+ Tree write fails, all prior writes in the same batch are reversed before the error is re-raised.

**Enforcement (crash path):** The WAL contains a `COMMIT` record only after `_apply_operations_atomically` returns without error. If the process crashes before `COMMIT` is written, `_recover_from_wal` sees only `BEGIN + OP` records for that transaction and discards them.

**Evidence:**
- `Atomicity (crash before commit)` -- vaults[1], inner_tokens[101], files[1001] all absent after WAL recovery.
- `Atomicity (explicit rollback, 7 relations)` -- 4 staged inserts and 1 update all absent; `inner_tokens[101].token_type` reverted to `"MAIN"`.
- `Atomicity (mid-commit failure injection rollback)` -- second operation in a 2-op batch raises `RuntimeError`; both ops absent; WAL contains `ROLLBACK reason=commit_failed` for that `tx_id`.

### I-2 -- Consistency

> **For all transactions T: T commits only if the projected post-commit database state satisfies all declared schema constraints and cross-table referential integrity rules.**

**Enforcement:** `_validate_transaction` builds a full projected state snapshot by replaying all staged operations over the current committed B+ Tree state. It then calls `_validate_row_schema` (field types, required fields, domain enumerations) and `_validate_cross_constraints` (FK checks for all seven relations) against the projected state. Any violation raises `ValueError`, which triggers the commit exception handler to write `ROLLBACK reason=commit_failed` and release the lock without touching the B+ Trees.

**Checked constraints include:**
- `files.file_size >= 0`
- `inner_tokens.vault_id` -> must exist in `vaults`
- `files.inner_token_id` -> must exist in `inner_tokens` within the same vault
- `download_logs.file_id` -> must exist in `files`; `session_id` -> must exist in `sessions`
- `expiry_jobs.vault_id` -> must exist in `vaults`
- `portfolio_entries.owner_token_id` and `created_by_token_id` -> must exist in `inner_tokens` belonging to the same vault

**Evidence:** `consistency_test_results.json -> passed: true` for all four scenarios: negative file size, missing vault FK, missing token FK, and valid 7-relation commit.

### I-3 -- Isolation

> **For all concurrent transactions T1, T2: T1 never observes uncommitted writes of T2, and the committed outcome is equivalent to some serial execution order of T1 and T2.**

**Enforcement:** A single `threading.RLock` is acquired at `begin()` time and held until `commit()` / `rollback()` returns. This implements **Strict Two-Phase Locking (S2PL)** in single-writer mode:
- No other thread can call `begin()` while T1 holds the lock -- no concurrent writers.
- External readers access the database only via `ReadOnlyTableView`, which wraps each read in a `with self._manager._lock` block, ensuring they see only committed B+ Tree state.

**Serialized write conflict ordering (Test 9):** Two sequential transactions T1 and T2 both update `files[1001].file_size`. T1 sets it to 111 then commits. T2 reads the committed row and sets it to 222 then commits. The final value is deterministically 222, not a stale-read overwrite of T1's original value. This confirms the serialization order matches the execution order.

**Evidence:** `isolation_test_results.json -> passed: true` for concurrent inserts (20/20 rows), no-dirty-read, and no-lost-update (final counter = 50). Test 9 additionally confirms `final["file_size"] == 222`.

### I-4 -- Durability

> **For all committed transactions T: the effects of T persist in the database even if the process crashes immediately after commit() returns.**

**Enforcement:** `os.fsync()` is called on the WAL file descriptor inside `WriteAheadLog.append()` after every record write. The `COMMIT` record is the last write before `commit()` releases the lock. On any subsequent startup, `_recover_from_wal()` replays all `COMMIT`-confirmed transactions before the engine accepts new work.

**Durability with incomplete tail (Test 14):** Three transactions T1, T2, T3 each commit. A fourth transaction T4 stages two operations but is never committed. After WAL recovery: T1/T2/T3 rows are all present; T4 rows (`download_logs[7001]`, `expiry_jobs[8001]`) are absent.

**Idempotent replay (Test 16):** After committing T1 and T2, the WAL content is captured as a string. Two independent `TransactionalDatabaseManager` instances recover from the same WAL. Both produce identical state dictionaries. The WAL file is unchanged after both recoveries -- recovery is a pure read with no side effects on the log.

**Evidence:** `durability_test_results.json -> passed: true`; all 7 committed rows present; `uncommitted_vault_after_recovery: null`.

---

## 5. Module A: ACID Test Suite (16/16)

### 5.1 Commands

```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3"
python module_a\smoke_test.py
python module_a\transaction_smoke_test.py
python module_a\tests\test_acid.py
```

### 5.2 All 16 Test Cases

| # | Test Name | ACID Property | Result |
|---|-----------|--------------|--------|
| 1 | Atomicity (crash before commit) | Atomicity | **PASS** |
| 2 | Atomicity (explicit rollback, 7 relations) | Atomicity | **PASS** |
| 3 | Atomicity (mid-commit failure injection rollback) | Atomicity | **PASS** |
| 4 | Consistency (valid references across 7 relations) | Consistency | **PASS** |
| 5 | Consistency (engine rejects negative file size) | Consistency | **PASS** |
| 6 | Consistency (engine rejects missing reference) | Consistency | **PASS** |
| 7 | Isolation (concurrent file inserts) | Isolation | **PASS** |
| 8 | Isolation (no dirty read) | Isolation | **PASS** |
| 9 | Isolation (serialized write conflict ordering) | Isolation | **PASS** |
| 10 | API blocks non-transactional mutations | Isolation / API | **PASS** |
| 11 | Negative path: bypass is not durable and not WAL-logged | Durability / API | **PASS** |
| 12 | Durability (single commit restart) | Durability | **PASS** |
| 13 | Durability (multiple commits restart across 7 relations) | Durability | **PASS** |
| 14 | Durability (multiple commits + incomplete tail) | Durability | **PASS** |
| 15 | Recovery (commit replay + incomplete ignore) | Recovery | **PASS** |
| 16 | Recovery (idempotent replay across repeated restarts) | Recovery | **PASS** |

### 5.3 Observed Output

```text
[PASS] Atomicity (crash before commit)
[PASS] Atomicity (explicit rollback, 7 relations)
[PASS] Consistency (valid references across 7 relations)
[PASS] Consistency (engine rejects negative file size)
[PASS] Consistency (engine rejects missing reference)
[PASS] Isolation (concurrent file inserts)
[PASS] Isolation (no dirty read)
[PASS] Isolation (serialized write conflict ordering)
[PASS] Atomicity (mid-commit failure injection rollback)
[PASS] API blocks non-transactional mutations
[PASS] Negative path: bypass is not durable and not WAL-logged
[PASS] Durability (single commit restart)
[PASS] Durability (multiple commits restart across 7 relations)
[PASS] Durability (multiple commits + incomplete tail)
[PASS] Recovery (commit replay + incomplete ignore)
[PASS] Recovery (idempotent replay across repeated restarts)
[OK] All 16 ACID/recovery checks passed.
[OK] Transaction + WAL + recovery smoke test passed.
[OK] Module A engine baseline smoke test passed.
```

---

## 6. New Tests: Design and Significance

### Test 9 -- Isolation (Serialized Write Conflict Ordering)

**Design:** A single file row (`files[1001].file_size = 10`) is seeded. Transaction T1 reads the row and updates `file_size` to 111 then commits. Transaction T2 reads the now-committed row and updates `file_size` to 222 then commits. The final value is asserted to equal 222.

**Significance:** This tests the deterministic outcome of a write-write conflict. Under a non-serialized system, T2 could overwrite T1's uncommitted intermediate with a stale read, or both could commit against T1's original value, causing a lost update. The S2PL lock guarantees T2 always reads T1's committed state, producing a final value that matches the serialization order exactly.

### Test 3 -- Atomicity (Mid-Commit Failure Injection)

**Design:** A 2-operation transaction (insert `files[1001]`, insert `download_logs[7001]`) is started. `_apply_operation_direct` is monkey-patched to raise `RuntimeError` on the second call -- after the first insert has already been applied to the B+ Tree. `commit()` is called and the exception is caught. The test asserts both rows are absent, and that the WAL contains a `ROLLBACK reason=commit_failed` record for that `tx_id`.

**Significance:** This is the hardest atomicity scenario -- a fault that occurs after partial writes have already reached the storage layer. The undo-stack mechanism must reverse the first insert before re-raising. Without the undo-stack, this would leave a permanently inconsistent B+ Tree state (`files[1001]` present, `download_logs[7001]` absent), which would survive WAL recovery since only committed ops are replayed.

### Test 11 -- WAL Bypass Is Not Durable (Negative-Path Proof)

**Design:** A row is inserted directly into the raw B+ Tree via `db.db.get_table("vaults").insert(999, {...})`, bypassing the transaction manager entirely. The test verifies: (1) the row is visible in the current process, (2) no `OP` record for key 999 exists in the WAL, (3) after constructing a new `TransactionalDatabaseManager` from the same WAL file, `vaults[999]` is absent.

**Significance:** This validates the design contract: the only path to durable storage is through the transactional API. It shows that the `ReadOnlyTableView` boundary is not merely a convention -- bypassing it genuinely destroys durability.

### Test 14 -- Durability with Incomplete Tail

**Design:** Three transactions commit sequentially. A fourth transaction stages two operations but is never committed. Recovery is simulated by constructing a new engine instance from the WAL. T1/T2/T3 rows are all present; T4 rows are absent.

**Significance:** This models the realistic server-crash scenario where the process terminates mid-transaction while earlier committed transactions exist in the same WAL file. The test confirms clean boundary enforcement: committed data survives, and the uncommitted tail is discarded with no corruption.

### Test 16 -- Idempotent Recovery

**Design:** After two committed transactions, the WAL file content is captured as a string. Two independent DB instances recover from the same WAL. Their state dictionaries are asserted equal. The WAL file content after both recoveries equals the captured content before them.

**Significance:** Recovery idempotency is a correctness requirement for any production WAL implementation. This test proves the invariant: WAL recovery is a pure read operation with no side effects on the log, ensuring that repeated restarts produce deterministic state.

---

## 7. Module A: ACID Experiments (1-4)

Run all via:
```powershell
python experiments\run_all_experiments.py
```
Evidence: `results/all_experiments_summary.json -> all_passed: true`

### Experiment 1 -- Atomicity

**Scenario A: Crash before commit (3 tables)**
```
Staged: vaults[100], inner_tokens[200], files[300] -- commit() never called
WAL:    BEGIN + 3 OP records, no PREPARE/COMMIT
Recovery result:
  vaults[100]       = null  (not persisted)
  inner_tokens[200] = null  (not persisted)
  files[300]        = null  (not persisted)
```

**Scenario B: Explicit rollback (7 relations)**
```
Staged: files[1001], download_logs[7001], expiry_jobs[8001],
        portfolio_entries[9001], update inner_tokens[101].token_type -> SUB
db.rollback(tx) called
Result:
  All 4 inserts         = null  (rolled back)
  inner_tokens[101].token_type = "MAIN"  (update reverted)
```

### Experiment 2 -- Consistency

| Scenario | Injected Violation | Engine Response |
|---|---|---|
| A | `files.file_size = -9` | `ValueError` at commit, row absent |
| B | `inner_tokens.vault_id = 9999` (no such vault) | `ValueError` at commit |
| C | `files.inner_token_id = 999` (no such token) | `ValueError` at commit |
| D | Valid 7-relation transaction | All 7 rows committed and readable |

### Experiment 3 -- Isolation

| Scenario | Configuration | Expected | Actual |
|---|---|---|---|
| A: Concurrent inserts | 20 threads x 1 file insert each | 20 rows | 20 rows, 0 errors |
| B: No dirty reads | Read vault[99] during live transaction | null | null during tx; visible after commit |
| C: No lost updates | 50 threads increment shared counter | count = 50 | `final_count: 50`, 0 errors |

### Experiment 4 -- Durability

```
Committed: 3 sequential transactions spanning all 7 relations
Staged (uncommitted): vaults[99]

WAL recovery (new DB instance from same log):
  vaults[10]               -> present
  inner_tokens[1010]       -> present
  sessions[5010]           -> present
  files[10010]             -> present
  download_logs[70010]     -> present
  expiry_jobs[80010]       -> present
  portfolio_entries[90010] -> present
  vaults[99] (uncommitted) -> null  (discarded by recovery)
```

---

## 8. Module B: Concurrent & Stress Validation

### 8.1 Concurrent Vault Creation

```
Script:    module_b_stress_testing/concurrent_vault_test.py --users 20
Workload:  20 concurrent threads, each committing one atomic 3-table transaction

vault_count:  20
token_count:  20
file_count:   20
errors:       0
elapsed:      0.453 s
throughput:   44.19 txn/s
Result:       passed: true
```

### 8.2 Race Condition -- One-Time Download (50 threads)

```
Script:    module_b_stress_testing/race_condition_download_test.py --concurrency 50
Setup:     File with max_downloads=1, download_count=0
Threads:   50 simultaneous download attempts

success_count:        1   (expected 1)
failed_count:         49  (DownloadLimitExceeded)
unexpected_errors:    0
final_download_count: 1
download_log_entries: 1
elapsed:              0.413 s
Result:               passed: true

Pass criteria:
  exactly_one_success:    PASS
  all_others_failed:      PASS
  final_count_is_1:       PASS
  exactly_one_log_entry:  PASS
  no_unexpected_errors:   PASS
```

### 8.3 Failure Injection (3 Scenarios)

```
Script:  module_b_stress_testing/failure_injection_test.py
Elapsed: 0.033 s

Scenario A -- injected RuntimeError mid-transaction:
  files[4001] after rollback = null  (undo-stack reverted first insert)

Scenario B -- FK violation aborts entire batch:
  files[5001] (valid op, same batch) = null  (all-or-nothing)
  files[5002] (invalid FK)           = null

Scenario C -- concurrent: one bad tx, one good tx:
  files[6001] (good tx) = present  (committed cleanly)
  files[6002] (bad FK)  = absent   (rejected at validation)
Result: passed: true
```

### 8.4 Stress Test -- 1,000 Multi-Relation Operations

The stress test workload was upgraded to use **real domain-compliant multi-relation transactions** across all seven tables. Each operation type spans 3-5 relations and maintains full FK integrity.

```
Script:         module_b_stress_testing/stress_test_runner.py --ops 1000 --threads 1
Workload model: multi_relation_transaction_mix
Operations:     1000 across 6 operation types (FK-compliant, all 7 relations)

Operation type distribution (attempted / succeeded):
  bundle_write:     199 / 199  (vault + token + session + file)
  download_event:   218 / 218  (vault + token + session + file update + download_log)
  expire_cycle:     133 / 133  (vault expire + token revoke + expiry_job)
  portfolio_write:  178 / 178  (vault + token + portfolio_entry)
  cleanup:           90 / 90   (multi-table delete path)
  read_path:        182 / 182  (read-only transactional scan)

success_count:     1000  (100.00%)
fail_count:        0
elapsed:           8.981 s
throughput:        111.34 ops/sec

Latency (ms):
  mean   8.974
  p50    8.897
  p95   13.640
  p99   17.096
  max   61.972
```

**Note on throughput:** The previous stress test used single-table vault operations. The revised workload executes full domain transactions spanning 3-5 tables each, which explains the modestly lower throughput (111 vs 142 ops/sec). The 100% success rate across all operation types confirms the engine handles complex FK-interdependent transactions correctly under load.

### 8.5 End-to-End Demo

```
python run_demo.py --quick   (total: 1.63 s)

  PASS  Module A -- B+ Tree Smoke          0.09 s
  PASS  Module A -- ACID Tests (16/16)     0.48 s
  PASS  Module A -- WAL + Recovery Smoke   0.14 s
  PASS  ACID Experiments (1-4)             0.44 s
  PASS  Module B -- Concurrent Vault       0.13 s
  PASS  Module B -- Race Condition         0.11 s
  PASS  Module B -- Failure Injection      0.05 s
  PASS  Module B -- ACID Suite             0.20 s

Overall: passed: true
```

---

## 9. Locking Protocol and Isolation Level

The engine implements **Strict Two-Phase Locking (S2PL)** via a single `threading.RLock`.

| Phase | Action | Guarantee |
|-------|--------|-----------|
| Growing | `begin()` acquires `RLock` | No concurrent transaction can start |
| Active | All writes buffered in `Transaction`; reads via `ReadOnlyTableView` acquire lock per call | Writers do not touch shared state; readers see committed snapshot only |
| Shrinking | `commit()` / `rollback()` releases lock | Next transaction unblocked; lock release is atomic with COMMIT write |

This provides the **Serializable** isolation level -- the strictest defined in ANSI SQL. The practical trade-off is single-writer throughput, which is appropriate for GhostDrop's workload model (one vault per user, one allowed download per file).

Test 16 additionally confirms that WAL recovery does not acquire the transaction lock, is a side-effect-free read pass, and produces deterministic state regardless of restart frequency.

---

## 10. Limitations and Critical Analysis

### 10.1 Throughput Ceiling (Architectural Constraint)

**Observation:** The global `RLock` serializes all write transactions. The revised multi-relation stress test measures **111.34 ops/sec** at 1,000 operations, single thread.

**Root cause:** Strict 2PL requires the lock to be held for the entire transaction duration. This prevents all concurrent writes. Throughput scales linearly with transaction complexity: the revised workload executes 3-5 table operations per transaction vs. the earlier 1-table model.

**Academic context:** Production databases (PostgreSQL, MySQL InnoDB) use **Multi-Version Concurrency Control (MVCC)** -- storing multiple row versions so read transactions can proceed without blocking writers. Implementing MVCC in a B+ Tree requires version chains in leaf nodes and a garbage-collection pass for expired versions. Both are beyond the scope of this assignment and are the primary path to higher concurrency.

**Practical impact:** GhostDrop is a low-concurrency workload by design. 111 ops/sec at full multi-relation complexity is more than adequate for the correctness-first mandate of this assignment.

### 10.2 WAL Unbounded Growth

**Observation:** With `os.fsync()` on every append, the WAL grows without truncation. `module_b_stress.log` reached approximately 430 KB after a single 1,000-operation run under the revised multi-relation workload.

**Root cause:** WAL truncation requires a checkpoint: write a checkpoint marker, persist in-memory index state to disk, then safely truncate the already-replayed log prefix. Since the B+ Trees are entirely in-memory, there is no "dirty page" concept -- a checkpoint would require full B+ Tree serialization to disk, which is deferred as a future extension.

**Mitigation:** Each experiment script resets its WAL to empty before running. Total log volume during a grading session is under 3 MB.

### 10.3 In-Memory B+ Trees (WAL as Sole Persistence Path)

**Observation:** B+ Tree nodes live entirely in RAM. On process exit, all in-memory state is lost; the only persistence channel is the WAL.

**Implication:** Recovery re-replays the full WAL from the beginning on every startup. As WAL size grows, startup latency grows linearly. A production system would require a buffer pool manager with page-level I/O.

**What is done correctly:** The WAL is `fsync`-backed and append-only. Test 16 proves that re-reading the same WAL twice produces identical state with no WAL modifications. Test 14 proves that partial uncommitted writes at the WAL boundary are discarded without corrupting earlier committed data.

### 10.4 No Deadlock Detection (By Design)

With a single global lock, deadlock is structurally impossible -- a deadlock requires two or more locks held in conflicting order by two or more threads. The S2PL single-lock design eliminates the lock-ordering problem entirely.

If the engine were extended to row-level locking (one `RLock` per B+ Tree key), a deadlock cycle would become possible and would require a wait-for graph with DFS cycle detection. This is noted as future work.

### 10.5 Rollback-Only Error Recovery (By Design)

When `_apply_operations_atomically` encounters a mid-commit failure, the undo-stack is replayed and the error is re-raised. The transaction is not automatically retried.

This is intentional: retry policy is a business-logic decision that belongs to the caller. The engine's contract is "do not corrupt the database." All Module B stress tests implement their own retry or skip-and-continue semantics.

---

## 11. Team Contributions

The project was implemented collaboratively with clear ownership by module and artifact type.

| Member | Roll Number | Primary Responsibility | Key Outputs |
|--------|-------------|------------------------|-------------|
| Suchith | 24110313 | Module A core engine integration and final merge ownership | `transactional_db.py`, ACID suite integration, final report consolidation | 
| Hanook | 24110378 | WAL/recovery validation and durability experiments | WAL/recovery test flows, restart verification, log evidence review | evidence folder curation, runbook checks |
| Sanjay | 24110030 | Module B concurrency and race-condition testing | concurrent vault tests, race-condition analysis, load profile evidence | report structuring, demo flow |
| Rohith | 24110303 | Failure-injection and stress benchmarking pipeline | failure scenarios, stress metrics generation, result artifact cleanup | Documentation and reproducibility packaging |
| Rahul | 24110285 | Helped in Documentation 


---

## 12. AI Usage Declaration

AI tools were used as an engineering assistant, not as a replacement for implementation ownership.

Scope of AI assistance:
- Draft refinement for documentation wording and structure.
- Refactoring suggestions for script readability.
- Consistency checks across markdown/report sections.
- Command-level support for repetitive repository hygiene tasks.

owned responsibilities (done by team members):
- Core transaction, WAL, recovery, and locking implementation decisions.
- Test design, execution, debugging, and acceptance criteria.
- Final interpretation of experimental results and grading claims.
- Validation that all reported metrics match generated artifacts.

Quality control policy applied:
- Every AI-assisted change was reviewed and validated by at least one team member.
- No result was accepted without executable verification in this repository.
- Final responsibility for correctness remains entirely with the team.

---

## 13. Reproducibility Commands

```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3"

# Module A: engine baseline
python module_a\smoke_test.py
python module_a\transaction_smoke_test.py

# Module A: 16-test ACID suite
python module_a\tests\test_acid.py

# ACID Experiments (1-4)
python experiments\run_all_experiments.py

# Module B: individual tests
python module_b_stress_testing\concurrent_vault_test.py --users 20
python module_b_stress_testing\race_condition_download_test.py --concurrency 50
python module_b_stress_testing\failure_injection_test.py
python module_b_stress_testing\stress_test_runner.py --ops 1000
python module_b_stress_testing\acid_verification_suite.py

# Full grader demo (quick -- ~1.6 s, skips 1000-op stress)
python run_demo.py --quick

# Full grader demo (includes 1000-op stress -- ~11 s)
python run_demo.py
```

---

## 14. Conclusion

This submission implements and empirically verifies all four ACID properties on a pure-Python, B+ Tree-backed transaction engine with **zero external database dependencies**.

| Property | Primary Mechanism | Verified By |
|----------|------------------|-------------|
| **Atomicity** | WAL + undo-stack; uncommitted ops discarded on crash or rollback | 3 tests: crash, explicit rollback, mid-commit injection |
| **Consistency** | Schema + FK validation on projected batch state at commit time | 3 tests: negative file size, missing vault ref, missing token ref |
| **Isolation** | Strict 2PL via global `RLock`; `ReadOnlyTableView` for non-tx reads | 3 tests: concurrent inserts, no dirty read, deterministic conflict ordering |
| **Durability** | `os.fsync()` on every WAL append; WAL commit-replay on startup | 4 tests: single restart, 7-relation restart, incomplete tail, idempotent replay |

**All 16 Module A test cases pass.** The grader demo (`run_demo.py --quick`) completes all 8 pipeline steps in **1.63 seconds**. The revised multi-relation stress test achieves **111.34 ops/sec at 100% success rate** across 1,000 operations spanning all seven GhostDrop relations. The race condition test enforces the one-time-download invariant correctly under 50 concurrent threads with exactly 1 success and 49 `DownloadLimitExceeded` rejections.

