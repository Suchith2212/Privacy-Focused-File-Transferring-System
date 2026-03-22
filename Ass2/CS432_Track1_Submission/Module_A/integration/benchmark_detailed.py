import json
import math
import random
import statistics
import sys
import time
import tracemalloc
import gc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from database.bplustree import BPlusTree
from database.bruteforce import BruteForceDB

EVIDENCE = ROOT / "evidence"
EVIDENCE.mkdir(exist_ok=True)

SIZES = list(range(500, 22500, 1000))  # 22 points
REPEATS = 2
RESULTS = []
RANGE_WINDOW_COUNT = 32
MEMORY_DELETE_FRACTION = 0.2


def time_op(fn):
    start = time.perf_counter()
    fn()
    return (time.perf_counter() - start) * 1000


def apply_many_insert(structure, keys):
    for key in keys:
        structure.insert(key, key)


def apply_many_search(structure, keys):
    for key in keys:
        structure.search(key)


def apply_many_delete(structure, keys):
    for key in keys:
        structure.delete(key)


def build_range_windows(size: int, window_count: int = RANGE_WINDOW_COUNT):
    if size <= 0:
        return []
    width = max(25, size // 100)
    step = max(1, size // window_count)
    windows = []
    start = 0
    while start < size and len(windows) < window_count:
        end = min(size - 1, start + width)
        windows.append((start, end))
        start += step
    return windows


def apply_many_ranges(structure, windows):
    for start, end in windows:
        structure.range_query(start, end)


def deep_size_kb(obj) -> float:
    seen = set()
    default_size = sys.getsizeof(0)

    def sizeof(current):
        obj_id = id(current)
        if obj_id in seen:
            return 0
        seen.add(obj_id)
        size = sys.getsizeof(current, default_size)
        for referent in gc.get_referents(current):
            if isinstance(referent, type):
                continue
            size += sizeof(referent)
        return size

    return round(sizeof(obj) / 1024, 2)


def measure(size: int) -> None:
    print(f"Measuring size: {size}...", flush=True)
    metrics = {"size": size}
    random.seed(42 + size)

    for _ in range(REPEATS):
        gc.collect()
        keys = list(range(size))
        random.shuffle(keys)

        bpt = BPlusTree(order=32)
        bf = BruteForceDB()

        metrics.setdefault("bpt_insert_ms", []).append(time_op(lambda: apply_many_insert(bpt, keys)))
        metrics.setdefault("bf_insert_ms", []).append(time_op(lambda: apply_many_insert(bf, keys)))

        samples = random.sample(keys, min(320, size))
        metrics.setdefault("bpt_search_ms", []).append(time_op(lambda: apply_many_search(bpt, samples)))
        metrics.setdefault("bf_search_ms", []).append(time_op(lambda: apply_many_search(bf, samples)))

        range_windows = build_range_windows(size)
        metrics.setdefault("range_window_count", []).append(len(range_windows))
        metrics.setdefault("range_window_width", []).append(max(0, range_windows[0][1] - range_windows[0][0] + 1 if range_windows else 0))
        metrics.setdefault("bpt_range_ms", []).append(time_op(lambda: apply_many_ranges(bpt, range_windows)))
        metrics.setdefault("bf_range_ms", []).append(time_op(lambda: apply_many_ranges(bf, range_windows)))

        delete_keys = samples[: min(60, len(samples))]
        metrics.setdefault("bpt_delete_ms", []).append(time_op(lambda: apply_many_delete(bpt, delete_keys)))
        metrics.setdefault("bf_delete_ms", []).append(time_op(lambda: apply_many_delete(bf, delete_keys)))

    for key in list(metrics.keys()):
        if key == "size":
            continue
        metrics[key] = round(statistics.mean(metrics[key]), 3)

    RESULTS.append(metrics)


def measure_memory():
    print("Measuring memory...", flush=True)
    records = []
    mem_sizes = list(range(1000, 23000, 2500))
    for size in mem_sizes:
        data = {"size": size}
        keys = list(range(size))
        delete_count = max(1, int(size * MEMORY_DELETE_FRACTION))
        delete_keys = keys[:delete_count]
        for label, cls in [("bpt", BPlusTree), ("bf", BruteForceDB)]:
            gc.collect()
            tracemalloc.start()
            tracemalloc.reset_peak()
            structure = cls(order=32) if label == "bpt" else cls()
            for key in keys:
                structure.insert(key, key)
            _, peak = tracemalloc.get_traced_memory()
            tracemalloc.stop()
            gc.collect()
            data[f"{label}_peak_kb"] = round(peak / 1024, 2)
            data[f"{label}_retained_insert_kb"] = deep_size_kb(structure)
            for key in delete_keys:
                structure.delete(key)
            gc.collect()
            data[f"{label}_retained_delete_kb"] = deep_size_kb(structure)
        records.append(data)
    return records


def random_workload():
    print("Measuring random workload...", flush=True)
    results = []
    random.seed(123)
    max_steps = list(range(1000, 23000, 2500))
    for ops in max_steps:
        bpt = BPlusTree(order=32)
        bf = BruteForceDB()
        bpt_time = 0.0
        bf_time = 0.0
        universe = list(range(ops * 3))
        for _ in range(ops):
            op = random.choice(["insert", "search", "delete"])
            key = random.choice(universe)

            start = time.perf_counter()
            if op == "insert":
                bpt.insert(key, key)
            elif op == "search":
                bpt.search(key)
            else:
                bpt.delete(key)
            bpt_time += (time.perf_counter() - start) * 1000

            start = time.perf_counter()
            if op == "insert":
                bf.insert(key, key)
            elif op == "search":
                bf.search(key)
            else:
                bf.delete(key)
            bf_time += (time.perf_counter() - start) * 1000

        results.append({"ops": ops, "bpt_ms": round(bpt_time, 3), "bf_ms": round(bf_time, 3)})
    return results


def plot_metric(data, key_bpt, key_bf, title, filename):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(11.5, 6.5))
    x = [row["size"] for row in data]
    y_bpt = [row[key_bpt] for row in data]
    y_bf = [row[key_bf] for row in data]

    ax.plot(x, y_bpt, marker="o", markersize=3.8, linewidth=2.0, label="B+ Tree", color="#2563eb")
    ax.plot(x, y_bf, marker="s", markersize=3.2, linewidth=1.8, linestyle="--", label="BruteForce", color="#dc2626")
    ax.fill_between(x, y_bpt, alpha=0.08, color="#2563eb")
    ax.fill_between(x, y_bf, alpha=0.08, color="#dc2626")
    ax.set_title(title, fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Number of records", fontsize=11)
    ax.set_ylabel("milliseconds", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / filename
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_operation_dashboard(data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 2, figsize=(15, 9))
    configs = [
        ("Insertion Time", "bpt_insert_ms", "bf_insert_ms", "#2563eb", "#dc2626"),
        ("Search Time", "bpt_search_ms", "bf_search_ms", "#0f766e", "#ef4444"),
        ("Deletion Time", "bpt_delete_ms", "bf_delete_ms", "#d97706", "#7c3aed"),
        ("Selective Range Query Time", "bpt_range_ms", "bf_range_ms", "#0891b2", "#be123c"),
    ]
    x = [row["size"] for row in data]

    for ax, (title, key_bpt, key_bf, color_bpt, color_bf) in zip(axes.flat, configs):
        y_bpt = [row[key_bpt] for row in data]
        y_bf = [row[key_bf] for row in data]
        ax.plot(x, y_bpt, marker="o", markersize=3.6, linewidth=2.0, color=color_bpt, label="B+ Tree")
        ax.plot(x, y_bf, marker="s", markersize=3.0, linewidth=1.8, linestyle="--", color=color_bf, label="BruteForce")
        ax.fill_between(x, y_bpt, alpha=0.08, color=color_bpt)
        ax.fill_between(x, y_bf, alpha=0.08, color=color_bf)
        ax.set_title(title, fontsize=12, fontweight="bold")
        ax.grid(True, alpha=0.3, linestyle=":")
        ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")

    for ax in axes[1]:
        ax.set_xlabel("Number of records", fontsize=10)
    for ax in axes[:, 0]:
        ax.set_ylabel("milliseconds", fontsize=10)

    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, frameon=True, fancybox=True, shadow=True)
    fig.suptitle("Detailed Module A Performance Dashboard", fontsize=18, fontweight="bold", y=0.98)
    fig.text(0.5, 0.945, f"{len(data)} benchmark points, {REPEATS} averaged runs", ha="center", fontsize=10, color="#4b5563")
    fig.tight_layout(rect=(0, 0, 1, 0.93))

    path = EVIDENCE / "benchmark_operation_dashboard.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_random_workload(data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(11.5, 6.5))
    x = [row["ops"] for row in data]
    y_bpt = [row["bpt_ms"] for row in data]
    y_bf = [row["bf_ms"] for row in data]

    ax.plot(x, y_bpt, marker="o", markersize=5, linewidth=2, label="B+ Tree", color="#10b981")
    ax.plot(x, y_bf, marker="s", markersize=4.5, linewidth=2, linestyle="--", label="BruteForce", color="#fb923c")
    ax.fill_between(x, y_bpt, alpha=0.08, color="#10b981")
    ax.fill_between(x, y_bf, alpha=0.08, color="#fb923c")
    ax.set_title("Random Mixed Workload", fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Number of operations", fontsize=11)
    ax.set_ylabel("Total time (ms)", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / "benchmark_random_workload.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_speedup(data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    sizes = [row["size"] for row in data]
    speedups_insert = [
        row["bf_insert_ms"] / row["bpt_insert_ms"] if row["bpt_insert_ms"] else math.nan
        for row in data
    ]
    speedups_search = [
        row["bf_search_ms"] / row["bpt_search_ms"] if row["bpt_search_ms"] else math.nan
        for row in data
    ]
    speedups_range = [
        row["bf_range_ms"] / row["bpt_range_ms"] if row["bpt_range_ms"] else math.nan
        for row in data
    ]

    fig, ax = plt.subplots(figsize=(11.5, 6.5))
    ax.plot(sizes, speedups_insert, marker="o", markersize=4, color="#2563eb", linewidth=2, label="Insert speedup")
    ax.plot(sizes, speedups_search, marker="s", markersize=3.5, color="#16a34a", linewidth=2, label="Search speedup")
    ax.plot(sizes, speedups_range, marker="^", markersize=3.5, color="#d97706", linewidth=2, label="Range speedup")
    ax.set_title("BruteForce / B+ Tree Speedup Ratios", fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Number of records", fontsize=11)
    ax.set_ylabel("Speedup ratio (x)", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.yaxis.set_major_formatter(lambda value, _: f"{value:.1f}x")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / "benchmark_speedup.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_memory_usage(memory_data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(11.5, 6.5))

    ax.plot(
        [row["size"] for row in memory_data],
        [row["bpt_retained_insert_kb"] for row in memory_data],
        marker="o",
        label="B+ Tree",
        color="#2563eb",
        linewidth=2,
    )
    ax.plot(
        [row["size"] for row in memory_data],
        [row["bf_retained_insert_kb"] for row in memory_data],
        marker="x",
        linestyle="--",
        label="BruteForce",
        color="#dc2626",
        linewidth=2,
    )

    ax.set_title("Retained Structure Size After Insert", fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Number of records", fontsize=11)
    ax.set_ylabel("Approximate retained size (KB)", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / "benchmark_memory.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_memory_peaks(memory_data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(11.5, 6.5))

    ax.plot(
        [row["size"] for row in memory_data],
        [row["bpt_peak_kb"] for row in memory_data],
        marker="o",
        label="B+ Tree",
        color="#0f766e",
        linewidth=2,
    )
    ax.plot(
        [row["size"] for row in memory_data],
        [row["bf_peak_kb"] for row in memory_data],
        marker="s",
        linestyle="--",
        label="BruteForce",
        color="#ea580c",
        linewidth=2,
    )

    ax.set_title("Peak Python Allocations During Build", fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Number of records", fontsize=11)
    ax.set_ylabel("Peak allocations (KB)", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / "benchmark_memory_peak_allocations.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_memory_after_delete(memory_data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(11.5, 6.5))

    ax.plot(
        [row["size"] for row in memory_data],
        [row["bpt_retained_delete_kb"] for row in memory_data],
        marker="o",
        label="B+ Tree",
        color="#7c3aed",
        linewidth=2,
    )
    ax.plot(
        [row["size"] for row in memory_data],
        [row["bf_retained_delete_kb"] for row in memory_data],
        marker="^",
        linestyle="--",
        label="BruteForce",
        color="#be123c",
        linewidth=2,
    )

    ax.set_title("Retained Structure Size After 20% Deletes", fontsize=14, fontweight="bold", pad=20)
    ax.set_xlabel("Original number of records", fontsize=11)
    ax.set_ylabel("Approximate retained size (KB)", fontsize=11)
    ax.grid(True, alpha=0.3, linestyle=":")
    ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")
    ax.legend(frameon=True, fancybox=True, shadow=True)

    path = EVIDENCE / "benchmark_memory_after_delete.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def plot_memory_dashboard(memory_data):
    import matplotlib.pyplot as plt

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(1, 3, figsize=(17, 5.8))
    x = [row["size"] for row in memory_data]
    configs = [
        ("Retained After Insert", "bpt_retained_insert_kb", "bf_retained_insert_kb", "#2563eb", "#dc2626"),
        ("Peak During Build", "bpt_peak_kb", "bf_peak_kb", "#0f766e", "#ea580c"),
        ("Retained After Deletes", "bpt_retained_delete_kb", "bf_retained_delete_kb", "#7c3aed", "#be123c"),
    ]

    for ax, (title, bpt_key, bf_key, bpt_color, bf_color) in zip(axes, configs):
        ax.plot(x, [row[bpt_key] for row in memory_data], marker="o", linewidth=2, color=bpt_color, label="B+ Tree")
        ax.plot(
            x,
            [row[bf_key] for row in memory_data],
            marker="s",
            linewidth=1.8,
            linestyle="--",
            color=bf_color,
            label="BruteForce",
        )
        ax.set_title(title, fontsize=11.5, fontweight="bold")
        ax.grid(True, alpha=0.3, linestyle=":")
        ax.xaxis.set_major_formatter(lambda value, _: f"{int(value):,}")

    axes[0].set_ylabel("KB", fontsize=10)
    for ax in axes:
        ax.set_xlabel("Records", fontsize=10)

    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=2, frameon=True, fancybox=True, shadow=True)
    fig.suptitle("Module A Memory Comparison Dashboard", fontsize=17, fontweight="bold", y=0.99)
    fig.text(
        0.5,
        0.935,
        "Retained size uses a recursive object-size walk; peak build uses tracemalloc; delete phase removes 20% of keys.",
        ha="center",
        fontsize=9.5,
        color="#4b5563",
    )
    fig.tight_layout(rect=(0, 0, 1, 0.9))

    path = EVIDENCE / "benchmark_memory_dashboard.png"
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path.name


def main():
    for size in SIZES:
        measure(size)

    memory = measure_memory()
    random_results = random_workload()

    plots = {
        "operations_dashboard": plot_operation_dashboard(RESULTS),
        "insertion": plot_metric(RESULTS, "bpt_insert_ms", "bf_insert_ms", "Insertion Time", "benchmark_insertion.png"),
        "search": plot_metric(RESULTS, "bpt_search_ms", "bf_search_ms", "Search Time", "benchmark_search.png"),
        "deletion": plot_metric(RESULTS, "bpt_delete_ms", "bf_delete_ms", "Deletion Time", "benchmark_deletion.png"),
        "range": plot_metric(RESULTS, "bpt_range_ms", "bf_range_ms", "Selective Range Query Time", "benchmark_range.png"),
        "random_workload": plot_random_workload(random_results),
        "speedup": plot_speedup(RESULTS),
        "memory": plot_memory_usage(memory),
        "memory_peak_allocations": plot_memory_peaks(memory),
        "memory_after_delete": plot_memory_after_delete(memory),
        "memory_dashboard": plot_memory_dashboard(memory),
    }

    payload = {
        "metadata": {
            "points": len(RESULTS),
            "sizes": SIZES,
            "repeats": REPEATS,
            "range_window_count": RANGE_WINDOW_COUNT,
            "range_window_rule": "fixed-width selective windows at roughly 1% of dataset size",
            "memory_measurement": "benchmark_memory.png reports retained structure size after insert using a recursive object-size walk",
            "memory_peak_measurement": "benchmark_memory_peak_allocations.png reports tracemalloc peak Python allocations during build",
            "memory_delete_measurement": f"benchmark_memory_after_delete.png reports retained structure size after deleting {int(MEMORY_DELETE_FRACTION * 100)}% of keys",
            "memory_delete_fraction": MEMORY_DELETE_FRACTION,
        },
        "metrics": RESULTS,
        "memory_kb": memory,
        "plots": plots,
        "random_workload": random_results,
    }

    results_path = EVIDENCE / "benchmark_detailed.json"
    results_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Detailed benchmark saved to {results_path}")


if __name__ == "__main__":
    main()
