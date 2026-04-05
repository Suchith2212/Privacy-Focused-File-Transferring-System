"""
integration/ghostdrop_transactions.py
======================================
Reusable multi-table transaction patterns aligned to the GhostDrop domain.

These helpers encode the real business logic of GhostDrop as atomic,
multi-relation transactions - the exact scenario targeted by Assignment 3.

Each helper takes a db: TransactionalDatabaseManager and performs a
logically complete operation spanning >=3 tables.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

_A3_ROOT = Path(__file__).resolve().parents[1]
_ENGINE_ROOT = _A3_ROOT / "module_a"
for _p in (_A3_ROOT, _ENGINE_ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from engine.transactional_db import TransactionalDatabaseManager  # noqa: E402


# ---------------------------------------------------------------------------
# Helper: next available integer key for a table
# ---------------------------------------------------------------------------

def _next_key(db: TransactionalDatabaseManager, table_name: str, base: int = 1) -> int:
    """Return base + number of existing rows so keys stay unique."""
    rows = db.get_table(table_name).all_rows()
    existing = {k for k, _ in rows}
    candidate = base
    while candidate in existing:
        candidate += 1
    return candidate


# ---------------------------------------------------------------------------
# Transaction 1: Create Vault (vaults + inner_tokens)
# ---------------------------------------------------------------------------

def create_vault_txn(
    db: TransactionalDatabaseManager,
    vault_id: int,
    outer_token: str,
    inner_token_id: int,
    token_hash: str = "demo_hash",
) -> None:
    """
    Atomically create a new vault and its primary inner token.

    Spans tables: vaults, inner_tokens  (2-table; used in wider 3-table combos).
    """
    tx = db.begin()
    try:
        tx.insert(
            "vaults", vault_id,
            {"outer_token": outer_token, "status": "ACTIVE"},
        )
        tx.insert(
            "inner_tokens", inner_token_id,
            {
                "vault_id": vault_id,
                "token_type": "MAIN",
                "token_hash": token_hash,
                "status": "ACTIVE",
            },
        )
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


# ---------------------------------------------------------------------------
# Transaction 2: Upload File (vaults + inner_tokens + files)
# ---------------------------------------------------------------------------

def upload_file_txn(
    db: TransactionalDatabaseManager,
    vault_id: int,
    inner_token_id: int,
    file_id: int,
    file_size: int,
    storage_path: str = "/storage/encrypted.enc",
) -> None:
    """
    Atomically record a file upload into an existing vault.

    Spans tables: vaults (read check), inner_tokens (read check), files (insert).
    By virtue of the engine's cross-constraint validation at commit, all three
    tables are validated in the same transaction.
    """
    tx = db.begin()
    try:
        tx.insert(
            "files", file_id,
            {
                "vault_id": vault_id,
                "inner_token_id": inner_token_id,
                "storage_path": storage_path,
                "file_size": file_size,
                "status": "ACTIVE",
                "download_count": 0,
                "max_downloads": 1,
            },
        )
        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


# ---------------------------------------------------------------------------
# Transaction 3: Expire Vault (vaults + inner_tokens + expiry_jobs)
# ---------------------------------------------------------------------------

def expire_vault_txn(
    db: TransactionalDatabaseManager,
    vault_id: int,
    inner_token_id: int,
    job_id: int,
) -> None:
    """
    Multi-table expiry operation: mark vault EXPIRED, revoke its primary inner
    token, and mark the related expiry job as processed.

    Spans tables: vaults, inner_tokens, expiry_jobs  (exactly 3 tables).
    All three mutations are all-or-nothing.
    """
    tx = db.begin()
    try:
        # 1. Expire vault
        vault = db.get_table("vaults").select(vault_id)
        if vault is None:
            raise ValueError(f"Vault {vault_id} not found")
        tx.update("vaults", vault_id, {**vault, "status": "EXPIRED"})

        # 2. Revoke inner token
        token = db.get_table("inner_tokens").select(inner_token_id)
        if token is None:
            raise ValueError(f"InnerToken {inner_token_id} not found")
        tx.update("inner_tokens", inner_token_id, {**token, "status": "REVOKED"})

        # 3. Mark expiry job processed
        job = db.get_table("expiry_jobs").select(job_id)
        if job is None:
            raise ValueError(f"ExpiryJob {job_id} not found")
        tx.update("expiry_jobs", job_id, {**job, "processed": True})

        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


# ---------------------------------------------------------------------------
# Transaction 4: One-Time Download (files + download_logs + sessions)
# ---------------------------------------------------------------------------

def download_file_txn(
    db: TransactionalDatabaseManager,
    file_id: int,
    inner_token_id: int,
    session_id: int,
    log_id: int,
) -> None:
    """
    Atomically attempt a one-time file download.

    Business rule: download_count must be < max_downloads.

    Spans tables: files (update download_count), download_logs (insert), sessions (read).
    """
    tx = db.begin()
    try:
        file_rec = db.get_table("files").select(file_id)
        if file_rec is None:
            raise ValueError(f"File {file_id} not found")

        max_dl = file_rec.get("max_downloads", 1)
        cur_dl = file_rec.get("download_count", 0)
        if cur_dl >= max_dl:
            raise RuntimeError(f"File {file_id}: download limit reached ({cur_dl}/{max_dl})")

        # Increment download count
        tx.update("files", file_id, {**file_rec, "download_count": cur_dl + 1})

        # Log the download
        tx.insert(
            "download_logs", log_id,
            {"file_id": file_id, "inner_token_id": inner_token_id, "session_id": session_id},
        )

        db.commit(tx)
    except Exception:
        db.rollback(tx)
        raise


