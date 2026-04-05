"""Assignment 3 Module A ACID verification harness aligned to 7 project-domain tables.

Run:
  python tests/test_acid.py
"""

from __future__ import annotations

from pathlib import Path
from threading import Thread
from datetime import datetime, timezone
import json
import time
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from engine import TransactionalDatabaseManager


RELATIONS = [
    "vaults",
    "inner_tokens",
    "files",
    "sessions",
    "download_logs",
    "expiry_jobs",
    "portfolio_entries",
]


def reset_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")


def init_db(wal_path: Path) -> TransactionalDatabaseManager:
    db = TransactionalDatabaseManager(wal_path)
    for table in RELATIONS:
        db.create_table(table)
    return db


def read_wal_records(wal_path: Path) -> list[dict]:
    lines = [ln for ln in wal_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return [json.loads(ln) for ln in lines]


def seed_base_domain(db: TransactionalDatabaseManager) -> None:
    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    tx.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    tx.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "pytest-agent"})
    db.commit(tx)


def test_atomicity_crash_before_commit(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    tx.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 25, "status": "ACTIVE"})

    recovered = TransactionalDatabaseManager(wal_path)
    assert recovered.get_table("vaults").select(1) is None
    assert recovered.get_table("inner_tokens").select(101) is None
    assert recovered.get_table("files").select(1001) is None


def test_atomicity_explicit_rollback_across_7_relations(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    tx = db.begin()
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 50, "status": "ACTIVE"})
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    tx.insert(
        "portfolio_entries",
        9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Entry A",
            "content": "data",
            "status": "ACTIVE",
        },
    )
    tx.update("inner_tokens", 101, {"vault_id": 1, "token_type": "SUB", "status": "ACTIVE"})
    db.rollback(tx)

    assert db.get_table("files").select(1001) is None
    assert db.get_table("download_logs").select(7001) is None
    assert db.get_table("expiry_jobs").select(8001) is None
    assert db.get_table("portfolio_entries").select(9001) is None
    assert db.get_table("inner_tokens").select(101)["token_type"] == "MAIN"


def test_consistency_valid_references(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    tx = db.begin()
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 250, "status": "ACTIVE"})
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    tx.insert(
        "portfolio_entries",
        9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Portfolio A",
            "content": "payload",
            "status": "ACTIVE",
        },
    )
    db.commit(tx)

    assert db.get_table("files").select(1001)["vault_id"] == 1
    assert db.get_table("download_logs").select(7001)["file_id"] == 1001
    assert db.get_table("expiry_jobs").select(8001)["vault_id"] == 1
    assert db.get_table("portfolio_entries").select(9001)["owner_token_id"] == 101


def test_consistency_engine_rejects_negative_file_size(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    tx = db.begin()
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": -9, "status": "ACTIVE"})

    failed = False
    try:
        db.commit(tx)
    except ValueError:
        failed = True

    assert failed
    assert db.get_table("files").select(1001) is None


def test_consistency_engine_rejects_missing_reference(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 999, "file_size": 5, "status": "ACTIVE"})

    failed = False
    try:
        db.commit(tx)
    except ValueError:
        failed = True

    assert failed
    assert db.get_table("files").select(1001) is None


def test_isolation_concurrent_file_inserts(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    inserts = 20

    def worker(i: int):
        tx = db.begin()
        tx.insert("files", 2000 + i, {"vault_id": 1, "inner_token_id": 101, "file_size": i + 1, "status": "ACTIVE"})
        db.commit(tx)

    threads = [Thread(target=worker, args=(i,)) for i in range(inserts)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    rows = db.get_table("files").all_rows()
    assert len(rows) == inserts


def test_isolation_no_dirty_read(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})

    assert db.get_table("vaults").select(1) is None

    db.commit(tx)
    assert db.get_table("vaults").select(1)["outer_token"] == "OUTER001"


def test_api_blocks_non_transactional_mutations(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    vaults_view = db.get_table("vaults")
    assert not hasattr(vaults_view, "insert")
    assert not hasattr(vaults_view, "update")
    assert not hasattr(vaults_view, "delete")


def test_durability_single_commit_restart(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    db.commit(tx)

    restarted = TransactionalDatabaseManager(wal_path)
    assert restarted.get_table("vaults").select(1)["outer_token"] == "OUTER001"


def test_durability_multiple_commits_restart(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    t1 = db.begin()
    t1.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    db.commit(t1)

    t2 = db.begin()
    t2.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    db.commit(t2)

    t3 = db.begin()
    t3.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "pytest-agent"})
    t3.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 33, "status": "ACTIVE"})
    t3.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    t3.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    t3.insert(
        "portfolio_entries",
        9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Portfolio A",
            "content": "payload",
            "status": "ACTIVE",
        },
    )
    db.commit(t3)

    restarted = TransactionalDatabaseManager(wal_path)
    assert restarted.get_table("vaults").select(1)["status"] == "ACTIVE"
    assert restarted.get_table("inner_tokens").select(101)["token_type"] == "MAIN"
    assert restarted.get_table("sessions").select(501)["ip_address"] == "127.0.0.1"
    assert restarted.get_table("files").select(1001)["file_size"] == 33
    assert restarted.get_table("download_logs").select(7001)["session_id"] == 501
    assert restarted.get_table("expiry_jobs").select(8001)["vault_id"] == 1
    assert restarted.get_table("portfolio_entries").select(9001)["title"] == "Portfolio A"


def test_recovery_replays_committed_ignores_incomplete(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    committed = db.begin()
    committed.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    db.commit(committed)

    uncommitted = db.begin()
    uncommitted.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    uncommitted.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 8, "status": "ACTIVE"})

    restarted = TransactionalDatabaseManager(wal_path)
    assert restarted.get_table("vaults").select(1)["status"] == "ACTIVE"
    assert restarted.get_table("inner_tokens").select(101) is None
    assert restarted.get_table("files").select(1001) is None


def test_isolation_serialized_write_conflict_ordering(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    seed_file = db.begin()
    seed_file.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 10, "status": "ACTIVE"})
    db.commit(seed_file)

    tx1 = db.begin()
    row1 = db.get_table("files").select(1001)
    tx1.update("files", 1001, {**row1, "file_size": 111})
    db.commit(tx1)

    tx2 = db.begin()
    row2 = db.get_table("files").select(1001)
    tx2.update("files", 1001, {**row2, "file_size": 222})
    db.commit(tx2)

    final = db.get_table("files").select(1001)
    assert final["file_size"] == 222


def test_atomicity_mid_commit_failure_injection(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)
    seed_base_domain(db)

    tx = db.begin()
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 5, "status": "ACTIVE"})
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})

    original_apply = db._apply_operation_direct
    seen = {"count": 0}

    def flaky_apply(op):
        seen["count"] += 1
        if seen["count"] == 2:
            raise RuntimeError("Injected failure during commit apply")
        return original_apply(op)

    db._apply_operation_direct = flaky_apply
    failed = False
    try:
        db.commit(tx)
    except RuntimeError:
        failed = True
    finally:
        db._apply_operation_direct = original_apply

    assert failed
    assert db.get_table("files").select(1001) is None
    assert db.get_table("download_logs").select(7001) is None

    records = read_wal_records(wal_path)
    rollback_for_tx = [r for r in records if r.get("type") == "ROLLBACK" and r.get("tx_id") == tx.tx_id]
    assert rollback_for_tx and rollback_for_tx[-1].get("reason") == "commit_failed"


def test_recovery_idempotent_restart_replay(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    t1 = db.begin()
    t1.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    db.commit(t1)

    t2 = db.begin()
    t2.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    db.commit(t2)

    wal_before = wal_path.read_text(encoding="utf-8")

    restarted1 = TransactionalDatabaseManager(wal_path)
    state1 = {
        "vault": restarted1.get_table("vaults").select(1),
        "token": restarted1.get_table("inner_tokens").select(101),
    }

    restarted2 = TransactionalDatabaseManager(wal_path)
    state2 = {
        "vault": restarted2.get_table("vaults").select(1),
        "token": restarted2.get_table("inner_tokens").select(101),
    }

    wal_after = wal_path.read_text(encoding="utf-8")

    assert state1 == state2
    assert state2["vault"]["status"] == "ACTIVE"
    assert state2["token"]["token_type"] == "MAIN"
    assert wal_after == wal_before


def test_durability_multiple_commits_with_incomplete_tail(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    t1 = db.begin()
    t1.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    db.commit(t1)

    t2 = db.begin()
    t2.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    db.commit(t2)

    t3 = db.begin()
    t3.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "pytest-agent"})
    t3.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 15, "status": "ACTIVE"})
    db.commit(t3)

    t4 = db.begin()
    t4.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    t4.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})

    restarted = TransactionalDatabaseManager(wal_path)
    assert restarted.get_table("vaults").select(1) is not None
    assert restarted.get_table("inner_tokens").select(101) is not None
    assert restarted.get_table("files").select(1001) is not None
    assert restarted.get_table("download_logs").select(7001) is None
    assert restarted.get_table("expiry_jobs").select(8001) is None


def test_non_transactional_bypass_is_not_durable_and_not_logged(wal_path: Path) -> None:
    reset_file(wal_path)
    db = init_db(wal_path)

    raw_vaults = db.db.get_table("vaults")
    raw_vaults.insert(999, {"outer_token": "BYPASS", "status": "ACTIVE"})

    assert db.get_table("vaults").select(999)["outer_token"] == "BYPASS"

    records = read_wal_records(wal_path)
    bypass_ops = [r for r in records if r.get("type") == "OP" and r.get("table") == "vaults" and r.get("key") == 999]
    assert not bypass_ops

    restarted = TransactionalDatabaseManager(wal_path)
    assert restarted.get_table("vaults").select(999) is None


def main() -> None:
    wal_path = Path(__file__).resolve().parents[1] / "logs" / "acid_test_wal.log"
    results_dir = Path(__file__).resolve().parents[2] / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    detailed_results_path = results_dir / "acid_test_results_detailed.json"

    tests = [
        ("Atomicity (crash before commit)", test_atomicity_crash_before_commit),
        ("Atomicity (explicit rollback, 7 relations)", test_atomicity_explicit_rollback_across_7_relations),
        ("Consistency (valid references across 7 relations)", test_consistency_valid_references),
        ("Consistency (engine rejects negative file size)", test_consistency_engine_rejects_negative_file_size),
        ("Consistency (engine rejects missing reference)", test_consistency_engine_rejects_missing_reference),
        ("Isolation (concurrent file inserts)", test_isolation_concurrent_file_inserts),
        ("Isolation (no dirty read)", test_isolation_no_dirty_read),
        ("Isolation (serialized write conflict ordering)", test_isolation_serialized_write_conflict_ordering),
        ("Atomicity (mid-commit failure injection rollback)", test_atomicity_mid_commit_failure_injection),
        ("API blocks non-transactional mutations", test_api_blocks_non_transactional_mutations),
        ("Negative path: bypass is not durable and not WAL-logged", test_non_transactional_bypass_is_not_durable_and_not_logged),
        ("Durability (single commit restart)", test_durability_single_commit_restart),
        ("Durability (multiple commits restart across 7 relations)", test_durability_multiple_commits_restart),
        ("Durability (multiple commits + incomplete tail)", test_durability_multiple_commits_with_incomplete_tail),
        ("Recovery (commit replay + incomplete ignore)", test_recovery_replays_committed_ignores_incomplete),
        ("Recovery (idempotent replay across repeated restarts)", test_recovery_idempotent_restart_replay),
    ]

    run_started = datetime.now(timezone.utc).isoformat()
    suite_start = time.perf_counter()
    detailed_checks: list[dict] = []
    failed = 0

    for name, fn in tests:
        started = time.perf_counter()
        error = None
        passed = True
        try:
            fn(wal_path)
            print(f"[PASS] {name}")
        except Exception as exc:
            passed = False
            failed += 1
            error = f"{type(exc).__name__}: {exc}"
            print(f"[FAIL] {name} -> {error}")
        elapsed_sec = round(time.perf_counter() - started, 6)
        detailed_checks.append({
            "name": name,
            "passed": passed,
            "elapsed_sec": elapsed_sec,
            "error": error,
        })

    passed_count = len(tests) - failed
    suite_elapsed = round(time.perf_counter() - suite_start, 6)
    payload = {
        "suite": "module_a_acid_recovery",
        "run_started_utc": run_started,
        "total_checks": len(tests),
        "passed_checks": passed_count,
        "failed_checks": failed,
        "all_passed": failed == 0,
        "elapsed_sec": suite_elapsed,
        "wal_path": str(wal_path),
        "checks": detailed_checks,
    }
    detailed_results_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    if failed == 0:
        print(f"[OK] All {len(tests)} ACID/recovery checks passed.")
    else:
        print(f"[FAIL] {failed}/{len(tests)} checks failed.")

    print(f"[INFO] Detailed results saved to {detailed_results_path}")
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
