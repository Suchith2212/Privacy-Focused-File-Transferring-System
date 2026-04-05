"""
experiments/experiment_2_consistency.py
=========================================
EXPERIMENT 2: Consistency Validation
=======================================

The engine enforces two categories of consistency checks at commit time:
  a) Row-level schema checks  (field types, allowed enum values)
  b) Cross-table referential integrity (FK constraints across all 7 relations)

Scenarios:
  A – Negative file_size rejected                  -> ValueError at commit
  B – File with non-existent vault_id rejected      -> ValueError at commit
  C – Token references non-existent vault rejected  -> ValueError at commit
  D – Valid multi-table transaction commits cleanly -> All rows readable

Expected output:
  [CONSISTENCY] Scenario A: PASS – negative file_size rejected
  [CONSISTENCY] Scenario B: PASS – missing vault reference rejected
  [CONSISTENCY] Scenario C: PASS – token missing vault rejected
  [CONSISTENCY] Scenario D: PASS – valid 7-relation transaction committed
  [CONSISTENCY] ALL SCENARIOS PASSED [PASS]
"""

from __future__ import annotations

import json
import sys
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
    wal = LOGS_DIR / f"exp2_{label}.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


def _seed(db: TransactionalDatabaseManager) -> None:
    if db.get_table("vaults").select(1) is not None:
        return
    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "BASE_OUTER", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "h1", "status": "ACTIVE"},
    )
    tx.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "consistency-agent"})
    db.commit(tx)


# ---------------------------------------------------------------------------
# Scenario A: Negative file_size rejected
# ---------------------------------------------------------------------------

def scenario_a_negative_file_size() -> dict:
    print("\n[CONSISTENCY] Scenario A: negative file_size rejection...")
    db = _fresh_db("scenario_a")
    _seed(db)

    tx = db.begin()
    tx.insert(
        "files", 1001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": -500, "status": "ACTIVE",   # ← negative: must be rejected
            "download_count": 0, "max_downloads": 1,
        },
    )

    rejected = False
    try:
        db.commit(tx)
    except ValueError as e:
        rejected = True
        print(f"[CONSISTENCY]   Rejected with: {e}")

    file_after = db.get_table("files").select(1001)
    passed = rejected and file_after is None

    print(f"[CONSISTENCY]   files[1001] after rejected commit = {file_after}  (expected None)")
    print(f"[CONSISTENCY]   Scenario A: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {"scenario": "A – negative file_size rejected", "passed": passed}


# ---------------------------------------------------------------------------
# Scenario B: File with non-existent vault_id rejected
# ---------------------------------------------------------------------------

def scenario_b_missing_vault_reference() -> dict:
    print("\n[CONSISTENCY] Scenario B: missing vault FK rejection...")
    db = _fresh_db("scenario_b")
    # Deliberately do NOT seed a vault – vault 9999 does not exist.

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER_B", "status": "ACTIVE"})
    # inner_token references vault 9999 (does not exist)
    tx.insert(
        "inner_tokens", 200,
        {"vault_id": 9999, "token_type": "MAIN", "token_hash": "h2", "status": "ACTIVE"},
    )

    rejected = False
    try:
        db.commit(tx)
    except ValueError as e:
        rejected = True
        print(f"[CONSISTENCY]   Rejected with: {e}")

    token_after = db.get_table("inner_tokens").select(200)
    passed = rejected and token_after is None

    print(f"[CONSISTENCY]   inner_tokens[200] after rejection = {token_after}  (expected None)")
    print(f"[CONSISTENCY]   Scenario B: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {"scenario": "B – missing vault FK rejected", "passed": passed}


# ---------------------------------------------------------------------------
# Scenario C: File inner_token_id references non-existent token
# ---------------------------------------------------------------------------

def scenario_c_file_missing_token() -> dict:
    print("\n[CONSISTENCY] Scenario C: file referencing missing inner_token rejected...")
    db = _fresh_db("scenario_c")

    # Seed vault only (no inner_token 999)
    tx0 = db.begin()
    tx0.insert("vaults", 1, {"outer_token": "OUTER_C", "status": "ACTIVE"})
    db.commit(tx0)

    tx = db.begin()
    tx.insert(
        "files", 2001,
        {
            "vault_id": 1,
            "inner_token_id": 999,   # ← does not exist
            "file_size": 100, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )

    rejected = False
    try:
        db.commit(tx)
    except ValueError as e:
        rejected = True
        print(f"[CONSISTENCY]   Rejected with: {e}")

    file_after = db.get_table("files").select(2001)
    passed = rejected and file_after is None

    print(f"[CONSISTENCY]   files[2001] after FK violation = {file_after}  (expected None)")
    print(f"[CONSISTENCY]   Scenario C: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {"scenario": "C – file missing token FK rejected", "passed": passed}


# ---------------------------------------------------------------------------
# Scenario D: Valid 7-relation transaction commits cleanly
# ---------------------------------------------------------------------------

def scenario_d_valid_full_commit() -> dict:
    print("\n[CONSISTENCY] Scenario D: valid 7-relation transaction commits cleanly...")
    db = _fresh_db("scenario_d")

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER_D", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "hd", "status": "ACTIVE"},
    )
    tx.insert("sessions", 501, {"ip_address": "10.0.0.1", "user_agent": "dragon-agent"})
    tx.insert(
        "files", 1001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 4096, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    tx.insert(
        "portfolio_entries", 9001,
        {
            "vault_id": 1, "owner_token_id": 101, "created_by_token_id": 101,
            "title": "Consistency Test Entry", "content": "valid", "status": "ACTIVE",
        },
    )
    db.commit(tx)

    # Verify every row is readable
    checks = {
        "vaults[1]":              db.get_table("vaults").select(1),
        "inner_tokens[101]":      db.get_table("inner_tokens").select(101),
        "sessions[501]":          db.get_table("sessions").select(501),
        "files[1001]":            db.get_table("files").select(1001),
        "download_logs[7001]":    db.get_table("download_logs").select(7001),
        "expiry_jobs[8001]":      db.get_table("expiry_jobs").select(8001),
        "portfolio_entries[9001]":db.get_table("portfolio_entries").select(9001),
    }

    passed = all(v is not None for v in checks.values())
    for k, v in checks.items():
        print(f"[CONSISTENCY]   {k}: {'OK' if v else 'MISSING'}")

    print(f"[CONSISTENCY]   Scenario D: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")
    return {"scenario": "D – valid 7-relation commit", "passed": passed}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("EXPERIMENT 2: CONSISTENCY VALIDATION")
    print("=" * 60)

    results = []
    results.append(scenario_a_negative_file_size())
    results.append(scenario_b_missing_vault_reference())
    results.append(scenario_c_file_missing_token())
    results.append(scenario_d_valid_full_commit())

    all_passed = all(r["passed"] for r in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("[CONSISTENCY] ALL SCENARIOS PASSED [PASS]")
    else:
        print("[CONSISTENCY] [FAIL] SOME SCENARIOS FAILED — see details above")
    print("=" * 60)

    out = RESULTS_DIR / "consistency_test_results.json"
    out.write_text(
        json.dumps({"experiment": "consistency", "passed": all_passed, "scenarios": results}, indent=2),
        encoding="utf-8",
    )
    print(f"\n[CONSISTENCY] Results saved to {out}")


if __name__ == "__main__":
    main()
