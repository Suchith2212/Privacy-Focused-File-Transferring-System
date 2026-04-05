"""
run_demo.py  -  CS432 Assignment 3 Quick Demo Script
======================================================
Team: Dragons | GhostDrop Project

This single script runs the full demonstration in one command:
  1. Module A smoke test      (B+ Tree + TransactionalDB baseline)
  2. Module A ACID test       (16 test cases, all properties)
  3. Module A WAL smoke test  (transaction + recovery flow)
  4. All four ACID experiments (atomicity, consistency, isolation, durability)
  5. Module B concurrent vault creation
  6. Module B race condition (one-time download, 50 threads)
  7. Module B failure injection
  8. Module B stress test (1000 ops)
  9. Module B ACID verification suite

Run:
    python run_demo.py
    python run_demo.py --quick   # skip stress test (faster demo)
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
from pathlib import Path

# -------------------------------------------------------------------------
# Path setup
# -------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent     # Assignment3/
ENGINE = HERE / "module_a"

for _p in (str(HERE), str(ENGINE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

RESULTS = HERE / "results"
LOGS = HERE / "logs"
RESULTS.mkdir(parents=True, exist_ok=True)
LOGS.mkdir(parents=True, exist_ok=True)


# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------

def _header(title: str) -> None:
    bar = "-" * 64
    print(f"\n{bar}")
    print(f"  {title}")
    print(bar)


def _run_module(label: str, module: str, fn: str = "main") -> tuple[bool, float]:
    """Import `module` and call its `fn()`. Return (passed, elapsed_sec)."""
    start = time.perf_counter()
    try:
        mod = importlib.import_module(module)
        getattr(mod, fn)()
        elapsed = time.perf_counter() - start
        return True, elapsed
    except SystemExit as e:
        elapsed = time.perf_counter() - start
        ok = e.code in (None, 0)
        if not ok:
            print(f"  [DEMO] [WARN]  {label} exited with code {e.code}")
        return ok, elapsed
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(f"  [DEMO] [FAIL] {label} raised {type(exc).__name__}: {exc}")
        return False, elapsed


def _run_direct(label: str, fn) -> tuple[bool, float]:
    """Call a Python callable directly."""
    start = time.perf_counter()
    try:
        fn()
        elapsed = time.perf_counter() - start
        return True, elapsed
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(f"  [DEMO] [FAIL] {label} raised {type(exc).__name__}: {exc}")
        return False, elapsed


# -------------------------------------------------------------------------
# Step runners
# -------------------------------------------------------------------------

def run_module_a_smoke() -> tuple[bool, float]:
    _header("STEP 1 - Module A: B+ Tree Baseline Smoke Test")
    import subprocess
    start = time.perf_counter()
    result = subprocess.run(
        [sys.executable, str(ENGINE / "smoke_test.py")],
        capture_output=False,
        cwd=str(ENGINE),
    )
    elapsed = time.perf_counter() - start
    ok = result.returncode == 0
    return ok, elapsed


def run_module_a_acid() -> tuple[bool, float]:
    _header("STEP 2 - Module A: ACID Test Suite (16 checks)")
    import subprocess
    start = time.perf_counter()
    result = subprocess.run(
        [sys.executable, str(ENGINE / "tests" / "test_acid.py")],
        capture_output=False,
        cwd=str(ENGINE),
    )
    elapsed = time.perf_counter() - start
    ok = result.returncode == 0
    return ok, elapsed


def run_module_a_wal_smoke() -> tuple[bool, float]:
    _header("STEP 3 - Module A: WAL + Recovery Smoke Test")
    import subprocess
    start = time.perf_counter()
    result = subprocess.run(
        [sys.executable, str(ENGINE / "transaction_smoke_test.py")],
        capture_output=False,
        cwd=str(ENGINE),
    )
    elapsed = time.perf_counter() - start
    ok = result.returncode == 0
    return ok, elapsed


def run_experiments() -> tuple[bool, float]:
    _header("STEP 4 - All Four ACID Experiments")
    return _run_module("ACID Experiments", "experiments.run_all_experiments")


def run_concurrent_vault() -> tuple[bool, float]:
    _header("STEP 5 - Module B: Concurrent Vault Creation (20 users)")

    def _fn():
        from module_b_stress_testing.concurrent_vault_test import run_concurrent_vault_test
        r = run_concurrent_vault_test(20)
        print(f"  Success: {r['success_count']}/20  |  Throughput: {r['throughput_ops_per_sec']:.1f} txn/s")
        assert r["passed"], f"Concurrent vault test FAILED: {r}"

    return _run_direct("Concurrent vault test", _fn)


def run_race_condition() -> tuple[bool, float]:
    _header("STEP 6 - Module B: One-Time Download Race (50 threads)")

    def _fn():
        from module_b_stress_testing.race_condition_download_test import run_race_condition_test
        r = run_race_condition_test(50)
        print(f"  Success: {r['success_count']}  |  Failed: {r['failed_count']}  |  Final count: {r['final_download_count']}")
        assert r["passed"], f"Race condition test FAILED: {r}"

    return _run_direct("Race condition test", _fn)


def run_failure_injection() -> tuple[bool, float]:
    _header("STEP 7 - Module B: Failure Injection Test")
    return _run_module("Failure injection", "module_b_stress_testing.failure_injection_test")


def run_stress_test() -> tuple[bool, float]:
    _header("STEP 8 - Module B: Stress Test (1000 operations)")

    def _fn():
        from module_b_stress_testing.stress_test_runner import run_stress_test as _rst
        m = _rst(1000, 1)
        print(f"  Ops: {m['total_ops']}  |  Success: {m['success_count']}  "
              f"|  Throughput: {m['throughput_ops_per_sec']:.1f} ops/s  "
              f"|  p95 Latency: {m['latency_ms']['p95']:.2f}ms")
        out = RESULTS / "stress_test_metrics.json"
        out.write_text(json.dumps(m, indent=2), encoding="utf-8")
        print(f"  Metrics -> {out}")

    return _run_direct("Stress test", _fn)


def run_acid_suite() -> tuple[bool, float]:
    _header("STEP 9 - Module B: ACID Verification Suite")
    return _run_module("ACID suite", "module_b_stress_testing.acid_verification_suite")


# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Assignment 3 - complete demo runner")
    parser.add_argument("--quick", action="store_true",
                        help="Skip stress test (steps 8) for faster demo")
    args = parser.parse_args()

    print("+" + "=" * 64 + "+")
    print("|  CS432 Database Systems - Assignment 3 Demo                  |")
    print("|  Team: Dragons | GhostDrop - ACID Transaction Engine         |")
    print("+" + "=" * 64 + "+")

    steps = [
        ("Module A - B+ Tree Smoke", run_module_a_smoke),
        ("Module A - ACID Tests (16/16)", run_module_a_acid),
        ("Module A - WAL + Recovery Smoke", run_module_a_wal_smoke),
        ("ACID Experiments (1-4)", run_experiments),
        ("Module B - Concurrent Vault (20 users)", run_concurrent_vault),
        ("Module B - Race Condition (50 threads)", run_race_condition),
        ("Module B - Failure Injection", run_failure_injection),
        ("Module B - Stress Test (1000 ops)", run_stress_test) if not args.quick else None,
        ("Module B - ACID Suite", run_acid_suite),
    ]

    steps = [s for s in steps if s is not None]

    summary: list[dict] = []
    total_start = time.perf_counter()

    for label, runner in steps:
        ok, elapsed = runner()
        icon = "[PASS]" if ok else "[FAIL]"
        print(f"\n  {icon}  {label}  ({elapsed:.2f}s)")
        summary.append({"step": label, "passed": ok, "elapsed_sec": round(elapsed, 3)})

    total_elapsed = time.perf_counter() - total_start

    all_passed = all(s["passed"] for s in summary)

    print("\n" + "=" * 66)
    print("  DEMO SUMMARY")
    print("=" * 66)
    for s in summary:
        icon = "[PASS]" if s["passed"] else "[FAIL]"
        print(f"  {icon}  {s['step']:<45} {s['elapsed_sec']:>6.2f}s")
    print("=" * 66)
    print(f"  Total time: {total_elapsed:.2f}s")

    if all_passed:
        print("\n  [DONE]  ALL STEPS PASSED - ACID properties fully validated!\n")
    else:
        print("\n  [FAIL]  SOME STEPS FAILED - review output above.\n")

    out = RESULTS / "demo_summary.json"
    out.write_text(
        json.dumps({"demo": "assignment3", "passed": all_passed,
                    "total_elapsed_sec": round(total_elapsed, 3), "steps": summary}, indent=2),
        encoding="utf-8",
    )
    print(f"  Results -> {out}\n")

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()

