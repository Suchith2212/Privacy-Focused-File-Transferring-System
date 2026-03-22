"""Benchmark B+ Tree vs BruteForceDB for assignment report."""

from __future__ import annotations

import random
import time
import tracemalloc
from statistics import mean

import matplotlib.pyplot as plt

from database.bruteforce import BruteForceDB
from database.bplustree import BPlusTree


def _timed(fn):
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def benchmark_once(size: int):
    keys = random.sample(range(size * 20), size)
    values = [f"v-{k}" for k in keys]
    lookups = random.sample(keys, min(500, len(keys)))
    to_delete = lookups[: min(200, len(lookups))]

    bpt = BPlusTree(order=16)
    brute = BruteForceDB()

    tracemalloc.start()
    bpt_insert = _timed(lambda: [bpt.insert(k, v) for k, v in zip(keys, values)])
    _, bpt_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    tracemalloc.start()
    brute_insert = _timed(lambda: [brute.insert(k, v) for k, v in zip(keys, values)])
    _, brute_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    bpt_search = _timed(lambda: [bpt.search(k) for k in lookups])
    brute_search = _timed(lambda: [brute.search(k) for k in lookups])

    lo, hi = min(lookups), max(lookups)
    bpt_range = _timed(lambda: bpt.range_query(lo, hi))
    brute_range = _timed(lambda: brute.range_query(lo, hi))

    bpt_delete = _timed(lambda: [bpt.delete(k) for k in to_delete])
    brute_delete = _timed(lambda: [brute.delete(k) for k in to_delete])

    return {
        "size": size,
        "bpt_insert": bpt_insert,
        "brute_insert": brute_insert,
        "bpt_search": bpt_search,
        "brute_search": brute_search,
        "bpt_range": bpt_range,
        "brute_range": brute_range,
        "bpt_delete": bpt_delete,
        "brute_delete": brute_delete,
        "bpt_mem": bpt_peak,
        "brute_mem": brute_peak,
    }


def benchmark(sizes, runs=3):
    aggregated = []
    for size in sizes:
        rows = [benchmark_once(size) for _ in range(runs)]
        aggregated.append(
            {
                "size": size,
                **{k: mean([r[k] for r in rows]) for k in rows[0] if k != "size"},
            }
        )
    return aggregated


def plot_results(results, output_prefix="benchmark"):
    sizes = [r["size"] for r in results]
    metrics = [
        ("insert", "bpt_insert", "brute_insert"),
        ("search", "bpt_search", "brute_search"),
        ("delete", "bpt_delete", "brute_delete"),
        ("range", "bpt_range", "brute_range"),
    ]

    for label, bpt_key, brute_key in metrics:
        plt.figure(figsize=(8, 4))
        plt.plot(sizes, [r[bpt_key] for r in results], marker="o", label="B+ Tree")
        plt.plot(sizes, [r[brute_key] for r in results], marker="o", label="BruteForceDB")
        plt.xlabel("Number of records")
        plt.ylabel("Time (seconds)")
        plt.title(f"{label.title()} Performance")
        plt.legend()
        plt.tight_layout()
        plt.savefig(f"{output_prefix}_{label}.png")
        plt.close()

    plt.figure(figsize=(8, 4))
    plt.plot(sizes, [r["bpt_mem"] / 1024 for r in results], marker="o", label="B+ Tree")
    plt.plot(sizes, [r["brute_mem"] / 1024 for r in results], marker="o", label="BruteForceDB")
    plt.xlabel("Number of records")
    plt.ylabel("Peak memory tracked (KB)")
    plt.title("Memory Usage Comparison")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{output_prefix}_memory.png")
    plt.close()


def main():
    sizes = [1000, 3000, 5000, 8000, 10000]
    results = benchmark(sizes=sizes, runs=3)
    print("Benchmark summary:")
    for row in results:
        print(row)

    plot_results(results)

    tree = BPlusTree(order=4)
    for k in [30, 10, 20, 40, 50, 60, 25, 35]:
        tree.insert(k, f"value-{k}")
    try:
        tree.visualize_tree(filename="bplustree_visualization", output_format="png")
        print("Saved benchmark plots and bplustree_visualization.png")
    except Exception as exc:
        try:
            from graphviz import Digraph

            dot = Digraph(comment="B+ Tree")
            tree._add_nodes(dot, tree.root)
            tree._add_edges(dot, tree.root)
            dot.save("bplustree_visualization.dot")
            print(
                "Saved benchmark plots. Graphviz executable not found, "
                "so saved bplustree_visualization.dot instead."
            )
            print(f"Graphviz rendering error: {exc}")
        except Exception:
            print(f"Saved benchmark plots. Tree render skipped: {exc}")


if __name__ == "__main__":
    main()
