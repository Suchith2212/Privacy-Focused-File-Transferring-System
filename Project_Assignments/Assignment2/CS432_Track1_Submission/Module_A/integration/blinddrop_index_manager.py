"""BlindDrop-oriented index wrappers on top of the existing Module A B+ Tree."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, List, Sequence, Tuple

try:
    from .path_bootstrap import ensure_legacy_module_a_on_path
except ImportError:  # pragma: no cover - direct script execution fallback
    from path_bootstrap import ensure_legacy_module_a_on_path

ensure_legacy_module_a_on_path()

from database.bplustree import BPlusTree  # type: ignore  # noqa: E402
from database.bruteforce import BruteForceDB  # type: ignore  # noqa: E402


IndexKey = Any
Posting = Any


def iso_to_epoch_key(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def normalize_file_lookup_key(vault_id: str, status: str, created_at_epoch: int) -> Tuple[str, str, int]:
    return (vault_id, status, created_at_epoch)


def normalize_auth_lookup_key(session_id: str, attempt_time_epoch: int) -> Tuple[str, int]:
    return (session_id, attempt_time_epoch)


class PostingListIndex:
    """A duplicate-key-friendly wrapper over the current Module A structures."""

    def __init__(self, engine: str = "bplustree", order: int = 16):
        if engine == "bplustree":
            self.index = BPlusTree(order=order)
        elif engine == "bruteforce":
            self.index = BruteForceDB()
        else:
            raise ValueError("engine must be 'bplustree' or 'bruteforce'")

    def insert(self, key: IndexKey, posting: Posting) -> None:
        current = self.index.search(key)
        if current is None:
            self.index.insert(key, [posting])
            return
        if posting not in current:
            current.append(posting)
            self.index.update(key, current)

    def search(self, key: IndexKey) -> List[Posting]:
        return list(self.index.search(key) or [])

    def delete(self, key: IndexKey, posting: Posting) -> bool:
        current = self.index.search(key)
        if not current or posting not in current:
            return False
        current.remove(posting)
        if current:
            self.index.update(key, current)
        else:
            self.index.delete(key)
        return True

    def range_query(self, start_key: IndexKey, end_key: IndexKey) -> List[Tuple[IndexKey, List[Posting]]]:
        return self.index.range_query(start_key, end_key)

    def get_all(self) -> List[Tuple[IndexKey, List[Posting]]]:
        return self.index.get_all()


@dataclass
class BlindDropIndexManager:
    """Project_432-specific indexing facade for Module A demonstration."""

    engine: str = "bplustree"
    order: int = 16

    def __post_init__(self) -> None:
        self.outer_token_index = PostingListIndex(engine=self.engine, order=self.order)
        self.expiry_index = PostingListIndex(engine=self.engine, order=self.order)
        self.file_lookup_index = PostingListIndex(engine=self.engine, order=self.order)
        self.auth_attempt_index = PostingListIndex(engine=self.engine, order=self.order)

    def add_vault(self, outer_token: str, vault_id: str, expires_at_epoch: int) -> None:
        self.outer_token_index.insert(outer_token, vault_id)
        self.expiry_index.insert(expires_at_epoch, vault_id)

    def add_file(self, vault_id: str, status: str, created_at_epoch: int, file_id: str) -> None:
        key = normalize_file_lookup_key(vault_id, status, created_at_epoch)
        self.file_lookup_index.insert(key, file_id)

    def add_auth_attempt(self, session_id: str, attempt_time_epoch: int, attempt_id: str) -> None:
        key = normalize_auth_lookup_key(session_id, attempt_time_epoch)
        self.auth_attempt_index.insert(key, attempt_id)

    def lookup_vault_by_outer_token(self, outer_token: str) -> List[str]:
        return self.outer_token_index.search(outer_token)

    def range_scan_expiring_vaults(self, start_epoch: int, end_epoch: int) -> List[Tuple[int, List[str]]]:
        return self.expiry_index.range_query(start_epoch, end_epoch)

    def range_scan_vault_files(
        self,
        vault_id: str,
        status: str,
        start_epoch: int,
        end_epoch: int,
    ) -> List[Tuple[Tuple[str, str, int], List[str]]]:
        start = normalize_file_lookup_key(vault_id, status, start_epoch)
        end = normalize_file_lookup_key(vault_id, status, end_epoch)
        return self.file_lookup_index.range_query(start, end)

    def range_scan_auth_attempts(
        self,
        session_id: str,
        start_epoch: int,
        end_epoch: int,
    ) -> List[Tuple[Tuple[str, int], List[str]]]:
        start = normalize_auth_lookup_key(session_id, start_epoch)
        end = normalize_auth_lookup_key(session_id, end_epoch)
        return self.auth_attempt_index.range_query(start, end)

    def load_snapshot(self, snapshot: Dict[str, Sequence[Dict[str, Any]]]) -> None:
        for vault in snapshot.get("vaults", []):
            self.add_vault(
                outer_token=str(vault["outer_token"]),
                vault_id=str(vault["vault_id"]),
                expires_at_epoch=int(vault["expires_at_epoch"]),
            )

        for file_row in snapshot.get("files", []):
            self.add_file(
                vault_id=str(file_row["vault_id"]),
                status=str(file_row["status"]),
                created_at_epoch=int(file_row["created_at_epoch"]),
                file_id=str(file_row["file_id"]),
            )

        for attempt in snapshot.get("auth_attempts", []):
            self.add_auth_attempt(
                session_id=str(attempt["session_id"]),
                attempt_time_epoch=int(attempt["attempt_time_epoch"]),
                attempt_id=str(attempt["attempt_id"]),
            )


def make_demo_snapshot() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "vaults": [
            {"vault_id": "vault-001", "outer_token": "OUTER01", "expires_at_epoch": 1712000000},
            {"vault_id": "vault-002", "outer_token": "OUTER02", "expires_at_epoch": 1712003600},
            {"vault_id": "vault-003", "outer_token": "OUTER03", "expires_at_epoch": 1712010000},
        ],
        "files": [
            {"file_id": "file-01", "vault_id": "vault-001", "status": "ACTIVE", "created_at_epoch": 1711991000},
            {"file_id": "file-02", "vault_id": "vault-001", "status": "ACTIVE", "created_at_epoch": 1711992000},
            {"file_id": "file-03", "vault_id": "vault-001", "status": "DELETED", "created_at_epoch": 1711993000},
            {"file_id": "file-04", "vault_id": "vault-002", "status": "ACTIVE", "created_at_epoch": 1711994000},
        ],
        "auth_attempts": [
            {"attempt_id": "attempt-01", "session_id": "session-A", "attempt_time_epoch": 1711995000},
            {"attempt_id": "attempt-02", "session_id": "session-A", "attempt_time_epoch": 1711995060},
            {"attempt_id": "attempt-03", "session_id": "session-B", "attempt_time_epoch": 1711995120},
        ],
    }
