"""
integration/setup_database.py
==============================
Initialise the GhostDrop transactional database with all seven relations
and seed it with a minimal but realistic dataset.

Usage:
    python integration/setup_database.py

Returns a ready-to-use TransactionalDatabaseManager instance that can be
imported directly into experiment scripts via::

    from integration.setup_database import build_db
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure the engine package is importable regardless of CWD.
_A3_ROOT = Path(__file__).resolve().parents[1]
_ENGINE_ROOT = _A3_ROOT / "module_a"
for _p in (_A3_ROOT, _ENGINE_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from engine.transactional_db import TransactionalDatabaseManager  # noqa: E402
from integration.ghostdrop_schema import ALL_TABLES               # noqa: E402


# ---------------------------------------------------------------------------
# Default WAL path (relative to Assignment3/ root)
# ---------------------------------------------------------------------------
DEFAULT_WAL = _A3_ROOT / "logs" / "wal.log"


def build_db(
    wal_path: Path | None = None,
    *,
    fresh: bool = False,
    seed: bool = True,
) -> TransactionalDatabaseManager:
    """
    Build a TransactionalDatabaseManager with the full GhostDrop schema.

    Args:
        wal_path: Path to the WAL log file. Defaults to logs/wal.log.
        fresh:    If True, wipe the WAL before constructing so there is no
                  prior state to recover.  Use this for isolated experiments.
        seed:     If True, insert one complete domain object graph so
                  foreign-key constraints can be satisfied by follow-on
                  transactions.

    Returns:
        A fully initialised TransactionalDatabaseManager.
    """
    path = Path(wal_path) if wal_path else DEFAULT_WAL
    path.parent.mkdir(parents=True, exist_ok=True)

    if fresh:
        path.write_text("", encoding="utf-8")

    db = TransactionalDatabaseManager(path)

    # Create all seven relations (idempotent – existing tables are skipped).
    for table_name in ALL_TABLES:
        if table_name not in db.db.tables:
            db.create_table(table_name)

    if seed:
        _seed(db)

    return db


def _seed(db: TransactionalDatabaseManager) -> None:
    """Insert a canonical baseline row set covering all seven relations."""
    # Guard: skip if vault 1 already exists (recovery may have restored it).
    if db.get_table("vaults").select(1) is not None:
        return

    tx = db.begin()
    # Vault
    tx.insert("vaults", 1, {"outer_token": "OUTER_SEED_001", "status": "ACTIVE"})
    # Inner token for that vault
    tx.insert(
        "inner_tokens", 101,
        {"vault_id": 1, "token_type": "MAIN", "token_hash": "abc123", "status": "ACTIVE"},
    )
    # Session
    tx.insert(
        "sessions", 501,
        {"ip_address": "127.0.0.1", "user_agent": "GhostDrop-Seed/1.0"},
    )
    # File inside vault
    tx.insert(
        "files", 1001,
        {
            "vault_id": 1,
            "inner_token_id": 101,
            "storage_path": "/storage/seed_file.enc",
            "file_size": 1024,
            "status": "ACTIVE",
            "download_count": 0,
            "max_downloads": 1,
        },
    )
    # Download log
    tx.insert(
        "download_logs", 7001,
        {"file_id": 1001, "inner_token_id": 101, "session_id": 501},
    )
    # Expiry job
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    # Portfolio entry
    tx.insert(
        "portfolio_entries", 9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Seed Portfolio",
            "content": "Baseline dataset for Assignment 3 experiments.",
            "status": "ACTIVE",
        },
    )
    db.commit(tx)
    print("[SETUP] Seed dataset committed to WAL and B+ Trees.")


if __name__ == "__main__":
    db = build_db(fresh=True, seed=True)
    print("[SETUP] Database ready. Tables:", list(db.db.tables.keys()))
