"""
module_b_stress_testing/stress_test_runner.py
============================================
Module B - 1000+ Operations Stress Test
========================================
Runs a mixed workload of multi-relation transactional operations against
Module A and reports throughput, latency, and per-operation distribution.

Generated artifacts:
  results/stress_test_metrics.json
  results/latency_distribution.png (optional, if matplotlib is installed)

Usage:
  python module_b_stress_testing/stress_test_runner.py
  python module_b_stress_testing/stress_test_runner.py --ops 2000 --threads 8
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import threading
import time
from collections import Counter
from pathlib import Path
from statistics import mean, median

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
    "vaults",
    "inner_tokens",
    "files",
    "sessions",
    "download_logs",
    "expiry_jobs",
    "portfolio_entries",
]

KEY_RANGE = 500


def _build_db() -> TransactionalDatabaseManager:
    wal = LOGS_DIR / "module_b_stress.log"
    wal.write_text("", encoding="utf-8")
    db = TransactionalDatabaseManager(wal)
    for t in ALL_TABLES:
        db.create_table(t)
    return db


def _ids(seed_key: int) -> dict:
    # Stable, non-overlapping ids per logical entity.
    return {
        "vault_id": 10_000 + seed_key,
        "token_id": 20_000 + seed_key,
        "file_id": 30_000 + seed_key,
        "session_id": 40_000 + seed_key,
        "job_id": 50_000 + seed_key,
        "entry_id": 60_000 + seed_key,
    }


def _upsert(tx, db: TransactionalDatabaseManager, table: str, key: int, row: dict) -> None:
    current = db.get_table(table).select(key)
    if current is None:
        tx.insert(table, key, row)
    else:
        tx.update(table, key, row)


def _op_bundle_write(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # 4-table transaction: vaults + inner_tokens + sessions + files
    ids = _ids(key)
    tx = db.begin()
    try:
        _upsert(tx, db, "vaults", ids["vault_id"], {
            "outer_token": f"STRESS_OUTER_{ids['vault_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "inner_tokens", ids["token_id"], {
            "vault_id": ids["vault_id"],
            "token_type": "MAIN",
            "token_hash": f"stress_hash_{ids['token_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "sessions", ids["session_id"], {
            "ip_address": f"10.0.{key % 255}.{(key * 7) % 255}",
            "user_agent": "stress-runner",
        })

        existing_file = db.get_table("files").select(ids["file_id"])
        download_count = int(existing_file.get("download_count", 0)) if existing_file else 0
        _upsert(tx, db, "files", ids["file_id"], {
            "vault_id": ids["vault_id"],
            "inner_token_id": ids["token_id"],
            "file_size": 64 + (key % 1024),
            "status": "ACTIVE",
            "download_count": download_count,
            "max_downloads": 1_000_000,
        })
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


def _op_download_event(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # 3+ table transaction: files update + download_logs insert + sessions/vault/token refs
    ids = _ids(key)
    log_id = 70_000_000 + op_id

    tx = db.begin()
    try:
        # Ensure required referenced rows exist in the same transaction.
        _upsert(tx, db, "vaults", ids["vault_id"], {
            "outer_token": f"STRESS_OUTER_{ids['vault_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "inner_tokens", ids["token_id"], {
            "vault_id": ids["vault_id"],
            "token_type": "MAIN",
            "token_hash": f"stress_hash_{ids['token_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "sessions", ids["session_id"], {
            "ip_address": f"10.1.{key % 255}.{(key * 11) % 255}",
            "user_agent": "stress-download",
        })

        file_row = db.get_table("files").select(ids["file_id"]) or {
            "vault_id": ids["vault_id"],
            "inner_token_id": ids["token_id"],
            "file_size": 128,
            "status": "ACTIVE",
            "download_count": 0,
            "max_downloads": 1_000_000,
        }
        _upsert(tx, db, "files", ids["file_id"], {
            **file_row,
            "download_count": int(file_row.get("download_count", 0)) + 1,
            "max_downloads": max(int(file_row.get("max_downloads", 1)), 1_000_000),
        })
        tx.insert("download_logs", log_id, {
            "file_id": ids["file_id"],
            "inner_token_id": ids["token_id"],
            "session_id": ids["session_id"],
        })
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


def _op_expire_cycle(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # 3-table transaction: vault status + token status + expiry job
    ids = _ids(key)

    tx = db.begin()
    try:
        _upsert(tx, db, "vaults", ids["vault_id"], {
            "outer_token": f"STRESS_OUTER_{ids['vault_id']}",
            "status": "EXPIRED",
        })
        _upsert(tx, db, "inner_tokens", ids["token_id"], {
            "vault_id": ids["vault_id"],
            "token_type": "MAIN",
            "token_hash": f"stress_hash_{ids['token_id']}",
            "status": "REVOKED",
        })
        _upsert(tx, db, "expiry_jobs", ids["job_id"], {
            "vault_id": ids["vault_id"],
            "processed": True,
        })
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


def _op_portfolio_write(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # 3-table transaction: vault + token + portfolio entry
    ids = _ids(key)

    tx = db.begin()
    try:
        _upsert(tx, db, "vaults", ids["vault_id"], {
            "outer_token": f"STRESS_OUTER_{ids['vault_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "inner_tokens", ids["token_id"], {
            "vault_id": ids["vault_id"],
            "token_type": "MAIN",
            "token_hash": f"stress_hash_{ids['token_id']}",
            "status": "ACTIVE",
        })
        _upsert(tx, db, "portfolio_entries", ids["entry_id"], {
            "vault_id": ids["vault_id"],
            "owner_token_id": ids["token_id"],
            "created_by_token_id": ids["token_id"],
            "title": f"Stress Entry {op_id}",
            "content": f"payload-{key}-{op_id}",
            "status": "ACTIVE",
        })
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


def _op_cleanup(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # Multi-table delete path to exercise transactional deletes.
    ids = _ids(key)

    tx = db.begin()
    try:
        # Remove dependent logs first to keep FK checks valid before file delete.
        for log_id, row in db.get_table("download_logs").all_rows():
            if int(row.get("file_id", -1)) == ids["file_id"]:
                tx.delete("download_logs", log_id)

        tx.delete("portfolio_entries", ids["entry_id"])
        tx.delete("expiry_jobs", ids["job_id"])
        tx.delete("files", ids["file_id"])
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


def _op_read_path(db: TransactionalDatabaseManager, key: int, op_id: int) -> None:
    # Read-only transactional path touching multiple tables.
    ids = _ids(key)
    tx = db.begin()
    try:
        _ = db.get_table("vaults").select(ids["vault_id"])
        _ = db.get_table("inner_tokens").select(ids["token_id"])
        _ = db.get_table("files").select(ids["file_id"])
        _ = db.get_table("sessions").select(ids["session_id"])
        _ = db.get_table("portfolio_entries").select(ids["entry_id"])
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


OP_TABLE = {
    "bundle_write": _op_bundle_write,
    "download_event": _op_download_event,
    "expire_cycle": _op_expire_cycle,
    "portfolio_write": _op_portfolio_write,
    "cleanup": _op_cleanup,
    "read_path": _op_read_path,
}
OP_WEIGHTS = {
    "bundle_write": 0.22,
    "download_event": 0.20,
    "expire_cycle": 0.14,
    "portfolio_write": 0.18,
    "cleanup": 0.08,
    "read_path": 0.18,
}


def run_stress_test(n_ops: int = 1000, n_threads: int = 1, seed: int = 42) -> dict:
    random.seed(seed)
    db = _build_db()

    op_types = list(OP_TABLE.keys())
    weights = [OP_WEIGHTS[o] for o in op_types]

    operations = [
        {
            "op_id": i,
            "op_type": random.choices(op_types, weights=weights, k=1)[0],
            "key": random.randint(1, KEY_RANGE),
        }
        for i in range(n_ops)
    ]

    attempted = Counter(op["op_type"] for op in operations)
    success_by_op = Counter()
    fail_by_op = Counter()

    success_count = 0
    fail_count = 0
    latencies: list[float] = []
    lock = threading.Lock()

    def worker(ops_slice: list[dict]) -> None:
        nonlocal success_count, fail_count
        for op in ops_slice:
            start = time.perf_counter()
            try:
                OP_TABLE[op["op_type"]](db, op["key"], op["op_id"])
                elapsed_ms = (time.perf_counter() - start) * 1000
                with lock:
                    success_count += 1
                    success_by_op[op["op_type"]] += 1
                    latencies.append(elapsed_ms)
            except Exception:
                elapsed_ms = (time.perf_counter() - start) * 1000
                with lock:
                    fail_count += 1
                    fail_by_op[op["op_type"]] += 1
                    latencies.append(elapsed_ms)

    total_start = time.perf_counter()

    if n_threads <= 1:
        worker(operations)
    else:
        threads = []
        for i in range(n_threads):
            slice_ = operations[i::n_threads]
            if slice_:
                threads.append(threading.Thread(target=worker, args=(slice_,)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    total_elapsed = time.perf_counter() - total_start
    throughput = success_count / total_elapsed if total_elapsed > 0 else 0

    def _pct(data: list[float], p: float) -> float:
        if not data:
            return 0.0
        arr = sorted(data)
        idx = max(0, min(len(arr) - 1, int(p * (len(arr) - 1))))
        return arr[idx]

    metrics = {
        "test": "stress_test",
        "workload_model": "multi_relation_transaction_mix",
        "total_ops": n_ops,
        "threads": n_threads,
        "seed": seed,
        "success_count": success_count,
        "fail_count": fail_count,
        "success_rate_pct": round(100 * success_count / n_ops, 2) if n_ops else 0,
        "elapsed_sec": round(total_elapsed, 3),
        "throughput_ops_per_sec": round(throughput, 2),
        "latency_ms": {
            "mean": round(mean(latencies), 3) if latencies else 0,
            "p50": round(_pct(latencies, 0.50), 3),
            "p95": round(_pct(latencies, 0.95), 3),
            "p99": round(_pct(latencies, 0.99), 3),
            "max": round(max(latencies), 3) if latencies else 0,
        },
        "op_distribution": {
            "attempted": {op: int(attempted.get(op, 0)) for op in op_types},
            "success": {op: int(success_by_op.get(op, 0)) for op in op_types},
            "failed": {op: int(fail_by_op.get(op, 0)) for op in op_types},
        },
    }
    return metrics


def _save_graphs() -> None:
    """Attempt graph generation. Skip cleanly if matplotlib is unavailable."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        # Small synthetic latency probe for histogram.
        db_small = TransactionalDatabaseManager(LOGS_DIR / "stress_graph.log")
        for t in ALL_TABLES:
            db_small.create_table(t)

        lat: list[float] = []
        for i in range(400):
            op = random.choice(list(OP_TABLE.keys()))
            key = random.randint(1, KEY_RANGE)
            start = time.perf_counter()
            try:
                OP_TABLE[op](db_small, key, 900_000 + i)
            except Exception:
                pass
            lat.append((time.perf_counter() - start) * 1000)

        fig, axes = plt.subplots(1, 2, figsize=(12, 5))

        axes[0].hist(lat, bins=40, color="#4F86C6", edgecolor="white", alpha=0.85)
        axes[0].set_title("Latency Distribution", fontsize=14, fontweight="bold")
        axes[0].set_xlabel("Latency (ms)")
        axes[0].set_ylabel("Frequency")
        axes[0].axvline(x=median(lat), color="red", linestyle="--", label=f"p50 = {median(lat):.1f}ms")
        axes[0].legend()

        axes[1].plot(range(1, len(lat) + 1), range(1, len(lat) + 1), color="#4CAF50", linewidth=2)
        axes[1].set_title("Cumulative Operations", fontsize=14, fontweight="bold")
        axes[1].set_xlabel("Operation Index")
        axes[1].set_ylabel("Cumulative Completed Ops")

        fig.suptitle("GhostDrop - Stress Test Performance", fontsize=16, fontweight="bold")
        plt.tight_layout()
        plt.savefig(str(RESULTS_DIR / "latency_distribution.png"), dpi=150)
        plt.close()
        print(f"[STRESS] Graphs saved to {RESULTS_DIR}")
    except ImportError:
        print("[STRESS] matplotlib not installed - skipping graph generation")
    except Exception as e:
        print(f"[STRESS] Graph generation error: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stress test: 1000+ multi-relation transactional operations")
    parser.add_argument("--ops", type=int, default=1000)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--graphs", action="store_true", default=True)
    parser.add_argument("--out", default=str(RESULTS_DIR / "stress_test_metrics.json"))
    args = parser.parse_args()

    print("=" * 60)
    print("MODULE B: STRESS TEST - 1000+ OPERATIONS")
    print("=" * 60)
    print(f"Operations: {args.ops}  |  Threads: {args.threads}")

    metrics = run_stress_test(args.ops, args.threads)

    print("\n[STRESS] Results:")
    print(f"  Workload model: {metrics['workload_model']}")
    print(f"  Total ops:      {metrics['total_ops']}")
    print(f"  Success:        {metrics['success_count']}")
    print(f"  Failed:         {metrics['fail_count']}")
    print(f"  Success rate:   {metrics['success_rate_pct']}%")
    print(f"  Elapsed:        {metrics['elapsed_sec']:.3f}s")
    print(f"  Throughput:     {metrics['throughput_ops_per_sec']:.1f} ops/sec")
    print(f"  Latency mean:   {metrics['latency_ms']['mean']:.3f} ms")
    print(f"  Latency p50:    {metrics['latency_ms']['p50']:.3f} ms")
    print(f"  Latency p95:    {metrics['latency_ms']['p95']:.3f} ms")
    print(f"  Latency p99:    {metrics['latency_ms']['p99']:.3f} ms")
    print(f"  Latency max:    {metrics['latency_ms']['max']:.3f} ms")

    if args.graphs:
        _save_graphs()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"\n[STRESS] Metrics saved to {out}")


if __name__ == "__main__":
    main()
