"""
module_b_stress_testing/race_condition_download_test.py
=========================================================
Module B – One-Time Download Race Condition Test
==================================================
GhostDrop requirement: each file may be downloaded at most once.

Test protocol:
  1. Insert a file with max_downloads = 1, download_count = 0.
  2. Launch N concurrent threads, each attempting to download the same file.
  3. Only ONE thread should succeed (increment count to 1).
  4. All others should receive a DownloadLimitExceeded error.

This test validates Isolation: the serialised lock prevents two threads from
simultaneously reading download_count = 0, both deciding "ok to download",
and producing two successful downloads (the classic "lost update" bug).

Expected:
  success_count == 1
  failed_count  == N - 1
  final download_count == 1

Usage:
    python module_b_stress_testing/race_condition_download_test.py
    python module_b_stress_testing/race_condition_download_test.py --concurrency 50
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

FILE_ID = 555
VAULT_ID = 1
TOKEN_ID = 101
LOG_BASE_ID = 70000


class DownloadLimitExceeded(RuntimeError):
    """Raised when a file has already reached its download limit."""


def _build_db() -> TransactionalDatabaseManager:
    wal = LOGS_DIR / "module_b_race_condition.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)

    # Seed vault + token
    seed = db.begin()
    seed.insert("vaults", VAULT_ID, {"outer_token": "RACE_OUTER", "status": "ACTIVE"})
    seed.insert(
        "inner_tokens", TOKEN_ID,
        {"vault_id": VAULT_ID, "token_type": "MAIN", "token_hash": "race_h", "status": "ACTIVE"},
    )
    seed.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "race-tester"})
    db.commit(seed)

    return db


def run_race_condition_test(concurrency: int = 50) -> dict:
    """
    Attempt to download the same file from `concurrency` threads simultaneously.
    Returns summary with success/fail counts and final download_count.
    """
    db = _build_db()

    # Insert the contested file
    file_tx = db.begin()
    file_tx.insert(
        "files", FILE_ID,
        {
            "vault_id": VAULT_ID, "inner_token_id": TOKEN_ID,
            "file_size": 2048, "status": "ACTIVE",
            "download_count": 0, "max_downloads": 1,
        },
    )
    db.commit(file_tx)

    results = {"success": 0, "failed": 0, "errors": []}
    lock = threading.Lock()
    counter = [0]  # shared log_id counter

    def attempt_download(thread_id: int) -> None:
        try:
            with lock:
                counter[0] += 1
                log_id = LOG_BASE_ID + counter[0]

            tx = db.begin()
            try:
                file_rec = db.get_table("files").select(FILE_ID)
                if file_rec is None:
                    raise DownloadLimitExceeded(f"File {FILE_ID} not found")

                max_dl = file_rec.get("max_downloads", 1)
                cur_dl = file_rec.get("download_count", 0)

                if cur_dl >= max_dl:
                    raise DownloadLimitExceeded(
                        f"File {FILE_ID}: download limit reached ({cur_dl}/{max_dl})"
                    )

                # Increment and log
                tx.update("files", FILE_ID, {**file_rec, "download_count": cur_dl + 1})
                tx.insert(
                    "download_logs", log_id,
                    {"file_id": FILE_ID, "inner_token_id": TOKEN_ID, "session_id": 501},
                )
                db.commit(tx)

                with lock:
                    results["success"] += 1

            except DownloadLimitExceeded:
                db.rollback(tx)
                with lock:
                    results["failed"] += 1

        except Exception as exc:
            # Unexpected error
            with lock:
                results["errors"].append(f"Thread {thread_id}: {type(exc).__name__}: {exc}")
            try:
                db.rollback(tx)
            except Exception:
                pass

    start = time.perf_counter()
    threads = [threading.Thread(target=attempt_download, args=(i,)) for i in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - start

    final_rec = db.get_table("files").select(FILE_ID)
    final_count = final_rec["download_count"] if final_rec else -1
    log_entries = len(db.get_table("download_logs").all_rows())

    passed = (
        results["success"] == 1
        and results["failed"] == concurrency - 1
        and final_count == 1
        and log_entries == 1
        and not results["errors"]
    )

    return {
        "test": "one_time_download_race",
        "concurrency": concurrency,
        "success_count": results["success"],
        "failed_count": results["failed"],
        "error_count": len(results["errors"]),
        "errors": results["errors"][:5],
        "final_download_count": final_count,
        "download_log_entries": log_entries,
        "elapsed_sec": round(elapsed, 3),
        "passed": passed,
        "pass_criteria": {
            "exactly_one_success": results["success"] == 1,
            "all_others_failed": results["failed"] == concurrency - 1,
            "final_count_is_1": final_count == 1,
            "exactly_one_log_entry": log_entries == 1,
            "no_unexpected_errors": not results["errors"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="One-time download race condition test")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--out", default=str(RESULTS_DIR / "race_condition_engine_result.json"))
    args = parser.parse_args()

    print("=" * 60)
    print("MODULE B: ONE-TIME DOWNLOAD RACE CONDITION TEST (Engine)")
    print("=" * 60)
    print(f"Concurrency: {args.concurrency} threads")

    result = run_race_condition_test(args.concurrency)

    print(f"\n[RACE] Success count:         {result['success_count']}  (expected 1)")
    print(f"[RACE] Failed count:          {result['failed_count']}  (expected {args.concurrency - 1})")
    print(f"[RACE] Final download_count:  {result['final_download_count']}  (expected 1)")
    print(f"[RACE] Download log entries:  {result['download_log_entries']}  (expected 1)")
    print(f"[RACE] Unexpected errors:     {result['error_count']}")
    print(f"[RACE] Elapsed:               {result['elapsed_sec']:.3f}s")
    print(f"\n[RACE] RESULT: {'PASS [PASS]' if result['passed'] else 'FAIL [FAIL]'}")

    if result["errors"]:
        for e in result["errors"]:
            print(f"  ERROR: {e}")

    print("\nPass criteria breakdown:")
    for k, v in result["pass_criteria"].items():
        icon = "[PASS]" if v else "[FAIL]"
        print(f"  {icon} {k}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\n[RACE] Results saved to {out}")


if __name__ == "__main__":
    main()
