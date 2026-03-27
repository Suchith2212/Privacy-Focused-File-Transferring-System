"""DB-authoritative parity manager for the Ghost_Drop Module A proof."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence

try:
    from .ghostdrop_index_manager import GhostDropIndexManager
except ImportError:  # pragma: no cover - direct script execution fallback
    from ghostdrop_index_manager import GhostDropIndexManager


Snapshot = Dict[str, List[Dict[str, Any]]]


def empty_snapshot() -> Snapshot:
    return {
        "vaults": [],
        "files": [],
        "auth_attempts": [],
    }


@dataclass
class AuthoritativeGhostDropStore:
    """A small DB-like authoritative store for parity and rollback proofs."""

    snapshot: Snapshot = field(default_factory=empty_snapshot)

    def clone_snapshot(self) -> Snapshot:
        return deepcopy(self.snapshot)

    def replace_snapshot(self, new_snapshot: Snapshot) -> None:
        self.snapshot = deepcopy(new_snapshot)

    def find_vault_by_outer_token(self, outer_token: str) -> List[str]:
        return [
            str(row["vault_id"])
            for row in self.snapshot["vaults"]
            if str(row["outer_token"]) == outer_token
        ]


class GhostDropParityManager:
    """Maintain a custom B+ Tree view over an authoritative GhostDrop snapshot."""

    def __init__(self, engine: str = "bplustree", order: int = 16):
        self.engine = engine
        self.order = order
        self.store = AuthoritativeGhostDropStore()
        self.index_manager = GhostDropIndexManager(engine=engine, order=order)

    def load_snapshot(self, snapshot: Snapshot) -> None:
        """Seed the authoritative store from an exported snapshot."""
        seeded_snapshot: Snapshot = {
            "vaults": deepcopy(list(snapshot.get("vaults", []))),
            "files": deepcopy(list(snapshot.get("files", []))),
            "auth_attempts": deepcopy(list(snapshot.get("auth_attempts", []))),
        }
        self.store.replace_snapshot(seeded_snapshot)
        self.rebuild_indexes()

    def rebuild_indexes(self) -> None:
        rebuilt = GhostDropIndexManager(engine=self.engine, order=self.order)
        rebuilt.load_snapshot(self.store.clone_snapshot())
        self.index_manager = rebuilt

    def validate_parity(self) -> Dict[str, Any]:
        expected = GhostDropIndexManager(engine=self.engine, order=self.order)
        expected.load_snapshot(self.store.clone_snapshot())

        comparisons = {
            "outerTokenIndex": _normalize_pairs(expected.outer_token_index.get_all())
            == _normalize_pairs(self.index_manager.outer_token_index.get_all()),
            "expiryIndex": _normalize_pairs(expected.expiry_index.get_all())
            == _normalize_pairs(self.index_manager.expiry_index.get_all()),
            "fileLookupIndex": _normalize_pairs(expected.file_lookup_index.get_all())
            == _normalize_pairs(self.index_manager.file_lookup_index.get_all()),
            "authAttemptIndex": _normalize_pairs(expected.auth_attempt_index.get_all())
            == _normalize_pairs(self.index_manager.auth_attempt_index.get_all()),
        }

        return {
            "ok": all(comparisons.values()),
            "checks": comparisons,
            "authoritativeCounts": {
                "vaults": len(self.store.snapshot["vaults"]),
                "files": len(self.store.snapshot["files"]),
                "authAttempts": len(self.store.snapshot["auth_attempts"]),
            },
        }

    def commit_vault(
        self,
        *,
        outer_token: str,
        vault_id: str,
        expires_at_epoch: int,
        inject_index_failure: bool = False,
    ) -> Dict[str, Any]:
        staged_snapshot = self.store.clone_snapshot()
        staged_snapshot["vaults"].append(
            {
                "vault_id": vault_id,
                "outer_token": outer_token,
                "expires_at_epoch": expires_at_epoch,
            }
        )

        staged_index = GhostDropIndexManager(engine=self.engine, order=self.order)
        staged_index.load_snapshot(staged_snapshot)

        if inject_index_failure:
            raise RuntimeError("Injected index mutation failure after DB stage.")

        self.store.replace_snapshot(staged_snapshot)
        self.index_manager = staged_index
        return {
            "operation": "commit_vault",
            "vaultId": vault_id,
            "outerToken": outer_token,
            "expiresAtEpoch": expires_at_epoch,
        }

    def commit_file(
        self,
        *,
        vault_id: str,
        status: str,
        created_at_epoch: int,
        file_id: str,
        inject_index_failure: bool = False,
    ) -> Dict[str, Any]:
        staged_snapshot = self.store.clone_snapshot()
        staged_snapshot["files"].append(
            {
                "file_id": file_id,
                "vault_id": vault_id,
                "status": status,
                "created_at_epoch": created_at_epoch,
            }
        )

        staged_index = GhostDropIndexManager(engine=self.engine, order=self.order)
        staged_index.load_snapshot(staged_snapshot)

        if inject_index_failure:
            raise RuntimeError("Injected index mutation failure after DB stage.")

        self.store.replace_snapshot(staged_snapshot)
        self.index_manager = staged_index
        return {
            "operation": "commit_file",
            "fileId": file_id,
            "vaultId": vault_id,
            "status": status,
            "createdAtEpoch": created_at_epoch,
        }

    def commit_auth_attempt(
        self,
        *,
        session_id: str,
        attempt_time_epoch: int,
        attempt_id: str,
        inject_index_failure: bool = False,
    ) -> Dict[str, Any]:
        staged_snapshot = self.store.clone_snapshot()
        staged_snapshot["auth_attempts"].append(
            {
                "attempt_id": attempt_id,
                "session_id": session_id,
                "attempt_time_epoch": attempt_time_epoch,
            }
        )

        staged_index = GhostDropIndexManager(engine=self.engine, order=self.order)
        staged_index.load_snapshot(staged_snapshot)

        if inject_index_failure:
            raise RuntimeError("Injected index mutation failure after DB stage.")

        self.store.replace_snapshot(staged_snapshot)
        self.index_manager = staged_index
        return {
            "operation": "commit_auth_attempt",
            "attemptId": attempt_id,
            "sessionId": session_id,
            "attemptTimeEpoch": attempt_time_epoch,
        }

    def lookup_vault_with_repair(self, outer_token: str) -> Dict[str, Any]:
        index_hits = self.index_manager.lookup_vault_by_outer_token(outer_token)
        repaired = False

        if not index_hits:
            fallback_hits = self.store.find_vault_by_outer_token(outer_token)
            for vault_id in fallback_hits:
                for row in self.store.snapshot["vaults"]:
                    if str(row["vault_id"]) == vault_id:
                        self.index_manager.add_vault(
                            outer_token=str(row["outer_token"]),
                            vault_id=str(row["vault_id"]),
                            expires_at_epoch=int(row["expires_at_epoch"]),
                        )
                        repaired = True
            index_hits = self.index_manager.lookup_vault_by_outer_token(outer_token)

        return {
            "outerToken": outer_token,
            "vaultIds": index_hits,
            "repaired": repaired,
        }

    def force_outer_token_divergence(self, outer_token: str, vault_id: str) -> bool:
        return self.index_manager.outer_token_index.delete(outer_token, vault_id)


def _normalize_pairs(rows: Sequence[Any]) -> List[List[Any]]:
    normalized: List[List[Any]] = []
    for key, postings in rows:
        normalized.append([_normalize_value(key), sorted(_normalize_value(postings))])
    normalized.sort(key=lambda row: repr(row[0]))
    return normalized


def _normalize_value(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_normalize_value(item) for item in value]
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    return value
