"""
experiments/experiment_4_durability.py
=========================================
EXPERIMENT 4: Durability Validation
======================================

Once a COMMIT record is written to the WAL (fsync'd to disk), the data must
survive any subsequent crash or restart. We simulate this by:

  1. Committing several transactions spanning all 7 relations.
  2. Reconstructing the DB from the same WAL (simulates restart).
  3. Verifying every committed row is present in the recovered state.

We also test the complementary property: an uncommitted transaction that
follows the committed ones must NOT appear after recovery.

Expected output:
  [DURABILITY] Committed rows after WAL recovery: 7/7 [PASS]
  [DURABILITY] Uncommitted row after WAL recovery: None [PASS] (not persisted)
  [DURABILITY] ALL SCENARIOS PASSED [PASS]
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


def _init_db(wal_path: Path) -> TransactionalDatabaseManager:
    db = TransactionalDatabaseManager(wal_path)
    for t in ALL_TABLES:
        if t not in db.db.tables:
            db.create_table(t)
    return db


def main() -> None:
    print("=" * 60)
    print("EXPERIMENT 4: DURABILITY VALIDATION")
    print("=" * 60)

    wal_path = LOGS_DIR / "exp4_durability.log"
    wal_path.write_text("", encoding="utf-8")  # Fresh WAL

    # -----------------------------------------------------------------------
    # Phase 1: Commit three sequential transactions spanning all 7 tables
    # -----------------------------------------------------------------------
    print("\n[DURABILITY] Phase 1: Committing transactions to WAL...")
    db = _init_db(wal_path)

    t1 = db.begin()
    t1.insert("vaults", 10, {"outer_token": "DUR_OUTER_10", "status": "ACTIVE"})
    db.commit(t1)
    print("[DURABILITY]   Committed T1: vaults[10]")

    t2 = db.begin()
    t2.insert(
        "inner_tokens", 1010,
        {"vault_id": 10, "token_type": "MAIN", "token_hash": "dur_h", "status": "ACTIVE"},
    )
    db.commit(t2)
    print("[DURABILITY]   Committed T2: inner_tokens[1010]")

    t3 = db.begin()
    t3.insert("sessions", 5010, {"ip_address": "192.168.1.1", "user_agent": "durability-test"})
    t3.insert(
        "files", 10010,
        {
            "vault_id": 10, "inner_token_id": 1010,
            "file_size": 8192, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    t3.insert("download_logs", 70010, {"file_id": 10010, "inner_token_id": 1010, "session_id": 5010})
    t3.insert("expiry_jobs", 80010, {"vault_id": 10, "processed": False})
    t3.insert(
        "portfolio_entries", 90010,
        {
            "vault_id": 10, "owner_token_id": 1010, "created_by_token_id": 1010,
            "title": "Durability Portfolio", "content": "persisted", "status": "ACTIVE",
        },
    )
    db.commit(t3)
    print("[DURABILITY]   Committed T3: sessions, files, download_logs, expiry_jobs, portfolio_entries")

    # Start T4 but do NOT commit – simulates crash during a transaction
    t4 = db.begin()
    t4.insert("vaults", 99, {"outer_token": "SHOULD_NOT_SURVIVE", "status": "ACTIVE"})
    print("[DURABILITY]   T4 staged but NOT committed (simulates crash)")
    # No commit call here – simulates a crash mid-transaction

    # -----------------------------------------------------------------------
    # Phase 2: Simulate restart – reconstruct from the same WAL file
    # -----------------------------------------------------------------------
    print("\n[DURABILITY] Phase 2: Simulating restart from WAL...")
    recovered = _init_db(wal_path)  # Recovery runs automatically in __init__

    # Verify committed data survives
    checks = {
        "vaults[10]":               recovered.get_table("vaults").select(10),
        "inner_tokens[1010]":       recovered.get_table("inner_tokens").select(1010),
        "sessions[5010]":           recovered.get_table("sessions").select(5010),
        "files[10010]":             recovered.get_table("files").select(10010),
        "download_logs[70010]":     recovered.get_table("download_logs").select(70010),
        "expiry_jobs[80010]":       recovered.get_table("expiry_jobs").select(80010),
        "portfolio_entries[90010]": recovered.get_table("portfolio_entries").select(90010),
    }
    uncommitted_vault = recovered.get_table("vaults").select(99)

    committed_ok = all(v is not None for v in checks.values())
    uncommitted_ok = uncommitted_vault is None

    all_passed = committed_ok and uncommitted_ok

    print("\n[DURABILITY] Committed data after recovery:")
    for k, v in checks.items():
        status = "[PASS] present" if v else "[FAIL] MISSING"
        print(f"  {k}: {status}")

    print(f"\n[DURABILITY] Uncommitted vault[99] = {uncommitted_vault}  (expected None) {'[PASS]' if uncommitted_ok else '[FAIL]'}")
    print(f"\n[DURABILITY] Committed rows ok: {committed_ok}")
    print(f"[DURABILITY] Uncommitted row discarded: {uncommitted_ok}")

    print("\n" + "=" * 60)
    if all_passed:
        print("[DURABILITY] ALL SCENARIOS PASSED [PASS]")
    else:
        print("[DURABILITY] [FAIL] SOME SCENARIOS FAILED — see details above")
    print("=" * 60)

    result = {
        "experiment": "durability",
        "passed": all_passed,
        "committed_ok": committed_ok,
        "uncommitted_discarded": uncommitted_ok,
        "row_checks": {k: (v is not None) for k, v in checks.items()},
        "uncommitted_vault_after_recovery": uncommitted_vault,
    }

    out = RESULTS_DIR / "durability_test_results.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\n[DURABILITY] Results saved to {out}")


if __name__ == "__main__":
    main()
