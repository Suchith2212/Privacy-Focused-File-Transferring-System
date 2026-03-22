"""Shared snapshot loading and amplification helpers for Module A."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple


Snapshot = Dict[str, List[Dict[str, Any]]]


def module_a_root() -> Path:
    return Path(__file__).resolve().parents[1]


def project_root() -> Path:
    return module_a_root().parents[1]


def snapshot_candidates() -> List[Path]:
    root = project_root()
    module_root = module_a_root()
    return [
        (root / "Project_432" / "backend" / "database_export.json").resolve(),
        (root / "CS432_Track1_Submission" / "Module_B" / "app" / "backend" / "database_export.json").resolve(),
        (module_root / "integration" / "amplified_snapshot.json").resolve(),
    ]


def resolve_snapshot_path(preferred: str | Path | None = None) -> Path:
    if preferred is not None:
        candidate = Path(preferred).expanduser().resolve()
        if candidate.exists():
            return candidate
        raise FileNotFoundError(f"Snapshot not found: {candidate}")

    for candidate in snapshot_candidates():
        if candidate.exists():
            return candidate

    raise FileNotFoundError(
        "Could not locate a snapshot. Expected Project_432/backend/database_export.json, "
        "Module_B/app/backend/database_export.json, or Module_A/integration/amplified_snapshot.json."
    )


def load_snapshot(preferred: str | Path | None = None) -> Tuple[Snapshot, Path]:
    path = resolve_snapshot_path(preferred)
    return json.loads(path.read_text(encoding="utf-8")), path


def snapshot_counts(snapshot: Snapshot) -> Dict[str, int]:
    return {key: len(value) for key, value in snapshot.items() if isinstance(value, list)}


def build_benchmark_snapshot(base_snapshot: Snapshot, size: int) -> Snapshot:
    base_vaults = list(base_snapshot.get("vaults", []))
    base_files = list(base_snapshot.get("files", []))
    base_auth = list(base_snapshot.get("auth_attempts", []))

    if not base_vaults or not base_files or not base_auth:
        raise ValueError("Snapshot must contain non-empty vaults, files, and auth_attempts arrays.")

    vaults: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []
    auth_attempts: List[Dict[str, Any]] = []
    generated_vault_ids: List[str] = []

    for i in range(size):
        base = base_vaults[i % len(base_vaults)]
        cycle = i // len(base_vaults)
        vault_id = f"{base['vault_id']}-bench-{i:05d}"
        generated_vault_ids.append(vault_id)
        vaults.append(
            {
                "vault_id": vault_id,
                "outer_token": f"{base['outer_token']}-{i:05d}",
                "expires_at_epoch": int(base.get("expires_at_epoch") or 0) + cycle * 3600 + i,
            }
        )

    for i in range(size):
        base = base_files[i % len(base_files)]
        cycle = i // len(base_files)
        files.append(
            {
                "file_id": f"{base['file_id']}-bench-{i:05d}",
                "vault_id": generated_vault_ids[i % len(generated_vault_ids)],
                "status": str(base.get("status", "ACTIVE")),
                "created_at_epoch": int(base.get("created_at_epoch") or 0) + cycle * 23 + i,
            }
        )

    session_pool = [
        f"{str(base_auth[i % len(base_auth)].get('session_id', f'session-{i % 12}'))}-{i % 7}"
        for i in range(max(12, min(size // 4, 80)))
    ]
    for i in range(size):
        base = base_auth[i % len(base_auth)]
        cycle = i // len(base_auth)
        auth_attempts.append(
            {
                "attempt_id": f"{base['attempt_id']}-bench-{i:05d}",
                "session_id": session_pool[i % len(session_pool)],
                "attempt_time_epoch": int(base.get("attempt_time_epoch") or 0) + cycle * 17 + i,
            }
        )

    return {
        "vaults": vaults,
        "files": files,
        "auth_attempts": auth_attempts,
    }


def pick_demo_targets(snapshot: Snapshot) -> Dict[str, Any]:
    vaults = list(snapshot.get("vaults", []))
    files = list(snapshot.get("files", []))
    auth_attempts = list(snapshot.get("auth_attempts", []))

    if not vaults or not files or not auth_attempts:
        raise ValueError("Snapshot must contain vaults, files, and auth_attempts.")

    vault_index = min(max(1, len(vaults) // 3), len(vaults) - 1)
    vault = vaults[vault_index]
    same_vault_files = [
        row
        for row in files
        if str(row.get("vault_id")) == str(vault.get("vault_id")) and str(row.get("status")) == "ACTIVE"
    ]
    if not same_vault_files:
        same_vault_files = [row for row in files if str(row.get("status")) == "ACTIVE"] or files[:1]

    session = auth_attempts[min(vault_index, len(auth_attempts) - 1)]
    attempt_times = [
        int(row.get("attempt_time_epoch") or 0)
        for row in auth_attempts
        if str(row.get("session_id")) == str(session.get("session_id"))
    ] or [int(session.get("attempt_time_epoch") or 0)]
    created_times = [int(row.get("created_at_epoch") or 0) for row in same_vault_files]
    expiry_epoch = int(vault.get("expires_at_epoch") or 0)

    return {
        "outer_token": str(vault.get("outer_token")),
        "vault_id": str(vault.get("vault_id")),
        "expiry_lo": expiry_epoch - 3600,
        "expiry_hi": expiry_epoch + 3600,
        "file_start": min(created_times) - 1,
        "file_end": max(created_times) + 1,
        "session_id": str(session.get("session_id")),
        "auth_start": min(attempt_times) - 1,
        "auth_end": max(attempt_times) + 1,
    }
