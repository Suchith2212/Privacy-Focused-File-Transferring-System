"""
Module B: Concurrent Workload & Stress Testing
==============================================
Utilities shared across the Module B stress and race-condition test suite.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow sibling packages to resolve correctly.
_A3_ROOT = Path(__file__).resolve().parents[1]
if str(_A3_ROOT) not in sys.path:
    sys.path.insert(0, str(_A3_ROOT))

_ENGINE_ROOT = _A3_ROOT / "module_a"
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))
