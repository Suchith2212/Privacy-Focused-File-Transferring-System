"""Generate markdown tables and plots from the packaged Module B benchmark snapshot."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[1]
BENCH_DIR = ROOT / "evidence" / "benchmark_evidence"
RAW_PATH = BENCH_DIR / "benchmark_results.txt"
JSON_PATH = BENCH_DIR / "benchmark_results.json"
CSV_PATH = BENCH_DIR / "benchmark_comparison.csv"
SUMMARY_PATH = BENCH_DIR / "benchmark_summary.md"
PLAN_TABLE_PATH = BENCH_DIR / "explain_plan_table.md"
TIME_PLOT_PATH = BENCH_DIR / "duration_comparison.png"
SPEEDUP_PLOT_PATH = BENCH_DIR / "speedup_comparison.png"
ROWS_PLOT_PATH = BENCH_DIR / "rows_examined.png"


def load_payload() -> dict:
    for encoding in ("utf-8", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return json.loads(RAW_PATH.read_text(encoding=encoding))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("utf-8", b"", 0, 1, f"Could not decode {RAW_PATH}")


def build_rows(payload: dict) -> list[dict]:
    comparison = payload["comparison"]
    return [
        {
            "stage": "Baseline full scan",
            "duration_ms": float(comparison["fullTableScan"]["durationMs"]),
            "scan_type": comparison["fullTableScan"]["scanType"],
            "key": comparison["fullTableScan"]["key"] or "none",
            "rows": int(comparison["fullTableScan"]["rows"]),
            "extra": comparison["fullTableScan"]["extra"] or "",
        },
        {
            "stage": "Composite lookup index",
            "duration_ms": float(comparison["compositeIndex"]["durationMs"]),
            "scan_type": comparison["compositeIndex"]["scanType"],
            "key": comparison["compositeIndex"]["key"] or "none",
            "rows": int(comparison["compositeIndex"]["rows"]),
            "extra": comparison["compositeIndex"]["extra"] or "",
        },
        {
            "stage": "Composite + covering comparison",
            "duration_ms": float(comparison["coveringIndex"]["durationMs"]),
            "scan_type": comparison["coveringIndex"]["scanType"],
            "key": comparison["coveringIndex"]["key"] or "none",
            "rows": int(comparison["coveringIndex"]["rows"]),
            "extra": comparison["coveringIndex"]["extra"] or "",
        },
    ]


def write_json_copy(payload: dict) -> None:
    JSON_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_csv(rows: list[dict]) -> None:
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["stage", "duration_ms", "scan_type", "key", "rows", "extra"],
        )
        writer.writeheader()
        writer.writerows(rows)


def write_summary(rows: list[dict]) -> None:
    baseline = rows[0]["duration_ms"]
    composite_speedup = baseline / rows[1]["duration_ms"]
    covering_speedup = baseline / rows[2]["duration_ms"]
    SUMMARY_PATH.write_text(
        "\n".join(
            [
                "# Benchmark Summary",
                "",
                "This summary was generated from the packaged `benchmark_results.txt` snapshot.",
                "",
                "## Result table",
                "",
                "| Stage | Duration (ms) | Plan type | Key used | Rows | Extra |",
                "| --- | ---: | --- | --- | ---: | --- |",
                *[
                    f"| {row['stage']} | {row['duration_ms']:.4f} | `{row['scan_type']}` | `{row['key']}` | {row['rows']} | `{row['extra']}` |"
                    for row in rows
                ],
                "",
                "## Interpretation",
                "",
                f"- baseline full scan -> composite lookup index: **{composite_speedup:.2f}x faster**",
                f"- baseline full scan -> composite + covering comparison stage: **{covering_speedup:.2f}x faster**",
                "- in the captured EXPLAIN output, MySQL still selected `idx_portfolio_benchmark_lookup` even after the covering index was added",
                "- the result validates the production design of the composite lookup index for the protected portfolio query",
            ]
        ),
        encoding="utf-8",
    )


def write_plan_table(payload: dict) -> None:
    plans = [
        ("Baseline full scan", payload["beforePlan"][0]),
        ("Composite lookup index", payload["afterPlan"][0]),
        ("Composite + covering comparison", payload["coveringPlan"][0]),
    ]
    PLAN_TABLE_PATH.write_text(
        "\n".join(
            [
                "# EXPLAIN Plan Table",
                "",
                "| Stage | type | possible_keys | key | rows | Extra |",
                "| --- | --- | --- | --- | ---: | --- |",
                *[
                    f"| {name} | `{plan.get('type')}` | `{plan.get('possible_keys')}` | `{plan.get('key')}` | {plan.get('rows')} | `{plan.get('Extra')}` |"
                    for name, plan in plans
                ],
            ]
        ),
        encoding="utf-8",
    )


def build_plot(path: Path, title: str, labels: list[str], values: list[float], ylabel: str, color: str) -> None:
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(9, 5.5))
    bars = ax.bar(labels, values, color=color, width=0.55)
    ax.set_title(title, fontsize=14, fontweight="bold", pad=16)
    ax.set_ylabel(ylabel, fontsize=11)
    ax.grid(axis="y", linestyle=":", alpha=0.35)
    for bar, value in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            f"{value:.2f}",
            ha="center",
            va="bottom",
            fontsize=10,
        )
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def generate_plots(rows: list[dict]) -> None:
    labels = [row["stage"] for row in rows]
    durations = [row["duration_ms"] for row in rows]
    baseline = durations[0]
    speedups = [1.0, baseline / durations[1], baseline / durations[2]]
    row_counts = [row["rows"] for row in rows]

    build_plot(
        TIME_PLOT_PATH,
        "Portfolio Query Duration Comparison",
        labels,
        durations,
        "Duration (ms)",
        "#2563eb",
    )
    build_plot(
        SPEEDUP_PLOT_PATH,
        "Speedup Relative To Full Table Scan",
        labels,
        speedups,
        "Speedup (x)",
        "#16a34a",
    )
    build_plot(
        ROWS_PLOT_PATH,
        "Rows Examined By EXPLAIN Plan",
        labels,
        [float(value) for value in row_counts],
        "Rows",
        "#dc2626",
    )


def main() -> None:
    payload = load_payload()
    rows = build_rows(payload)
    write_json_copy(payload)
    write_csv(rows)
    write_summary(rows)
    write_plan_table(payload)
    generate_plots(rows)
    print(f"Generated benchmark assets in {BENCH_DIR}")


if __name__ == "__main__":
    main()

