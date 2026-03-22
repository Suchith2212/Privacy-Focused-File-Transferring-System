"""
Benchmark the BlindDrop-oriented Module A indexes against a brute-force baseline.

The benchmark starts from the exported project snapshot when available and amplifies
that data into larger deterministic datasets. This keeps the benchmark closer to the
real project domain than a generic random-key benchmark.
"""

from __future__ import annotations

import json
import random
import time
from pathlib import Path
from statistics import mean
from typing import Dict, List, Sequence

try:
    from .blinddrop_index_manager import BlindDropIndexManager
    from .snapshot_utils import build_benchmark_snapshot, load_snapshot
except ImportError:  # pragma: no cover - direct invocation fallback
    from blinddrop_index_manager import BlindDropIndexManager
    from snapshot_utils import build_benchmark_snapshot, load_snapshot

try:
    import matplotlib.pyplot as plt
except ImportError:  # pragma: no cover - optional plotting
    plt = None

INTEGRATION = Path(__file__).resolve().parent
DEFAULT_SIZES = list(range(500, 20500, 1000))  # 20 points
DEFAULT_RUNS = 1
SUMMARY_PATH = INTEGRATION / "benchmark_blinddrop_paths_summary.md"
RESULTS_JSON = INTEGRATION / "benchmark_blinddrop_paths.json"


def timed(fn) -> float:
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def benchmark_once(base_snapshot: Dict[str, List[Dict[str, object]]], size: int) -> Dict[str, float]:
    print(f"Benchmarking size: {size}...", flush=True)
    snapshot = build_benchmark_snapshot(base_snapshot, size)
    sample_index = min(size - 1, max(1, size // 3))

    target_outer = snapshot["vaults"][sample_index]["outer_token"]
    expiry_lo = snapshot["vaults"][sample_index]["expires_at_epoch"] - 300
    expiry_hi = snapshot["vaults"][sample_index]["expires_at_epoch"] + 900
    target_vault = snapshot["vaults"][sample_index]["vault_id"]
    target_session = snapshot["auth_attempts"][sample_index]["session_id"]

    bpt = BlindDropIndexManager(engine="bplustree", order=16)
    brute = BlindDropIndexManager(engine="bruteforce", order=16)

    bpt_load = timed(lambda: bpt.load_snapshot(snapshot))
    brute_load = timed(lambda: brute.load_snapshot(snapshot))
    bpt_outer = timed(lambda: bpt.lookup_vault_by_outer_token(target_outer))
    brute_outer = timed(lambda: brute.lookup_vault_by_outer_token(target_outer))
    bpt_expiry = timed(lambda: bpt.range_scan_expiring_vaults(expiry_lo, expiry_hi))
    brute_expiry = timed(lambda: brute.range_scan_expiring_vaults(expiry_lo, expiry_hi))
    bpt_files = timed(
        lambda: bpt.range_scan_vault_files(target_vault, "ACTIVE", 0, 2_999_999_999)
    )
    brute_files = timed(
        lambda: brute.range_scan_vault_files(target_vault, "ACTIVE", 0, 2_999_999_999)
    )
    bpt_auth = timed(lambda: bpt.range_scan_auth_attempts(target_session, 0, 2_999_999_999))
    brute_auth = timed(lambda: brute.range_scan_auth_attempts(target_session, 0, 2_999_999_999))

    return {
        "size": size,
        "bpt_load": bpt_load,
        "brute_load": brute_load,
        "bpt_outer": bpt_outer,
        "brute_outer": brute_outer,
        "bpt_expiry": bpt_expiry,
        "brute_expiry": brute_expiry,
        "bpt_files": bpt_files,
        "brute_files": brute_files,
        "bpt_auth": bpt_auth,
        "brute_auth": brute_auth,
    }


def benchmark(base_snapshot: Dict[str, List[Dict[str, object]]], sizes: Sequence[int], runs: int = 1) -> List[Dict[str, float]]:
    rows: List[Dict[str, float]] = []
    for size in sizes:
        samples = [benchmark_once(base_snapshot, size) for _ in range(runs)]
        aggregated = {"size": size}
        for key in [name for name in samples[0] if name != "size"]:
            aggregated[key] = mean(sample[key] for sample in samples)
        rows.append(aggregated)
    return rows


def plot_metric(results: List[Dict[str, float]], slug: str, bpt_key: str, brute_key: str, title: str) -> None:
    if plt is None:
        return

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(12.5, 6.5))
    sizes = [row["size"] for row in results]
    bpt_values = [row[bpt_key] * 1000 for row in results]
    brute_values = [row[brute_key] * 1000 for row in results]

    ax.plot(sizes, bpt_values, marker="o", markersize=3.8, linewidth=2.0, label="B+ Tree", color="#2563eb")
    ax.plot(sizes, brute_values, marker="s", markersize=3.2, linewidth=1.8, linestyle="--", label="BruteForce", color="#dc2626")
    ax.fill_between(sizes, bpt_values, alpha=0.08, color="#2563eb")
    ax.fill_between(sizes, brute_values, alpha=0.08, color="#dc2626")
    ax.set_title(title, fontsize=16, fontweight="bold", pad=16)
    ax.set_xlabel("Dataset size (rows)", fontsize=11)
    ax.set_ylabel("Time (ms)", fontsize=11)
    ax.grid(True, alpha=0.28, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.yaxis.set_major_formatter(lambda value, _: f"{value:.3f}")
    ax.text(0.02, 0.96, f"Points: {len(results)}", transform=ax.transAxes, va="top", ha="left", fontsize=9, color="#4b5563")
    ax.legend(frameon=True, fancybox=True, shadow=True)
    fig.savefig(INTEGRATION / f"benchmark_{slug}.png", dpi=220, bbox_inches="tight")
    plt.close(fig)


def plot_speedups(results: List[Dict[str, float]]) -> None:
    if plt is None:
        return

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(12.5, 6.5))
    sizes = [row["size"] for row in results]
    series = [
        ("Outer lookup", "bpt_outer", "brute_outer", "#2563eb", "o"),
        ("Expiry range", "bpt_expiry", "brute_expiry", "#0f766e", "s"),
        ("File range", "bpt_files", "brute_files", "#d97706", "^"),
        ("Auth range", "bpt_auth", "brute_auth", "#dc2626", "D"),
    ]
    for label, bpt_key, brute_key, color, marker in series:
        ratios = [
            row[brute_key] / row[bpt_key] if row[bpt_key] else 0.0
            for row in results
        ]
        ax.plot(sizes, ratios, marker=marker, markersize=4, linewidth=2.0, color=color, label=label)

    ax.set_title("BlindDrop Path Speedup Ratios", fontsize=16, fontweight="bold", pad=16)
    ax.set_xlabel("Dataset size (rows)", fontsize=11)
    ax.set_ylabel("BruteForce / B+ Tree speedup (x)", fontsize=11)
    ax.grid(True, alpha=0.28, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.yaxis.set_major_formatter(lambda value, _: f"{value:.1f}x")
    ax.legend(ncol=2, frameon=True, fancybox=True, shadow=True)
    fig.savefig(INTEGRATION / "benchmark_path_speedup.png", dpi=220, bbox_inches="tight")
    plt.close(fig)


def plot_dashboard(results: List[Dict[str, float]]) -> None:
    if plt is None:
        return

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(15, 9))
    configs = [
        ("Outer Token Lookup", "bpt_outer", "brute_outer", "#2563eb", "#dc2626"),
        ("Expiry Range Scan", "bpt_expiry", "brute_expiry", "#0f766e", "#ef4444"),
        ("Vault File Range Scan", "bpt_files", "brute_files", "#d97706", "#7c3aed"),
        ("Auth Attempt Range Scan", "bpt_auth", "brute_auth", "#0891b2", "#be123c"),
    ]
    sizes = [row["size"] for row in results]

    for ax, (title, bpt_key, brute_key, bpt_color, brute_color) in zip(axes.flat, configs):
        bpt_values = [row[bpt_key] * 1000 for row in results]
        brute_values = [row[brute_key] * 1000 for row in results]
        ax.plot(sizes, bpt_values, marker="o", markersize=3.5, linewidth=2.0, color=bpt_color, label="B+ Tree")
        ax.plot(
            sizes,
            brute_values,
            marker="s",
            markersize=3.0,
            linewidth=1.8,
            linestyle="--",
            color=brute_color,
            label="BruteForce",
        )
        ax.fill_between(sizes, bpt_values, alpha=0.08, color=bpt_color)
        ax.fill_between(sizes, brute_values, alpha=0.08, color=brute_color)
        ax.set_title(title, fontsize=12, fontweight="bold")
        ax.grid(True, alpha=0.28, linestyle=":")
        ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
        ax.yaxis.set_major_formatter(lambda value, _: f"{value:.3f}")

    for ax in axes[1]:
        ax.set_xlabel("Dataset size (rows)", fontsize=10)
    for ax in axes[:, 0]:
        ax.set_ylabel("Time (ms)", fontsize=10)

    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, frameon=True, fancybox=True, shadow=True)
    fig.suptitle("Module A BlindDrop Path Benchmark Dashboard", fontsize=18, fontweight="bold", y=0.98)
    fig.text(0.5, 0.945, f"{len(results)} points from real exported BlindDrop data", ha="center", fontsize=10, color="#4b5563")
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(INTEGRATION / "benchmark_path_dashboard.png", dpi=220, bbox_inches="tight")
    plt.close(fig)


def summarize_speedups(results: List[Dict[str, float]]) -> List[str]:
    summaries = []
    labels = [
        ("Outer lookup", "bpt_outer", "brute_outer"),
        ("Expiry range", "bpt_expiry", "brute_expiry"),
        ("File range", "bpt_files", "brute_files"),
        ("Auth range", "bpt_auth", "brute_auth"),
    ]
    for label, bpt_key, brute_key in labels:
        ratios = [row[brute_key] / row[bpt_key] for row in results if row[bpt_key]]
        avg_ratio = mean(ratios)
        peak_ratio = max(ratios)
        summaries.append(f"- {label}: average speedup `{avg_ratio:.1f}x`, peak speedup `{peak_ratio:.1f}x`")
    return summaries


def save_outputs(results: List[Dict[str, float]], source_path: Path, runs: int) -> None:
    payload = {
        "sourceSnapshot": str(source_path),
        "metadata": {
            "points": len(results),
            "runs": runs,
            "sizeMin": results[0]["size"] if results else 0,
            "sizeMax": results[-1]["size"] if results else 0,
        },
        "sizes": [row["size"] for row in results],
        "results": results,
    }
    RESULTS_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    lines = [
        "# BlindDrop Path Benchmark Summary",
        "",
        "This benchmark compares the Module A B+ Tree wrapper against the brute-force baseline on BlindDrop-shaped access paths derived from the exported project snapshot.",
        "",
        f"Source snapshot: `{source_path}`",
        "",
        f"Measured points: `{len(results)}`",
        "",
        f"Runs per point: `{runs}`",
        "",
        "| Size | Load (B+) ms | Load (Brute) ms | Outer B+ ms | Outer Brute ms | Expiry B+ ms | Expiry Brute ms | File B+ ms | File Brute ms | Auth B+ ms | Auth Brute ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for row in results:
        lines.append(
            "| {size:,} | {bpt_load_ms:.4f} | {brute_load_ms:.4f} | {bpt_outer_ms:.4f} | {brute_outer_ms:.4f} | {bpt_expiry_ms:.4f} | {brute_expiry_ms:.4f} | {bpt_files_ms:.4f} | {brute_files_ms:.4f} | {bpt_auth_ms:.4f} | {brute_auth_ms:.4f} |".format(
                size=row["size"],
                bpt_load_ms=row["bpt_load"] * 1000,
                brute_load_ms=row["brute_load"] * 1000,
                bpt_outer_ms=row["bpt_outer"] * 1000,
                brute_outer_ms=row["brute_outer"] * 1000,
                bpt_expiry_ms=row["bpt_expiry"] * 1000,
                brute_expiry_ms=row["brute_expiry"] * 1000,
                bpt_files_ms=row["bpt_files"] * 1000,
                brute_files_ms=row["brute_files"] * 1000,
                bpt_auth_ms=row["bpt_auth"] * 1000,
                brute_auth_ms=row["brute_auth"] * 1000,
            )
        )

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- The benchmark starts from the real exported project snapshot and amplifies it into larger deterministic datasets.",
            "- Point lookups remain close to constant for the B+ Tree while brute-force time grows with dataset size.",
            "- Range scans widen the gap further because the tree can traverse linked leaves instead of rescanning the entire structure.",
            "- This gives a stronger Module A story than a purely synthetic integer-key benchmark.",
            "- The dashboard and speedup plots make the four domain paths easy to compare in one place.",
            "",
            "## Speedup Summary",
            "",
        ]
    )
    lines.extend(summarize_speedups(results))
    SUMMARY_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    plot_metric(results, "outer_lookup", "bpt_outer", "brute_outer", "Outer Token Lookup")
    plot_metric(results, "expiry_range", "bpt_expiry", "brute_expiry", "Expiry Range Scan")
    plot_metric(results, "file_range", "bpt_files", "brute_files", "Vault File Range Scan")
    plot_metric(results, "auth_range", "bpt_auth", "brute_auth", "Auth Attempt Range Scan")
    plot_speedups(results)
    plot_dashboard(results)


def main() -> None:
    random.seed(432)
    snapshot, source_path = load_snapshot()
    results = benchmark(snapshot, DEFAULT_SIZES, runs=DEFAULT_RUNS)
    save_outputs(results, source_path, runs=DEFAULT_RUNS)
    print(json.dumps({"sourceSnapshot": str(source_path), "results": results}, indent=2))


if __name__ == "__main__":
    main()
