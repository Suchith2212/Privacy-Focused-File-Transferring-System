"""Compatibility wrapper for the Module A BlindDrop B+ tree renderer."""

from __future__ import annotations

try:
    from .render_bptree_v2 import main
except ImportError:  # pragma: no cover - direct script execution fallback
    from render_bptree_v2 import main


if __name__ == "__main__":
    main()
