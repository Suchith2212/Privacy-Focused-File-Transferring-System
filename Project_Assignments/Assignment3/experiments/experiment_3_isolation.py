"""
experiments/experiment_3_isolation.py
=======================================
EXPERIMENT 3: Isolation Validation
=====================================

Isolation prevents concurrent transactions from corrupting each other's view
of shared data. Our engine uses a serialised global lock (2PL-equivalent in
single-writer mode) to guarantee this property.

Scenarios:
  A – 20 concurrent file inserts -> all 20 rows present, zero duplicates
  B – No dirty reads: uncommitted writes invisible to concurrent readers
  C – No lost updates: 50 concurrent counter increments -> final count = 50

Expected output:
  [ISOLATION] Scenario A: PASS – 20 rows inserted, 0 lost
  [ISOLATION] Scenario B: PASS – uncommitted write not visible to reader
  [ISOLATION] Scenario C: PASS – final counter = 50 (no lost updates)
  [ISOLATION] ALL SCENARIOS PASSED [PASS]
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

_A3_ROOT = Path(__file__).resolve().parents[1]
_ENGINE_ROOT = _A3_ROOT / "module_a"
for _p in (_A3_ROOT, _ENGINE_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from engine.transactional_db import TransactionalDatabaseManager  # noqa: E402

RESULTS_DIR = _A3_ROOT / "results"
LOGS_DIR = _A3_ROOT / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

ALL_TABLES = [
    "vaults", "inner_tokens", "files",
    "sessions", "download_logs", "expiry_jobs", "portfolio_entries",
]


def _fresh_db(label: str) -> TransactionalDatabaseManager:
    wal = LOGS_DIR / f"exp3_{label}.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


def _seed_base(db: TransactionalDatabaseManager) -> None:
    if db.get_table("vaults").select(1) is not None:
        return
    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "ISO_OUTER", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "iso_hash", "status": "ACTIVE"},
    )
    db.commit(tx)


# ---------------------------------------------------------------------------
# Scenario A: Concurrent file inserts – no lost writes
# ---------------------------------------------------------------------------

def scenario_a_concurrent_inserts() -> dict:
    print("\n[ISOLATION] Scenario A: 20 concurrent file inserts...")
    db = _fresh_db("scenario_a")
    _seed_base(db)

    n = 20
    errors: list[str] = []
    lock = threading.Lock()

    def worker(i: int) -> None:
        try:
            tx = db.begin()
            tx.insert(
                "files", 2000 + i,
                {
                    "vault_id": 1, "inner_token_id": 101,
                    "file_size": (i + 1) * 100, "status": "ACTIVE",
                    "download_count": 0, "max_downloads": 1,
                },
            )
            db.commit(tx)
        except Exception as e:
            with lock:
                errors.append(str(e))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    rows = db.get_table("files").all_rows()
    passed = len(rows) == n and not errors

    print(f"[ISOLATION]   Inserted rows: {len(rows)} / {n}")
    if errors:
        print(f"[ISOLATION]   Errors: {errors[:3]}")
    print(f"[ISOLATION]   Scenario A: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")

    return {
        "scenario": "A – 20 concurrent file inserts",
        "passed": passed,
        "inserted": len(rows),
        "expected": n,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Scenario B: No dirty reads
# ---------------------------------------------------------------------------

def scenario_b_no_dirty_read() -> dict:
    """
    A transaction stages an insert but does not commit yet.
    An external (non-transactional) reader must see None, not the dirty value.
    """
    print("\n[ISOLATION] Scenario B: no dirty reads...")
    db = _fresh_db("scenario_b")
    _seed_base(db)

    # Open a transaction but do NOT commit yet
    tx = db.begin()
    tx.insert("vaults", 99, {"outer_token": "DIRTY_V", "status": "ACTIVE"})

    # ReadOnlyTableView reads the committed B+ Tree snapshot, not the staging buffer
    value_during_txn = db.get_table("vaults").select(99)

    db.commit(tx)   # Now commit

    value_after_commit = db.get_table("vaults").select(99)
    passed = value_during_txn is None and value_after_commit is not None

    print(f"[ISOLATION]   vaults[99] during txn  = {value_during_txn}  (expected None)")
    print(f"[ISOLATION]   vaults[99] after commit = {value_after_commit is not None}  (expected True)")
    print(f"[ISOLATION]   Scenario B: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")

    return {
        "scenario": "B – no dirty reads",
        "passed": passed,
        "read_during_txn": value_during_txn,
        "read_after_commit": value_after_commit,
    }


# ---------------------------------------------------------------------------
# Scenario C: No lost updates (counter increment under concurrency)
# ---------------------------------------------------------------------------

def scenario_c_no_lost_updates() -> dict:
    """
    50 threads each read the same counter, increment it, and commit.
    Serialised locking ensures each increment is visible to the next writer.
    Final value must equal 50.
    """
    print("\n[ISOLATION] Scenario C: 50 concurrent counter increments (no lost updates)...")
    db = _fresh_db("scenario_c")
    _seed_base(db)

    # Seed file with download_count = 0 (our counter field)
    init_tx = db.begin()
    init_tx.insert(
        "files", 555,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 1, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 9999,
        },
    )
    db.commit(init_tx)

    n = 50
    errors: list[str] = []
    lock = threading.Lock()

    def increment() -> None:
        try:
            tx = db.begin()
            rec = db.get_table("files").select(555)
            new_count = rec["download_count"] + 1
            tx.update("files", 555, {**rec, "download_count": new_count})
            db.commit(tx)
        except Exception as e:
            with lock:
                errors.append(str(e))

    threads = [threading.Thread(target=increment) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    final = db.get_table("files").select(555)
    final_count = final["download_count"] if final else -1
    passed = final_count == n and not errors

    print(f"[ISOLATION]   Final download_count = {final_count}  (expected {n})")
    if errors:
        print(f"[ISOLATION]   Errors so far: {errors[:3]}")
    print(f"[ISOLATION]   Scenario C: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")

    return {
        "scenario": f"C – {n} concurrent counter increments (no lost updates)",
        "passed": passed,
        "final_count": final_count,
        "expected": n,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("EXPERIMENT 3: ISOLATION VALIDATION")
    print("=" * 60)

    results = []
    results.append(scenario_a_concurrent_inserts())
    results.append(scenario_b_no_dirty_read())
    results.append(scenario_c_no_lost_updates())

    all_passed = all(r["passed"] for r in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("[ISOLATION] ALL SCENARIOS PASSED [PASS]")
    else:
        print("[ISOLATION] [FAIL] SOME SCENARIOS FAILED — see details above")
    print("=" * 60)

    out = RESULTS_DIR / "isolation_test_results.json"
    out.write_text(
        json.dumps({"experiment": "isolation", "passed": all_passed, "scenarios": results}, indent=2),
        encoding="utf-8",
    )
    print(f"\n[ISOLATION] Results saved to {out}")


if __name__ == "__main__":
    main()
