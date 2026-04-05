"""
experiments/run_all_experiments.py
====================================
Master script: runs all four ACID experiments sequentially and prints a
consolidated report.

Usage:
    python experiments/run_all_experiments.py
"""

from __future__ import annotations

import importlib
import json
import sys
import time
from pathlib import Path

_A3_ROOT = Path(__file__).resolve().parents[1]
_ENGINE_ROOT = _A3_ROOT / "module_a"
for _p in (_A3_ROOT, _ENGINE_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

RESULTS_DIR = _A3_ROOT / "results"
LOGS_DIR = _A3_ROOT / "logs"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def _run(module_name: str, label: str) -> bool:
    """Import and execute the `main()` of an experiment module."""
    mod = importlib.import_module(module_name)
    start = time.perf_counter()
    try:
        mod.main()
        elapsed = time.perf_counter() - start
        print(f"\n[RUNNER] {label} completed in {elapsed:.2f}s\n")
        return True
    except SystemExit as e:
        if e.code == 0:
            return True
        print(f"[RUNNER] [FAIL] {label} raised SystemExit({e.code})")
        return False
    except Exception as exc:
        print(f"[RUNNER] [FAIL] {label} raised {type(exc).__name__}: {exc}")
        return False


def main() -> None:
    banner = "=" * 70
    print(banner)
    print(" CS432 Database Systems – Assignment 3")
    print(" Team Dragons | ACID Validation Suite")
    print(banner)

    experiments = [
        ("experiments.experiment_1_atomicity",   "Experiment 1: Atomicity"),
        ("experiments.experiment_2_consistency",  "Experiment 2: Consistency"),
        ("experiments.experiment_3_isolation",    "Experiment 3: Isolation"),
        ("experiments.experiment_4_durability",   "Experiment 4: Durability"),
    ]

    passed_flags = []
    for module_name, label in experiments:
        print(f"\n{banner}")
        print(f"  RUNNING: {label}")
        print(banner)
        ok = _run(module_name, label)
        passed_flags.append((label, ok))

    # -----------------------------------------------------------------------
    # Summary
    # -----------------------------------------------------------------------
    print(f"\n{banner}")
    print(" ACID EXPERIMENT SUMMARY")
    print(banner)
    all_passed = True
    for label, ok in passed_flags:
        icon = "[PASS]" if ok else "[FAIL]"
        print(f"  {icon}  {label}")
        if not ok:
            all_passed = False

    print(banner)
    if all_passed:
        print("  [DONE]  ALL FOUR ACID EXPERIMENTS PASSED")
    else:
        print("  [FAIL]  SOME EXPERIMENTS FAILED – review output above")
    print(banner)

    # Collect individual JSON results
    summary: dict = {"all_passed": all_passed, "experiments": {}}
    for fname in ("atomicity_test_results.json", "consistency_test_results.json",
                  "isolation_test_results.json", "durability_test_results.json"):
        p = RESULTS_DIR / fname
        if p.exists():
            summary["experiments"][fname] = json.loads(p.read_text(encoding="utf-8"))
        else:
            summary["experiments"][fname] = {"error": "not produced"}

    out = RESULTS_DIR / "all_experiments_summary.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[RUNNER] Combined results saved to {out}")


if __name__ == "__main__":
    main()
