"""Helpers to reuse the existing Python Module A implementation."""

from __future__ import annotations

import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def legacy_module_a_candidates() -> list[Path]:
    package_root = project_root()
    return [
        (package_root / "Module_A").resolve(),
        (package_root / "Module_A" / "legacy_core").resolve(),
    ]


def legacy_module_a_path() -> Path:
    for candidate in legacy_module_a_candidates():
        if (candidate / "database" / "bplustree.py").exists():
            return candidate
    raise FileNotFoundError("Could not locate the legacy Module A database package")


def ensure_legacy_module_a_on_path() -> Path:
    module_path = legacy_module_a_path().resolve()
    module_path_str = str(module_path)
    if module_path_str not in sys.path:
        sys.path.insert(0, module_path_str)
    return module_path
