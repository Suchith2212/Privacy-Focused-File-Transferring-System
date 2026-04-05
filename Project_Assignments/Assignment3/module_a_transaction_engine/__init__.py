"""
Module A: Transaction Engine & Crash Recovery
=============================================
Exposes the transactional B+ Tree database alongside its composing components
so that experiments and tests can import from a single namespace.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow the engine sub-package to be found regardless of CWD.
_ENGINE_ROOT = Path(__file__).resolve().parents[1] / "module_a"
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))

from engine.bplustree import BPlusTree, BPlusTreeNode          # noqa: E402
from engine.db_manager import DatabaseManager                   # noqa: E402
from engine.table import Table                                  # noqa: E402
from engine.wal import WriteAheadLog                            # noqa: E402
from engine.transactional_db import (                           # noqa: E402
    TransactionalDatabaseManager,
    Transaction,
    TxOperation,
    ReadOnlyTableView,
)

__all__ = [
    "BPlusTree",
    "BPlusTreeNode",
    "DatabaseManager",
    "Table",
    "WriteAheadLog",
    "TransactionalDatabaseManager",
    "Transaction",
    "TxOperation",
    "ReadOnlyTableView",
]
