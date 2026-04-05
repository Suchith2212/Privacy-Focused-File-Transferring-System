"""
module_b_stress_testing/concurrent_vault_test.py
==================================================
Module B – Concurrent Vault Operations
========================================
Simulates multiple users simultaneously creating vaults, uploading files,
and expiring vaults. Uses Python threading to achieve real concurrency
against the in-process transactional B+ Tree engine.

Test:
  - N threads each create one vault + token + file in a single transaction
  - After all threads finish, verify: N vaults, N tokens, N files exist
  - No data corruption, no duplicate keys, no deadlocks

Usage:
    python module_b_stress_testing/concurrent_vault_test.py
    python module_b_stress_testing/concurrent_vault_test.py --users 50
"""

from __future__ import annotations

import argparse
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


def _build_db() -> TransactionalDatabaseManager:
    wal = LOGS_DIR / "module_b_concurrent_vault.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


def run_concurrent_vault_test(n_users: int = 20) -> dict:
    """
    Launch n_users threads, each atomically creating vault + token + file.
    Returns a summary dict with pass/fail and row counts.
    """
    db = _build_db()

    errors: list[str] = []
    success_count = 0
    lock = threading.Lock()
    start_time = time.perf_counter()

    def create_vault(user_id: int) -> None:
        nonlocal success_count
        vault_id = 1000 + user_id
        token_id = 2000 + user_id
        file_id = 3000 + user_id

        try:
            tx = db.begin()
            tx.insert(
                "vaults", vault_id,
                {"outer_token": f"OUTER_{user_id:04d}", "status": "ACTIVE"},
            )
            tx.insert(
                "inner_tokens", token_id,
                {
                    "vault_id": vault_id, "token_type": "MAIN",
                    "token_hash": f"hash_{user_id}", "status": "ACTIVE",
                },
            )
            tx.insert(
                "files", file_id,
                {
                    "vault_id": vault_id, "inner_token_id": token_id,
                    "file_size": (user_id + 1) * 512, "status": "ACTIVE",
                    "download_count": 0, "max_downloads": 1,
                },
            )
            db.commit(tx)
            with lock:
                success_count += 1
        except Exception as e:
            with lock:
                errors.append(f"User {user_id}: {e}")

    threads = [threading.Thread(target=create_vault, args=(i,)) for i in range(n_users)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    elapsed = time.perf_counter() - start_time

    # Verify results
    vault_count = len(db.get_table("vaults").all_rows())
    token_count = len(db.get_table("inner_tokens").all_rows())
    file_count = len(db.get_table("files").all_rows())

    passed = (
        success_count == n_users
        and vault_count == n_users
        and token_count == n_users
        and file_count == n_users
        and not errors
    )

    result = {
        "test": "concurrent_vault_creation",
        "users": n_users,
        "success_count": success_count,
        "vault_count": vault_count,
        "token_count": token_count,
        "file_count": file_count,
        "errors": errors,
        "elapsed_sec": round(elapsed, 3),
        "throughput_ops_per_sec": round(success_count / elapsed, 2) if elapsed > 0 else 0,
        "passed": passed,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Concurrent vault creation test")
    parser.add_argument("--users", type=int, default=20)
    parser.add_argument("--out", default=str(RESULTS_DIR / "concurrent_vault_test.json"))
    args = parser.parse_args()

    print("=" * 60)
    print("MODULE B: CONCURRENT VAULT CREATION TEST")
    print("=" * 60)
    print(f"Users: {args.users}")

    result = run_concurrent_vault_test(args.users)

    print(f"\n[CONCURRENT] Success:    {result['success_count']} / {args.users}")
    print(f"[CONCURRENT] Vaults:     {result['vault_count']}")
    print(f"[CONCURRENT] Tokens:     {result['token_count']}")
    print(f"[CONCURRENT] Files:      {result['file_count']}")
    print(f"[CONCURRENT] Errors:     {len(result['errors'])}")
    print(f"[CONCURRENT] Elapsed:    {result['elapsed_sec']:.3f}s")
    print(f"[CONCURRENT] Throughput: {result['throughput_ops_per_sec']:.1f} txn/s")
    print(f"\n[CONCURRENT] RESULT: {'PASS [PASS]' if result['passed'] else 'FAIL [FAIL]'}")

    if result["errors"]:
        for e in result["errors"][:5]:
            print(f"  ERROR: {e}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\n[CONCURRENT] Results saved to {out}")


if __name__ == "__main__":
    main()
