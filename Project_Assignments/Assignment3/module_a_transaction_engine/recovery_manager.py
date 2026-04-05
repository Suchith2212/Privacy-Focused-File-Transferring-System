"""Compatibility shim for recovery manager naming.

Recovery is implemented by TransactionalDatabaseManager._recover_from_wal().
"""

from __future__ import annotations

from pathlib import Path
from . import TransactionalDatabaseManager


class RecoveryManager:
    """Reconstructs state from WAL by creating a transactional manager."""

    def recover(self, wal_path: str | Path) -> TransactionalDatabaseManager:
        return TransactionalDatabaseManager(wal_path)


__all__ = ["RecoveryManager"]
