"""
experiments/experiment_1_atomicity.py
======================================
EXPERIMENT 1: Atomicity Validation
====================================

Scenario A – Crash before commit (uncommitted = roll back on restart)
----------------------------------------------------------------------
  1. Begin a multi-table transaction (vault + inner_token + file).
  2. Simulate a hard crash by NOT calling commit().
  3. Reconstruct the DB from WAL (simulates restart).
  4. Verify: all three tables are empty (no partial writes persisted).

Scenario B – Explicit rollback across 7 relations
--------------------------------------------------
  1. Seed the DB with a base vault + token.
  2. Begin a transaction that inserts into 4 more tables + updates a token.
  3. Explicitly call rollback().
  4. Verify: all staged changes vanished, original data unchanged.

Expected output:
  [ATOMICITY] Scenario A: PASS – no partial writes after simulated crash
  [ATOMICITY] Scenario B: PASS – explicit rollback restored original state
  [ATOMICITY] ALL SCENARIOS PASSED [PASS]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make the project root importable
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


def _fresh_db(label: str) -> tuple[TransactionalDatabaseManager, Path]:
    """Reset WAL and return a clean DB with all 7 tables."""
    wal = LOGS_DIR / f"exp1_{label}.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db, wal


# ---------------------------------------------------------------------------
# Scenario A: Crash before commit
# ---------------------------------------------------------------------------

def scenario_a_crash_before_commit() -> dict:
    """
    Start a multi-table transaction but never commit.
    Simulate restart by reading the same WAL into a new DB instance.
    Incomplete transactions must be discarded.
    """
    print("\n[ATOMICITY] Scenario A: crash before commit...")
    db, wal_path = _fresh_db("scenario_a")

    # Stage operations across 3 tables (= minimum required by assignment)
    tx = db.begin()
    tx.insert("vaults", 100, {"outer_token": "CRASH_VAULT", "status": "ACTIVE"})
    tx.insert(
        "inner_tokens", 200,
        {"vault_id": 100, "token_type": "MAIN", "token_hash": "x", "status": "ACTIVE"},
    )
    tx.insert(
        "files", 300,
        {
            "vault_id": 100, "inner_token_id": 200,
            "file_size": 512, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    # <<< SIMULATED CRASH: no commit >>>
    # In a real crash test we would call os._exit(1) here and use a subprocess.
    # For in-process demonstration we abandon the transaction and reconstruct
    # from WAL, which faithfully replicates WAL-based recovery behaviour.
    print("[ATOMICITY]   [CRASH SIMULATION] Transaction aborted without commit")

    # Simulate restart: open the same WAL -> recovery discards BEGIN-without-COMMIT
    recovered = TransactionalDatabaseManager(wal_path)
    for t in ALL_TABLES:
        if t not in recovered.db.tables:
            recovered.create_table(t)

    # Verify no data leaked
    vault_found = recovered.get_table("vaults").select(100)
    token_found = recovered.get_table("inner_tokens").select(200)
    file_found = recovered.get_table("files").select(300)

    passed = vault_found is None and token_found is None and file_found is None

    print(f"[ATOMICITY]   vaults[100]      = {vault_found}  (expected None)")
    print(f"[ATOMICITY]   inner_tokens[200] = {token_found}  (expected None)")
    print(f"[ATOMICITY]   files[300]        = {file_found}  (expected None)")
    print(f"[ATOMICITY]   Scenario A: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")

    return {
        "scenario": "A – crash before commit (3 tables)",
        "passed": passed,
        "vault_after_recovery": vault_found,
        "token_after_recovery": token_found,
        "file_after_recovery": file_found,
    }


# ---------------------------------------------------------------------------
# Scenario B: Explicit rollback across 7 relations
# ---------------------------------------------------------------------------

def scenario_b_explicit_rollback() -> dict:
    """
    Seed a vault + token, then start a cross-7-table transaction and roll it
    back. Original data must be intact; staged inserts must vanish.
    """
    print("\n[ATOMICITY] Scenario B: explicit rollback across 7 relations...")
    db, _ = _fresh_db("scenario_b")

    # Seed base data
    seed_tx = db.begin()
    seed_tx.insert("vaults", 1, {"outer_token": "BASE_VAULT", "status": "ACTIVE"})
    seed_tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "seed_hash", "status": "ACTIVE"},
    )
    seed_tx.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "test-agent"})
    db.commit(seed_tx)

    # Multi-table transaction that will be rolled back
    tx = db.begin()
    tx.insert(
        "files", 1001,
        {
            "vault_id": 1, "inner_token_id": 101,
            "file_size": 256, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    tx.insert(
        "portfolio_entries", 9001,
        {
            "vault_id": 1, "owner_token_id": 101, "created_by_token_id": 101,
            "title": "Rollback Entry", "content": "should not persist", "status": "ACTIVE",
        },
    )
    # Mutate the base token type
    tx.update("inner_tokens", 101,
              {"vault_id": 1, "token_type": "SUB", "token_hash": "seed_hash", "status": "ACTIVE"})

    # <<<  ROLLBACK  >>>
    db.rollback(tx)
    print("[ATOMICITY]   Explicit rollback called.")

    # Verify staged inserts vanished
    file_after = db.get_table("files").select(1001)
    log_after = db.get_table("download_logs").select(7001)
    job_after = db.get_table("expiry_jobs").select(8001)
    pe_after = db.get_table("portfolio_entries").select(9001)
    token_type_after = (db.get_table("inner_tokens").select(101) or {}).get("token_type")

    passed = (
        file_after is None
        and log_after is None
        and job_after is None
        and pe_after is None
        and token_type_after == "MAIN"   # Must be original value, not "SUB"
    )

    print(f"[ATOMICITY]   files[1001]            = {file_after}  (expected None)")
    print(f"[ATOMICITY]   download_logs[7001]     = {log_after}  (expected None)")
    print(f"[ATOMICITY]   expiry_jobs[8001]       = {job_after}  (expected None)")
    print(f"[ATOMICITY]   portfolio_entries[9001] = {pe_after}  (expected None)")
    print(f"[ATOMICITY]   inner_tokens[101].type  = {token_type_after!r}  (expected 'MAIN')")
    print(f"[ATOMICITY]   Scenario B: {'PASS [PASS]' if passed else 'FAIL [FAIL]'}")

    return {
        "scenario": "B – explicit rollback (7 relations)",
        "passed": passed,
        "file_after_rollback": file_after,
        "log_after_rollback": log_after,
        "job_after_rollback": job_after,
        "pe_after_rollback": pe_after,
        "token_type_after_rollback": token_type_after,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("EXPERIMENT 1: ATOMICITY VALIDATION")
    print("=" * 60)

    results = []
    results.append(scenario_a_crash_before_commit())
    results.append(scenario_b_explicit_rollback())

    all_passed = all(r["passed"] for r in results)

    print("\n" + "=" * 60)
    if all_passed:
        print("[ATOMICITY] ALL SCENARIOS PASSED [PASS]")
    else:
        print("[ATOMICITY] [FAIL] SOME SCENARIOS FAILED — see details above")
    print("=" * 60)

    out = RESULTS_DIR / "atomicity_test_results.json"
    out.write_text(
        json.dumps({"experiment": "atomicity", "passed": all_passed, "scenarios": results}, indent=2),
        encoding="utf-8",
    )
    print(f"\n[ATOMICITY] Results saved to {out}")


if __name__ == "__main__":
    main()
