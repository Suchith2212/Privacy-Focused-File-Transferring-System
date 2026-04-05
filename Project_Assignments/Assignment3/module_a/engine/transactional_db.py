"""Transactional wrapper over the Assignment 2 custom B+Tree manager."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List
from uuid import uuid4

from .db_manager import DatabaseManager
from .wal import WriteAheadLog


@dataclass
class TxOperation:
    op: str
    table: str
    key: int
    value: Any = None


@dataclass
class Transaction:
    tx_id: str
    manager: "TransactionalDatabaseManager"
    operations: List[TxOperation] = field(default_factory=list)
    active: bool = True

    def _check_active(self) -> None:
        if not self.active:
            raise RuntimeError("Transaction is no longer active.")

    def insert(self, table: str, key: int, value: Any) -> None:
        self._check_active()
        self.operations.append(TxOperation(op="insert", table=table, key=int(key), value=deepcopy(value)))
        self.manager._wal.append({"type": "OP", "tx_id": self.tx_id, "op": "insert", "table": table, "key": int(key), "value": value})

    def update(self, table: str, key: int, value: Any) -> None:
        self._check_active()
        self.operations.append(TxOperation(op="update", table=table, key=int(key), value=deepcopy(value)))
        self.manager._wal.append({"type": "OP", "tx_id": self.tx_id, "op": "update", "table": table, "key": int(key), "value": value})

    def delete(self, table: str, key: int) -> None:
        self._check_active()
        self.operations.append(TxOperation(op="delete", table=table, key=int(key), value=None))
        self.manager._wal.append({"type": "OP", "tx_id": self.tx_id, "op": "delete", "table": table, "key": int(key)})


class ReadOnlyTableView:
    """Read-only table facade that participates in manager-level locking."""

    def __init__(self, manager: "TransactionalDatabaseManager", table_name: str):
        self._manager = manager
        self._table_name = table_name

    def select(self, key: int):
        with self._manager._lock:
            table = self._manager.db.get_table(self._table_name)
            return deepcopy(table.select(key))

    def range_query(self, start_key: int, end_key: int):
        with self._manager._lock:
            table = self._manager.db.get_table(self._table_name)
            return deepcopy(table.range_query(start_key, end_key))

    def all_rows(self):
        with self._manager._lock:
            table = self._manager.db.get_table(self._table_name)
            return deepcopy(table.all_rows())


class TransactionalDatabaseManager:
    """Serialized transaction manager with WAL-backed commit recovery."""

    def __init__(self, wal_path: str | Path = "module_a/logs/tx_wal.log"):
        self.db = DatabaseManager()
        self._lock = RLock()
        self._current_tx: Transaction | None = None
        self._wal = WriteAheadLog(wal_path)
        self._recover_from_wal()

    def create_table(self, table_name: str, index_type: str = "bplustree", order: int = 4):
        if table_name in self.db.tables:
            return self.db.tables[table_name]
        table = self.db.create_table(table_name, index_type=index_type, order=order)
        self._wal.append({
            "type": "SCHEMA",
            "table": table_name,
            "index_type": index_type,
            "order": int(order)
        })
        return table

    def get_table(self, table_name: str):
        self.db.get_table(table_name)
        return ReadOnlyTableView(self, table_name)

    def begin(self) -> Transaction:
        self._lock.acquire()
        if self._current_tx is not None:
            self._lock.release()
            raise RuntimeError("Nested or concurrent transaction is not allowed in serialized mode.")

        tx = Transaction(tx_id=str(uuid4()), manager=self)
        self._current_tx = tx
        self._wal.append({"type": "BEGIN", "tx_id": tx.tx_id})
        return tx

    def commit(self, tx: Transaction) -> None:
        if tx is not self._current_tx:
            raise RuntimeError("Transaction does not match active context.")
        try:
            self._validate_transaction(tx.operations)
            self._wal.append({"type": "PREPARE", "tx_id": tx.tx_id})
            self._apply_operations_atomically(tx.operations)
            self._wal.append({"type": "COMMIT", "tx_id": tx.tx_id})
            tx.active = False
            self._current_tx = None
        except Exception:
            self._wal.append({"type": "ROLLBACK", "tx_id": tx.tx_id, "reason": "commit_failed"})
            tx.active = False
            self._current_tx = None
            raise
        finally:
            self._lock.release()

    def rollback(self, tx: Transaction) -> None:
        if tx is not self._current_tx:
            raise RuntimeError("Transaction does not match active context.")
        try:
            self._wal.append({"type": "ROLLBACK", "tx_id": tx.tx_id})
            tx.active = False
            self._current_tx = None
        finally:
            self._lock.release()

    def _table_state(self) -> Dict[str, Dict[int, Any]]:
        state: Dict[str, Dict[int, Any]] = {}
        for table_name, table in self.db.tables.items():
            rows: Dict[int, Any] = {}
            for key, value in table.all_rows():
                rows[int(key)] = deepcopy(value)
            state[table_name] = rows
        return state

    def _validate_row_schema(self, table_name: str, row: Any) -> None:
        if not isinstance(row, dict):
            raise ValueError(f"Row for table '{table_name}' must be a dict.")

        if table_name == "vaults":
            if "outer_token" not in row or not isinstance(row["outer_token"], str) or not row["outer_token"].strip():
                raise ValueError("vaults.outer_token is required.")
            status = str(row.get("status", ""))
            if status not in {"ACTIVE", "EXPIRED", "DELETED"}:
                raise ValueError("vaults.status must be ACTIVE, EXPIRED, or DELETED.")

        elif table_name == "inner_tokens":
            if "vault_id" not in row:
                raise ValueError("inner_tokens.vault_id is required.")
            token_type = str(row.get("token_type", ""))
            if token_type not in {"MAIN", "SUB"}:
                raise ValueError("inner_tokens.token_type must be MAIN or SUB.")
            status = str(row.get("status", ""))
            if status not in {"ACTIVE", "REVOKED"}:
                raise ValueError("inner_tokens.status must be ACTIVE or REVOKED.")

        elif table_name == "files":
            if "vault_id" not in row:
                raise ValueError("files.vault_id is required.")
            if "inner_token_id" not in row:
                raise ValueError("files.inner_token_id is required.")
            if "file_size" not in row or not isinstance(row["file_size"], (int, float)) or row["file_size"] < 0:
                raise ValueError("files.file_size must be non-negative.")
            status = str(row.get("status", ""))
            if status not in {"ACTIVE", "DELETED"}:
                raise ValueError("files.status must be ACTIVE or DELETED.")

        elif table_name == "sessions":
            if "ip_address" not in row or not isinstance(row["ip_address"], str) or not row["ip_address"].strip():
                raise ValueError("sessions.ip_address is required.")
            if "user_agent" not in row or not isinstance(row["user_agent"], str) or not row["user_agent"].strip():
                raise ValueError("sessions.user_agent is required.")

        elif table_name == "download_logs":
            if "file_id" not in row:
                raise ValueError("download_logs.file_id is required.")
            if "inner_token_id" not in row:
                raise ValueError("download_logs.inner_token_id is required.")
            if "session_id" in row and row["session_id"] is not None and not isinstance(row["session_id"], int):
                raise ValueError("download_logs.session_id must be int or None.")

        elif table_name == "expiry_jobs":
            if "vault_id" not in row:
                raise ValueError("expiry_jobs.vault_id is required.")
            if "processed" in row and not isinstance(row["processed"], bool):
                raise ValueError("expiry_jobs.processed must be bool.")

        elif table_name == "portfolio_entries":
            if "vault_id" not in row:
                raise ValueError("portfolio_entries.vault_id is required.")
            if "owner_token_id" not in row:
                raise ValueError("portfolio_entries.owner_token_id is required.")
            if "created_by_token_id" not in row:
                raise ValueError("portfolio_entries.created_by_token_id is required.")
            if "title" not in row or not isinstance(row["title"], str) or not row["title"].strip():
                raise ValueError("portfolio_entries.title is required.")
            if "content" not in row or not isinstance(row["content"], str):
                raise ValueError("portfolio_entries.content is required.")
            status = str(row.get("status", ""))
            if status not in {"ACTIVE", "DELETED"}:
                raise ValueError("portfolio_entries.status must be ACTIVE or DELETED.")

    def _validate_cross_constraints(self, state: Dict[str, Dict[int, Any]]) -> None:
        vaults = state.get("vaults", {})
        inner_tokens = state.get("inner_tokens", {})
        files = state.get("files", {})
        sessions = state.get("sessions", {})
        download_logs = state.get("download_logs", {})
        expiry_jobs = state.get("expiry_jobs", {})
        portfolio_entries = state.get("portfolio_entries", {})

        for token_id, row in inner_tokens.items():
            vault_id = int(row.get("vault_id"))
            if vault_id not in vaults:
                raise ValueError(f"Consistency check failed: inner_tokens[{token_id}] references missing vault")

        for file_id, row in files.items():
            vault_id = int(row.get("vault_id"))
            token_id = int(row.get("inner_token_id"))
            if vault_id not in vaults:
                raise ValueError(f"Consistency check failed: files[{file_id}] references missing vault")
            if token_id not in inner_tokens:
                raise ValueError(f"Consistency check failed: files[{file_id}] references missing inner_token")
            token_vault = int(inner_tokens[token_id].get("vault_id"))
            if token_vault != vault_id:
                raise ValueError(f"Consistency check failed: files[{file_id}] vault/token mismatch")

        for log_id, row in download_logs.items():
            file_id = int(row.get("file_id"))
            token_id = int(row.get("inner_token_id"))
            if file_id not in files:
                raise ValueError(f"Consistency check failed: download_logs[{log_id}] references missing file")
            if token_id not in inner_tokens:
                raise ValueError(f"Consistency check failed: download_logs[{log_id}] references missing inner_token")
            session_id = row.get("session_id")
            if session_id is not None and int(session_id) not in sessions:
                raise ValueError(f"Consistency check failed: download_logs[{log_id}] references missing session")

        for job_id, row in expiry_jobs.items():
            vault_id = int(row.get("vault_id"))
            if vault_id not in vaults:
                raise ValueError(f"Consistency check failed: expiry_jobs[{job_id}] references missing vault")

        for entry_id, row in portfolio_entries.items():
            vault_id = int(row.get("vault_id"))
            owner = int(row.get("owner_token_id"))
            creator = int(row.get("created_by_token_id"))
            if vault_id not in vaults:
                raise ValueError(f"Consistency check failed: portfolio_entries[{entry_id}] references missing vault")
            if owner not in inner_tokens:
                raise ValueError(f"Consistency check failed: portfolio_entries[{entry_id}] references missing owner token")
            if creator not in inner_tokens:
                raise ValueError(f"Consistency check failed: portfolio_entries[{entry_id}] references missing creator token")
            if int(inner_tokens[owner].get("vault_id")) != vault_id:
                raise ValueError(f"Consistency check failed: portfolio_entries[{entry_id}] owner token vault mismatch")
            if int(inner_tokens[creator].get("vault_id")) != vault_id:
                raise ValueError(f"Consistency check failed: portfolio_entries[{entry_id}] creator token vault mismatch")

    def _validate_transaction(self, operations: List[TxOperation]) -> None:
        state = self._table_state()

        for op in operations:
            if op.table not in state:
                raise ValueError(f"Unknown table in transaction: {op.table}")

            table_rows = state[op.table]
            key = int(op.key)

            if op.op == "insert":
                self._validate_row_schema(op.table, op.value)
                table_rows[key] = deepcopy(op.value)
            elif op.op == "update":
                if key not in table_rows:
                    raise ValueError(f"Update failed for {op.table}:{op.key}; key missing")
                self._validate_row_schema(op.table, op.value)
                table_rows[key] = deepcopy(op.value)
            elif op.op == "delete":
                table_rows.pop(key, None)
            else:
                raise ValueError(f"Unsupported operation: {op.op}")

        self._validate_cross_constraints(state)

    def _apply_operation_direct(self, op: TxOperation) -> None:
        table = self.db.get_table(op.table)
        if op.op == "insert":
            table.insert(op.key, deepcopy(op.value))
        elif op.op == "update":
            updated = table.update(op.key, deepcopy(op.value))
            if not updated:
                raise ValueError(f"Update failed for {op.table}:{op.key}; key missing")
        elif op.op == "delete":
            table.delete(op.key)
        else:
            raise ValueError(f"Unsupported operation: {op.op}")

    def _apply_operations_atomically(self, operations: List[TxOperation]) -> None:
        undo_stack: List[TxOperation] = []

        try:
            for op in operations:
                table = self.db.get_table(op.table)
                previous = deepcopy(table.select(op.key))

                if op.op in ("insert", "update"):
                    self._validate_row_schema(op.table, op.value)

                if op.op == "insert":
                    if previous is None:
                        undo_stack.append(TxOperation(op="delete", table=op.table, key=op.key, value=None))
                    else:
                        undo_stack.append(TxOperation(op="update", table=op.table, key=op.key, value=previous))
                elif op.op == "update":
                    if previous is None:
                        raise ValueError(f"Update failed for {op.table}:{op.key}; key missing")
                    undo_stack.append(TxOperation(op="update", table=op.table, key=op.key, value=previous))
                elif op.op == "delete":
                    if previous is not None:
                        undo_stack.append(TxOperation(op="insert", table=op.table, key=op.key, value=previous))
                else:
                    raise ValueError(f"Unsupported operation: {op.op}")

                self._apply_operation_direct(op)
        except Exception:
            for undo in reversed(undo_stack):
                self._apply_operation_direct(undo)
            raise

    def _recover_from_wal(self) -> None:
        records = list(self._wal.iter_records())
        if not records:
            return

        pending: Dict[str, List[TxOperation]] = {}

        for rec in records:
            rtype = rec.get("type")

            if rtype == "SCHEMA":
                table = rec["table"]
                if table not in self.db.tables:
                    self.db.create_table(table, index_type=rec.get("index_type", "bplustree"), order=int(rec.get("order", 4)))
                continue

            if rtype == "BEGIN":
                pending[rec["tx_id"]] = []
                continue

            if rtype == "OP":
                tx_id = rec["tx_id"]
                if tx_id in pending:
                    pending[tx_id].append(
                        TxOperation(
                            op=rec["op"],
                            table=rec["table"],
                            key=int(rec["key"]),
                            value=rec.get("value")
                        )
                    )
                continue

            if rtype == "ROLLBACK":
                pending.pop(rec["tx_id"], None)
                continue

            if rtype == "COMMIT":
                tx_id = rec["tx_id"]
                ops = pending.pop(tx_id, [])
                if ops:
                    self._validate_transaction(ops)
                    self._apply_operations_atomically(ops)
                continue

        # Any tx left in `pending` never committed; safely ignored.
