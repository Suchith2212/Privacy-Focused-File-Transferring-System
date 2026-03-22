"""Measure query performance before and after indexes for Module B report."""

from __future__ import annotations

import random
import sqlite3
import time
from pathlib import Path

import matplotlib.pyplot as plt

BASE = Path(__file__).resolve().parent.parent
DB_FILE = BASE / "reports" / "index_benchmark.db"


def setup_db(with_indexes: bool):
    if DB_FILE.exists():
        DB_FILE.unlink()

    conn = sqlite3.connect(DB_FILE)
    conn.executescript(
        """
        CREATE TABLE members (
            member_id TEXT PRIMARY KEY,
            full_name TEXT,
            email TEXT,
            group_name TEXT
        );
        CREATE TABLE portfolios (
            member_id TEXT PRIMARY KEY,
            bio TEXT,
            skills TEXT,
            projects TEXT,
            updated_at TEXT
        );
        """
    )

    rows = []
    for i in range(1, 20001):
        rows.append((f"m{i}", f"Member {i}", f"user{i}@x.test", f"group-{i % 50}"))

    conn.executemany("INSERT INTO members(member_id, full_name, email, group_name) VALUES (?, ?, ?, ?)", rows)
    conn.executemany(
        "INSERT INTO portfolios(member_id, bio, skills, projects, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
        [(r[0], "bio", "sql,api", "project",) for r in rows],
    )

    if with_indexes:
        conn.executescript(
            """
            CREATE INDEX idx_members_group_email ON members(group_name, email);
            CREATE INDEX idx_portfolios_updated_at ON portfolios(updated_at);
            """
        )

    conn.commit()
    return conn


def timed_query(conn, sql, args=(), runs=30):
    times = []
    for _ in range(runs):
        start = time.perf_counter()
        conn.execute(sql, args).fetchall()
        times.append(time.perf_counter() - start)
    return sum(times) / len(times)


def explain(conn, sql, args=()):
    return [dict(zip(["id", "parent", "notused", "detail"], row)) for row in conn.execute(f"EXPLAIN QUERY PLAN {sql}", args)]


def main():
    target_group = f"group-{random.randint(0, 49)}"
    query = "SELECT m.member_id, m.email, p.skills FROM members m JOIN portfolios p ON p.member_id = m.member_id WHERE m.group_name = ? ORDER BY m.email"

    conn_no_index = setup_db(with_indexes=False)
    before_time = timed_query(conn_no_index, query, (target_group,))
    before_plan = explain(conn_no_index, query, (target_group,))
    conn_no_index.close()

    conn_indexed = setup_db(with_indexes=True)
    after_time = timed_query(conn_indexed, query, (target_group,))
    after_plan = explain(conn_indexed, query, (target_group,))
    conn_indexed.close()

    print("Average response time (seconds)")
    print({"before_index": before_time, "after_index": after_time})
    print("\nEXPLAIN before index:")
    for row in before_plan:
        print(row)
    print("\nEXPLAIN after index:")
    for row in after_plan:
        print(row)

    plt.figure(figsize=(6, 4))
    plt.bar(["Before Index", "After Index"], [before_time, after_time], color=["#c2410c", "#15803d"])
    plt.ylabel("Average query time (seconds)")
    plt.title("SQL Indexing Impact")
    plt.tight_layout()
    out = BASE / "reports" / "index_benchmark.png"
    plt.savefig(out)
    print(f"Saved plot: {out}")


if __name__ == "__main__":
    main()
