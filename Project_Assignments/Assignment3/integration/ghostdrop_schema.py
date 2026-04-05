"""
integration/ghostdrop_schema.py
================================
GhostDrop table definitions for Assignment 3.

The three core tables required by the assignment are:
  - vaults          (vault_id as primary key)
  - inner_tokens    (inner_token_id as PK, vault_id as FK)
  - files           (file_id as PK, vault_id + inner_token_id as FKs)

Four additional project-domain tables extend the schema:
  - sessions
  - download_logs
  - expiry_jobs
  - portfolio_entries

Each table is backed by a single B+ Tree instance (the storage engine from
Assignment 2). No external databases, no ORMs.
"""

from __future__ import annotations

from typing import Any, Dict


# ---------------------------------------------------------------------------
# Schema definitions (field names, allowed values, constraints)
# ---------------------------------------------------------------------------

SCHEMA: Dict[str, Dict[str, Any]] = {
    "vaults": {
        "primary_key": "vault_id",
        "fields": {
            "outer_token": str,
            "created_at": str,
            "expires_at": str,
            "status": {"ACTIVE", "EXPIRED", "DELETED"},
        },
        "required": ["outer_token", "status"],
        "description": "A secure temporary file vault identified by a random outer token.",
    },
    "inner_tokens": {
        "primary_key": "inner_token_id",
        "fields": {
            "vault_id": int,
            "token_type": {"MAIN", "SUB"},
            "token_hash": str,
            "status": {"ACTIVE", "REVOKED"},
        },
        "required": ["vault_id", "token_type", "status"],
        "foreign_keys": {
            "vault_id": "vaults",
        },
        "description": "Dual-token inner access credential linked to exactly one vault.",
    },
    "files": {
        "primary_key": "file_id",
        "fields": {
            "vault_id": int,
            "inner_token_id": int,
            "storage_path": str,
            "file_size": (int, float),
            "status": {"ACTIVE", "DELETED"},
            "deleted_at": str,
            "download_count": int,
            "max_downloads": int,
        },
        "required": ["vault_id", "inner_token_id", "file_size", "status"],
        "foreign_keys": {
            "vault_id": "vaults",
            "inner_token_id": "inner_tokens",
        },
        "description": "An encrypted file stored inside a vault, one-time downloadable.",
    },
    "sessions": {
        "primary_key": "session_id",
        "fields": {
            "ip_address": str,
            "user_agent": str,
        },
        "required": ["ip_address", "user_agent"],
        "description": "Anonymised client session for audit purposes.",
    },
    "download_logs": {
        "primary_key": "log_id",
        "fields": {
            "file_id": int,
            "inner_token_id": int,
            "session_id": int,
        },
        "required": ["file_id", "inner_token_id"],
        "foreign_keys": {
            "file_id": "files",
            "inner_token_id": "inner_tokens",
        },
        "description": "Immutable audit log entry for each file download.",
    },
    "expiry_jobs": {
        "primary_key": "job_id",
        "fields": {
            "vault_id": int,
            "processed": bool,
        },
        "required": ["vault_id"],
        "foreign_keys": {
            "vault_id": "vaults",
        },
        "description": "Background job to expire a vault past its deadline.",
    },
    "portfolio_entries": {
        "primary_key": "entry_id",
        "fields": {
            "vault_id": int,
            "owner_token_id": int,
            "created_by_token_id": int,
            "title": str,
            "content": str,
            "status": {"ACTIVE", "DELETED"},
        },
        "required": ["vault_id", "owner_token_id", "created_by_token_id", "title", "content", "status"],
        "foreign_keys": {
            "vault_id": "vaults",
            "owner_token_id": "inner_tokens",
            "created_by_token_id": "inner_tokens",
        },
        "description": "Structured portfolio entry owned by a vault participant.",
    },
}

#: Ordered list of all seven GhostDrop relations.
ALL_TABLES: list[str] = [
    "vaults",
    "inner_tokens",
    "files",
    "sessions",
    "download_logs",
    "expiry_jobs",
    "portfolio_entries",
]

#: The three core tables required by Assignment 3.
CORE_TABLES: list[str] = ["vaults", "inner_tokens", "files"]
