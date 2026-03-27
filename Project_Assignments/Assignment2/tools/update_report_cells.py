import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "CS432_Track1_Submission" / "Module_A"
REPORT_PATH = ROOT / "report.ipynb"
DOMAIN_PATH = ROOT / "integration" / "benchmark_blinddrop_paths.json"
DETAILED_PATH = ROOT / "evidence" / "detailed_benchmark_results.json"
COMBINED_RESULTS_PATH = ROOT / "evidence" / "benchmark_results.json"
BENCHMARK_SUMMARY_PATH = ROOT / "evidence" / "summaries" / "benchmark_summary.md"
EVIDENCE_SUMMARY_PATH = ROOT / "evidence" / "summaries" / "evidence_summary.md"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def format_domain_section(domain):
    rows = domain["results"]
    by_size = {row["size"]: row for row in rows}
    outer_speedups = [row["brute_outer"] / row["bpt_outer"] for row in rows if row["bpt_outer"]]
    expiry_speedups = [row["brute_expiry"] / row["bpt_expiry"] for row in rows if row["bpt_expiry"]]
    file_speedups = [row["brute_files"] / row["bpt_files"] for row in rows if row["bpt_files"]]
    auth_speedups = [row["brute_auth"] / row["bpt_auth"] for row in rows if row["bpt_auth"]]

    return f"""## 7.1 Domain Benchmark Results

The domain benchmark contains **{domain['metadata']['points']} measured points** from **{domain['metadata']['sizeMin']}** to **{domain['metadata']['sizeMax']}** rows.

| Path | Average speedup | Peak speedup |
| --- | ---: | ---: |
| Outer lookup | {statistics.mean(outer_speedups):.1f}x | {max(outer_speedups):.1f}x |
| Expiry range | {statistics.mean(expiry_speedups):.1f}x | {max(expiry_speedups):.1f}x |
| File range | {statistics.mean(file_speedups):.1f}x | {max(file_speedups):.1f}x |
| Auth range | {statistics.mean(auth_speedups):.1f}x | {max(auth_speedups):.1f}x |

### Checkpoint values from the packaged run

| Size | Outer B+ ms | Outer Brute ms | Expiry B+ ms | Expiry Brute ms | File B+ ms | File Brute ms | Auth B+ ms | Auth Brute ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | {by_size[500]['bpt_outer'] * 1000:.4f} | {by_size[500]['brute_outer'] * 1000:.4f} | {by_size[500]['bpt_expiry'] * 1000:.4f} | {by_size[500]['brute_expiry'] * 1000:.4f} | {by_size[500]['bpt_files'] * 1000:.4f} | {by_size[500]['brute_files'] * 1000:.4f} | {by_size[500]['bpt_auth'] * 1000:.4f} | {by_size[500]['brute_auth'] * 1000:.4f} |
| 9,500 | {by_size[9500]['bpt_outer'] * 1000:.4f} | {by_size[9500]['brute_outer'] * 1000:.4f} | {by_size[9500]['bpt_expiry'] * 1000:.4f} | {by_size[9500]['brute_expiry'] * 1000:.4f} | {by_size[9500]['bpt_files'] * 1000:.4f} | {by_size[9500]['brute_files'] * 1000:.4f} | {by_size[9500]['bpt_auth'] * 1000:.4f} | {by_size[9500]['brute_auth'] * 1000:.4f} |
| 19,500 | {by_size[19500]['bpt_outer'] * 1000:.4f} | {by_size[19500]['brute_outer'] * 1000:.4f} | {by_size[19500]['bpt_expiry'] * 1000:.4f} | {by_size[19500]['brute_expiry'] * 1000:.4f} | {by_size[19500]['bpt_files'] * 1000:.4f} | {by_size[19500]['brute_files'] * 1000:.4f} | {by_size[19500]['bpt_auth'] * 1000:.4f} | {by_size[19500]['brute_auth'] * 1000:.4f} |

### Interpretation

- outer-token lookup stays nearly flat for the B+ Tree while brute-force lookup grows with size
- expiry and file range scans show larger gains because the tree can jump to the start key and then continue through linked leaves
- auth-range still improves clearly, though the gap is smaller than the file path because of the distribution of session timelines and posting-list usage
"""


def format_detailed_section(detailed):
    rows = detailed["metrics"]
    by_size = {row["size"]: row for row in rows}
    random_last = detailed["random_workload"][-1]
    memory_first = detailed["memory_kb"][0]
    memory_last = detailed["memory_kb"][-1]
    delete_percent = int(detailed["metadata"]["memory_delete_fraction"] * 100)

    return f"""## 7.2 Detailed Benchmark Results

The detailed benchmark contains **{detailed['metadata']['points']} measured points** from **{detailed['metadata']['sizes'][0]:,}** to **{detailed['metadata']['sizes'][-1]:,}** rows, with **{detailed['metadata']['repeats']} averaged runs per point**.

The selective range benchmark now uses **{detailed['metadata']['range_window_count']} fixed-width windows** per dataset, with the width set to roughly **1% of the dataset size**. That makes the range graph a better reflection of practical ordered retrieval than a near full-table scan.

### Checkpoint values from the packaged run

| Size | Insert B+ ms | Insert Brute ms | Search B+ ms | Search Brute ms | Delete B+ ms | Delete Brute ms | Range B+ ms | Range Brute ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | {by_size[500]['bpt_insert_ms']:.3f} | {by_size[500]['bf_insert_ms']:.3f} | {by_size[500]['bpt_search_ms']:.3f} | {by_size[500]['bf_search_ms']:.3f} | {by_size[500]['bpt_delete_ms']:.3f} | {by_size[500]['bf_delete_ms']:.3f} | {by_size[500]['bpt_range_ms']:.3f} | {by_size[500]['bf_range_ms']:.3f} |
| 10,500 | {by_size[10500]['bpt_insert_ms']:.3f} | {by_size[10500]['bf_insert_ms']:.3f} | {by_size[10500]['bpt_search_ms']:.3f} | {by_size[10500]['bf_search_ms']:.3f} | {by_size[10500]['bpt_delete_ms']:.3f} | {by_size[10500]['bf_delete_ms']:.3f} | {by_size[10500]['bpt_range_ms']:.3f} | {by_size[10500]['bf_range_ms']:.3f} |
| 21,500 | {by_size[21500]['bpt_insert_ms']:.3f} | {by_size[21500]['bf_insert_ms']:.3f} | {by_size[21500]['bpt_search_ms']:.3f} | {by_size[21500]['bf_search_ms']:.3f} | {by_size[21500]['bpt_delete_ms']:.3f} | {by_size[21500]['bf_delete_ms']:.3f} | {by_size[21500]['bpt_range_ms']:.3f} | {by_size[21500]['bf_range_ms']:.3f} |

### Mixed workload and memory checkpoints

At **{random_last['ops']:,} mixed operations**, the B+ Tree completes the workload in **{random_last['bpt_ms']:.3f} ms** versus **{random_last['bf_ms']:.3f} ms** for the brute-force baseline, which is approximately **{(random_last['bf_ms'] / random_last['bpt_ms']):.1f}x faster** in this packaged run.

The memory evidence is now split into three views so the report does not conflate retained size with allocator peaks:

- `retained_memory_after_insert.png`: retained structure size after insert using a recursive object-size walk
- `peak_python_allocations.png`: `tracemalloc` peak Python allocations during the build phase
- `retained_memory_after_delete.png`: retained structure size after deleting **{delete_percent}%** of keys

Checkpoint values for retained structure size after insert:

- at **{memory_first['size']:,} records**, B+ Tree retained size is **{memory_first['bpt_retained_insert_kb']:.2f} KB** versus **{memory_first['bf_retained_insert_kb']:.2f} KB**
- at **{memory_last['size']:,} records**, B+ Tree retained size is **{memory_last['bpt_retained_insert_kb']:.2f} KB** versus **{memory_last['bf_retained_insert_kb']:.2f} KB**

Checkpoint values for peak Python allocations during build:

- at **{memory_first['size']:,} records**, B+ Tree peak allocation is **{memory_first['bpt_peak_kb']:.2f} KB** versus **{memory_first['bf_peak_kb']:.2f} KB**
- at **{memory_last['size']:,} records**, B+ Tree peak allocation is **{memory_last['bpt_peak_kb']:.2f} KB** versus **{memory_last['bf_peak_kb']:.2f} KB**

In this Python implementation the brute-force baseline stays heavier because it stores one tuple object per row in a growing list, while the B+ Tree stores keys and values inside shared node lists. The report should therefore describe the observed result directly instead of assuming the tree must consume more memory.
"""


def write_combined_results(domain, detailed):
    payload = {
        "sourceSnapshot": str((ROOT / "database_export.json").resolve()),
        "domainBenchmark": domain,
        "detailedBenchmark": detailed,
    }
    COMBINED_RESULTS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_benchmark_summary(domain, detailed):
    domain_rows = domain["results"]
    outer_speedups = [row["brute_outer"] / row["bpt_outer"] for row in domain_rows if row["bpt_outer"]]
    expiry_speedups = [row["brute_expiry"] / row["bpt_expiry"] for row in domain_rows if row["bpt_expiry"]]
    file_speedups = [row["brute_files"] / row["bpt_files"] for row in domain_rows if row["bpt_files"]]
    auth_speedups = [row["brute_auth"] / row["bpt_auth"] for row in domain_rows if row["bpt_auth"]]
    memory_first = detailed["memory_kb"][0]
    memory_last = detailed["memory_kb"][-1]

    text = f"""# Module A Benchmark Summary

This summary explains the benchmark evidence packaged in:

- `benchmark_console.txt`
- `benchmark_results.json`
- `detailed_benchmark_results.json`
- the PNG plots in `evidence/`
- `Module_A/integration/reports/blinddrop_paths_benchmark.md`

## Source dataset

The current benchmark package is anchored to:

- `Project_432/backend/database_export.json`

That export provides the real BlindDrop-shaped rows used by the integration layer. The domain benchmark amplifies those rows into larger deterministic datasets so the benchmark stays project-aligned while still showing scaling behavior.

## Benchmark layers

### Domain benchmark

The domain benchmark is produced by `integration/benchmark_blinddrop_paths.py`.

It currently includes:

- 20 measured points from 500 to 19,500 rows
- outer-token lookup
- expiry range scan
- vault-file range scan
- auth-attempt range scan
- per-path line charts
- `path_speedup_benchmark.png`

Headline outcome from the packaged run:

- outer lookup average speedup: `{statistics.mean(outer_speedups):.1f}x`
- expiry range average speedup: `{statistics.mean(expiry_speedups):.1f}x`
- file range average speedup: `{statistics.mean(file_speedups):.1f}x`
- auth range average speedup: `{statistics.mean(auth_speedups):.1f}x`

### Detailed benchmark

The detailed benchmark is produced by `integration/benchmark_detailed.py`.

It currently includes:

- 22 measured points from 500 to 21,500 rows
- 2 averaged runs per point
- insertion, search, deletion, and selective range-query plots
- mixed random-workload plot
- speedup plot
- retained-size memory plot
- peak-allocation memory plot
- post-delete memory plot
- `memory_dashboard.png`

## Interpretation

Across both benchmark layers, the same performance pattern is visible:

- exact lookup cost remains comparatively stable for the B+ Tree as the dataset grows
- brute-force lookup time grows steadily with dataset size
- range-oriented paths show even larger gains because the B+ Tree can traverse ordered leaves
- the detailed benchmark confirms the same scaling trend across generic insert/search/delete/range workloads
- memory is now reported in separate retained-size and peak-allocation views so the package does not mix long-lived structure size with temporary allocator spikes
- in this implementation, the brute-force list remains heavier in both retained-size checkpoints:
  - `{memory_first['size']:,}` records: `{memory_first['bf_retained_insert_kb']:.2f} KB` vs `{memory_first['bpt_retained_insert_kb']:.2f} KB`
  - `{memory_last['size']:,}` records: `{memory_last['bf_retained_insert_kb']:.2f} KB` vs `{memory_last['bpt_retained_insert_kb']:.2f} KB`

## Submission significance

This benchmark package is stronger than the earlier lightweight draft because it now combines:

- a project-aligned benchmark driven by the real exported backend dataset
- denser plots with 20-point and 22-point sweeps
- dashboard visualizations that compare multiple operations in one figure
- a refreshed aggregate JSON file, `benchmark_results.json`, that now matches the current detailed benchmark output
"""
    BENCHMARK_SUMMARY_PATH.write_text(text, encoding="utf-8")


def write_evidence_summary():
    text = """# Module A Evidence Summary

This summary ties together the complete Module A evidence package.

## Evidence inventory

### Demo

- `demo_console.txt`
- `demo_output.json`

### Parity and rebuild

- `parity_console.txt`
- `parity_output.json`
- `Module_A/evidence/summaries/parity_summary.md`
- `Module_A/integration/reports/db_index_parity_report.md`

### Benchmark

- `benchmark_console.txt`
- `benchmark_results.json`
- `Module_A/evidence/summaries/benchmark_summary.md`
- `Module_A/integration/reports/blinddrop_paths_benchmark.md`
- `Module_A/integration/path_speedup_benchmark.png`
- `speedup_comparison.png`
- `insertion_benchmark.png`
- `search_benchmark.png`
- `deletion_benchmark.png`
- `range_benchmark.png`
- `random_workload_benchmark.png`
- `memory_dashboard.png`
- `retained_memory_after_insert.png`
- `peak_python_allocations.png`
- `retained_memory_after_delete.png`

## What this complete package proves

- the custom Python B+ Tree is implemented and functional
- the tree is wrapped in a lightweight DB-style abstraction
- the tree can be demonstrated on BlindDrop-shaped lookup and range paths
- parity, rollback, lazy repair, and rebuild can be defended
- the B+ Tree compares favorably against the brute-force baseline
- the package includes both textual and visual evidence for the final submission
- the visual evidence now includes separate retained-memory and peak-allocation plots rather than one ambiguous memory graph

## Final defense line

`Module A is packaged here as a complete from-scratch indexing submission: core B+ Tree implementation, database wrapper, benchmark suite, visualization support, project-shaped integration layer, and parity/rebuild proof.`
"""
    EVIDENCE_SUMMARY_PATH.write_text(text, encoding="utf-8")


def main():
    report = load_json(REPORT_PATH)
    domain = load_json(DOMAIN_PATH)
    detailed = load_json(DETAILED_PATH)

    report["cells"][13]["source"] = format_domain_section(domain).splitlines(keepends=True)
    report["cells"][15]["source"] = format_detailed_section(detailed).splitlines(keepends=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    write_combined_results(domain, detailed)
    write_benchmark_summary(domain, detailed)
    write_evidence_summary()
    print(f"Updated notebook, combined JSON, and benchmark summaries in {ROOT}")


if __name__ == "__main__":
    main()
