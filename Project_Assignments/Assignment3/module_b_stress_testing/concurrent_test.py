"""Compatibility entrypoint for concurrent test naming in rubric checklists."""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from .concurrent_vault_test import main
except ImportError:
    # Allow direct execution: python module_b_stress_testing/concurrent_test.py
    THIS_DIR = Path(__file__).resolve().parent
    if str(THIS_DIR) not in sys.path:
        sys.path.insert(0, str(THIS_DIR))
    from concurrent_vault_test import main


if __name__ == "__main__":
    main()
