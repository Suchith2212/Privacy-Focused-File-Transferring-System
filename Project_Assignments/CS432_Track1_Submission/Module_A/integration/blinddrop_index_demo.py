"""Demonstrate the Module A integration on a real exported BlindDrop snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .blinddrop_index_manager import BlindDropIndexManager, make_demo_snapshot
    from .snapshot_utils import load_snapshot, pick_demo_targets, snapshot_counts
except ImportError:  # pragma: no cover - direct script execution fallback
    from blinddrop_index_manager import BlindDropIndexManager, make_demo_snapshot
    from snapshot_utils import load_snapshot, pick_demo_targets, snapshot_counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Module A BlindDrop integration demo.")
    parser.add_argument("--snapshot", type=str, default=None, help="Optional path to a JSON export snapshot.")
    args = parser.parse_args()

    try:
        snapshot, snapshot_path = load_snapshot(args.snapshot)
        targets = pick_demo_targets(snapshot)
        source = str(snapshot_path)
    except Exception:
        snapshot = make_demo_snapshot()
        source = "built-in demo snapshot"
        targets = {
            "outer_token": "OUTER02",
            "vault_id": "vault-001",
            "expiry_lo": 1711999000,
            "expiry_hi": 1712007200,
            "file_start": 1711990000,
            "file_end": 1711999999,
            "session_id": "session-A",
            "auth_start": 1711994000,
            "auth_end": 1711996000,
        }

    manager = BlindDropIndexManager(engine="bplustree", order=16)
    manager.load_snapshot(snapshot)

    result = {
        "source": source,
        "snapshotCounts": snapshot_counts(snapshot),
        "queries": targets,
        "outerTokenLookup": manager.lookup_vault_by_outer_token(targets["outer_token"]),
        "expiryRangeScan": manager.range_scan_expiring_vaults(targets["expiry_lo"], targets["expiry_hi"]),
        "vaultActiveFiles": manager.range_scan_vault_files(
            vault_id=targets["vault_id"],
            status="ACTIVE",
            start_epoch=targets["file_start"],
            end_epoch=targets["file_end"],
        ),
        "sessionAttempts": manager.range_scan_auth_attempts(
            session_id=targets["session_id"],
            start_epoch=targets["auth_start"],
            end_epoch=targets["auth_end"],
        ),
    }

    output_path = Path(__file__).with_name("blinddrop_index_demo_output.json")
    output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"Saved demo output to {output_path}")


if __name__ == "__main__":
    main()
