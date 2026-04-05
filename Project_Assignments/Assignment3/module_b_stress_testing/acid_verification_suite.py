"""
module_b_stress_testing/acid_verification_suite.py
====================================================
Module B - Comprehensive ACID Verification Suite
==================================================
Runs all ACID property checks in one place, referencing the Module A engine.
Serves as the definitive "does everything work?" script.

Output:
  Prints pass/fail for each ACID property
  Saves results/acid_verification_suite_results.json

Usage:
    python module_b_stress_testing/acid_verification_suite.py
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


def _db(label: str) -> TransactionalDatabaseManager:
    wal = LOGS_DIR / f"acid_suite_{label}.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


# -------------------------------------------------------------------------
# ATOMICITY
# -------------------------------------------------------------------------

def verify_atomicity() -> dict:
    """A multi-table transaction that is not committed must leave no trace."""
    db = _db("atomicity")

    tx = db.begin()
    tx.insert("vaults", 100, {"outer_token": "A_OUTER", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 200,
        {"vault_id": 100, "token_type": "MAIN", "token_hash": "a", "status": "ACTIVE"},
    )
    tx.insert(
        "files", 300,
        {
            "vault_id": 100, "inner_token_id": 200,
            "file_size": 64, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    # Simulate crash: recover from WAL without committing
    wal_path = LOGS_DIR / "acid_suite_atomicity.log"
    recovered = TransactionalDatabaseManager(wal_path)
    for t in ALL_TABLES:
        if t not in recovered.db.tables:
            recovered.create_table(t)

    passed = (
        recovered.get_table("vaults").select(100) is None
        and recovered.get_table("inner_tokens").select(200) is None
        and recovered.get_table("files").select(300) is None
    )
    return {"property": "Atomicity", "passed": passed,
            "description": "Uncommitted 3-table txn leaves no rows after WAL recovery"}


# -------------------------------------------------------------------------
# CONSISTENCY
# -------------------------------------------------------------------------

def verify_consistency() -> dict:
    """FK violations and schema violations must be rejected at commit time."""
    db = _db("consistency")

    # Attempt 1: negative file_size
    tx1 = db.begin()
    tx1_ok = True
    tx1.insert("vaults", 1, {"outer_token": "C_OUTER", "status": "ACTIVE"})
    tx1_ok2 = True
    tx1.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "c", "status": "ACTIVE"},
    )
    tx1.insert(
        "files", 1001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": -1, "status": "ACTIVE",   # INVALID
            "download_count": 0, "max_downloads": 1,
        },
    )
    schema_rejected = False
    try:
        db.commit(tx1)
    except ValueError:
        schema_rejected = True

    # Attempt 2: FK violation
    tx2 = db.begin()
    tx2.insert("vaults", 1, {"outer_token": "C_OUTER", "status": "ACTIVE"})
    tx2.insert(
        "inner_tokens", 101,
        {"vault_id": 9999, "token_type": "MAIN", "token_hash": "c2", "status": "ACTIVE"},   # MISSING FK
    )
    fk_rejected = False
    try:
        db.commit(tx2)
    except ValueError:
        fk_rejected = True

    passed = schema_rejected and fk_rejected
    return {
        "property": "Consistency",
        "passed": passed,
        "description": "Negative file_size and missing FK both rejected",
        "schema_rejected": schema_rejected,
        "fk_rejected": fk_rejected,
    }


# -------------------------------------------------------------------------
# ISOLATION
# -------------------------------------------------------------------------

def verify_isolation() -> dict:
    """Concurrent inserts must not corrupt state; no lost updates."""
    db = _db("isolation")

    # Seed vault + token
    seed = db.begin()
    seed.insert("vaults", 1, {"outer_token": "I_OUTER", "status": "ACTIVE"})
    seed.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "i", "status": "ACTIVE"},
    )
    seed.insert(
        "files", 555,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 1, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 9999,
        },
    )
    db.commit(seed)

    n = 30
    errors: list = []
    lock = threading.Lock()

    def increment() -> None:
        try:
            tx = db.begin()
            rec = db.get_table("files").select(555)
            tx.update("files", 555, {**rec, "download_count": rec["download_count"] + 1})
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

    return {
        "property": "Isolation",
        "passed": passed,
        "description": f"{n} concurrent counter increments -> final_count must = {n}",
        "final_count": final_count,
        "expected": n,
        "errors": errors[:3],
    }


# -------------------------------------------------------------------------
# DURABILITY
# -------------------------------------------------------------------------

def verify_durability() -> dict:
    """Committed data must survive re-instantiation from WAL."""
    wal_path = LOGS_DIR / "acid_suite_durability.log"
    wal_path.write_text("", encoding="utf-8")

    db = TransactionalDatabaseManager(wal_path)
    for t in ALL_TABLES:
        db.create_table(t)

    tx = db.begin()
    tx.insert("vaults", 888, {"outer_token": "DUR_OUTER", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 8801,
        {"vault_id": 888, "token_type": "MAIN", "token_hash": "d", "status": "ACTIVE"},
    )
    db.commit(tx)

    # Simulate crash + restart
    recovered = TransactionalDatabaseManager(wal_path)
    for t in ALL_TABLES:
        if t not in recovered.db.tables:
            recovered.create_table(t)

    v = recovered.get_table("vaults").select(888)
    tok = recovered.get_table("inner_tokens").select(8801)

    passed = v is not None and tok is not None
    return {
        "property": "Durability",
        "passed": passed,
        "description": "Committed vault+token survive WAL re-instantiation",
        "vault_888_found": v is not None,
        "token_8801_found": tok is not None,
    }


# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("MODULE B: COMPREHENSIVE ACID VERIFICATION SUITE")
    print("=" * 60)

    checks = [
        verify_atomicity,
        verify_consistency,
        verify_isolation,
        verify_durability,
    ]

    results = []
    for fn in checks:
        r = fn()
        results.append(r)
        icon = "PASS" if r["passed"] else "FAIL"
        print(f"\n[ACID] {r['property']}: {icon}")
        print(f"       {r['description']}")

    all_passed = all(r["passed"] for r in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("[ACID Suite] ALL ACID PROPERTIES VERIFIED [PASS]")
    else:
        print("[ACID Suite] SOME PROPERTIES FAILED [FAIL]")
    print("=" * 60)

    out = RESULTS_DIR / "acid_verification_suite_results.json"
    out.write_text(
        json.dumps({"suite": "acid_verification", "passed": all_passed, "checks": results}, indent=2),
        encoding="utf-8",
    )
    print(f"\n[ACID Suite] Results saved to {out}")


if __name__ == "__main__":
    main()


