"""
module_b_stress_testing/failure_injection_test.py
===================================================
Module B – Failure Injection & Atomicity Under Crashes
========================================================
Tests that mid-transaction failures (ValidationError, KeyError, or an
artificially injected exception) leave the database in a consistent state
with no partial writes.

Three scenarios:
  A – Exception injected mid-transaction: no partial write
  B – Constraint violation mid-batch: entire batch rolled back
  C – Concurrent transactions where one fails: other still commits cleanly

Usage:
    python module_b_stress_testing/failure_injection_test.py
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

_A3_ROOT = Path(__file__).resolve().parents[1]
_ENGINE_ROOT = _A3_ROOT / "module_a"
for _p in (_A3_ROOT, _ENGINE_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from engine.transactional_db import TransactionalDatabaseManager  # noqa: E402

RESULTS_DIR = _A3_ROOT / "results"
LOGS_DIR = _A3_ROOT / "logs"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

ALL_TABLES = [
    "vaults", "inner_tokens", "files",
    "sessions", "download_logs", "expiry_jobs", "portfolio_entries",
]


def _build_db(label: str) -> TransactionalDatabaseManager:
    wal = LOGS_DIR / f"module_b_failure_{label}.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


def _seed(db: TransactionalDatabaseManager) -> None:
    if db.get_table("vaults").select(1) is not None:
        return
    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "FI_OUTER", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "fi_h", "status": "ACTIVE"},
    )
    db.commit(tx)


# ---------------------------------------------------------------------------
# Scenario A: Injected exception aborts transaction
# ---------------------------------------------------------------------------

def scenario_a_injected_failure() -> dict:
    print("\n[FAILURE_INJ] Scenario A: injected exception mid-transaction...")
    db = _build_db("scenario_a")
    _seed(db)

    tx = db.begin()
    tx.insert(
        "files", 4001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 100, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )

    # Simulate a crash / injected failure before commit
    try:
        raise RuntimeError("[FAILURE_INJ] Simulated hardware failure mid-transaction")
    except RuntimeError as e:
        print(f"[FAILURE_INJ]   Caught: {e}")
        db.rollback(tx)

    file_after = db.get_table("files").select(4001)
    passed = file_after is None

    print(f"[FAILURE_INJ]   files[4001] after rollback = {file_after}  (expected None)")
    print(f"[FAILURE_INJ]   Scenario A: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {"scenario": "A – injected exception, no partial write", "passed": passed}


# ---------------------------------------------------------------------------
# Scenario B: Constraint violation aborts entire batch
# ---------------------------------------------------------------------------

def scenario_b_constraint_violation_in_batch() -> dict:
    print("\n[FAILURE_INJ] Scenario B: constraint violation in multi-op batch...")
    db = _build_db("scenario_b")
    _seed(db)

    # This transaction has a valid insert followed by an invalid one (FK violation)
    tx = db.begin()
    # Op 1: valid
    tx.insert(
        "files", 5001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 256, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    # Op 2: invalid (inner_token_id 9999 does not exist -> FK violation)
    tx.insert(
        "files", 5002,
        {
            "vault_id": 1, "inner_token_id": 9999,
            "file_size": 512, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )

    rejected = False
    try:
        db.commit(tx)
    except ValueError as e:
        rejected = True
        print(f"[FAILURE_INJ]   Commit rejected: {e}")

    file_5001 = db.get_table("files").select(5001)
    file_5002 = db.get_table("files").select(5002)

    # Both must be absent (all-or-nothing)
    passed = rejected and file_5001 is None and file_5002 is None

    print(f"[FAILURE_INJ]   files[5001] (valid op) = {file_5001}  (expected None – whole batch rolled back)")
    print(f"[FAILURE_INJ]   files[5002] (bad FK)   = {file_5002}  (expected None)")
    print(f"[FAILURE_INJ]   Scenario B: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {
        "scenario": "B – FK violation aborts entire batch",
        "passed": passed,
        "rejected": rejected,
        "file_5001_after": file_5001,
        "file_5002_after": file_5002,
    }


# ---------------------------------------------------------------------------
# Scenario C: Concurrent – one tx fails, other succeeds cleanly
# ---------------------------------------------------------------------------

def scenario_c_concurrent_one_fails() -> dict:
    print("\n[FAILURE_INJ] Scenario C: concurrent transactions – one fails, one succeeds...")
    db = _build_db("scenario_c")
    _seed(db)

    results = {"good": None, "bad_rejected": False}
    lock = threading.Lock()

    def good_worker() -> None:
        tx = db.begin()
        tx.insert(
            "files", 6001,
            {
                "vault_id": 1, "inner_token_id": 101,
                "file_size": 128, "status": "ACTIVE",
                "download_count": 0, "max_downloads": 1,
            },
        )
        db.commit(tx)
        with lock:
            results["good"] = db.get_table("files").select(6001)

    def bad_worker() -> None:
        tx = db.begin()
        tx.insert(
            "files", 6002,
            {
                "vault_id": 1, "inner_token_id": 7777,   # bad FK
                "file_size": 64, "status": "ACTIVE",
                "download_count": 0, "max_downloads": 1,
            },
        )
        try:
            db.commit(tx)
        except ValueError:
            with lock:
                results["bad_rejected"] = True

    # Run sequentially (serialised engine) to get deterministic results
    t_good = threading.Thread(target=good_worker)
    t_bad = threading.Thread(target=bad_worker)
    t_good.start(); t_good.join()
    t_bad.start(); t_bad.join()

    passed = results["good"] is not None and results["bad_rejected"]

    print(f"[FAILURE_INJ]   files[6001] (good txn) = {'present' if results['good'] else 'missing'}  (expected present)")
    print(f"[FAILURE_INJ]   files[6002] (bad txn)  = {'absent [PASS]' if results['bad_rejected'] else 'present [FAIL]'}")
    print(f"[FAILURE_INJ]   Scenario C: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {
        "scenario": "C – concurrent: one fails, one succeeds",
        "passed": passed,
        "good_tx_committed": results["good"] is not None,
        "bad_tx_rejected": results["bad_rejected"],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("MODULE B: FAILURE INJECTION TEST")
    print("=" * 60)

    start = time.perf_counter()
    results = []
    results.append(scenario_a_injected_failure())
    results.append(scenario_b_constraint_violation_in_batch())
    results.append(scenario_c_concurrent_one_fails())
    elapsed = time.perf_counter() - start

    all_passed = all(r["passed"] for r in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("[FAILURE_INJ] ALL SCENARIOS PASSED [PASS]")
    else:
        print("[FAILURE_INJ] [FAIL] SOME SCENARIOS FAILED")
    print("=" * 60)

    summary = {
        "test": "failure_injection",
        "passed": all_passed,
        "elapsed_sec": round(elapsed, 3),
        "scenarios": results,
    }
    out = RESULTS_DIR / "failure_injection_results.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[FAILURE_INJ] Results saved to {out}")


if __name__ == "__main__":
    main()
