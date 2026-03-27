"""Executable parity, rollback, rebuild, and lazy-repair proof for Module A."""

from __future__ import annotations

import json
from pathlib import Path

try:
    from .db_index_parity_manager import GhostDropParityManager
    from .snapshot_utils import load_snapshot, snapshot_counts
except ImportError:  # pragma: no cover - direct script execution fallback
    from db_index_parity_manager import GhostDropParityManager
    from snapshot_utils import load_snapshot, snapshot_counts


def make_seeded_snapshot() -> tuple[dict, str]:
    try:
        snapshot, snapshot_path = load_snapshot()
        seeded = {
            "vaults": list(snapshot.get("vaults", [])),
            "files": list(snapshot.get("files", [])),
            "auth_attempts": list(snapshot.get("auth_attempts", [])),
        }
        return seeded, str(snapshot_path)
    except Exception:
        return {"vaults": [], "files": [], "auth_attempts": []}, "in-memory parity fixture"


def main() -> None:
    manager = GhostDropParityManager(engine="bplustree", order=16)
    seeded_snapshot, snapshot_source = make_seeded_snapshot()
    manager.load_snapshot(seeded_snapshot)

    suffix = len(seeded_snapshot["vaults"]) + 1
    vault_id = f"vault-parity-{suffix:03d}"
    outer_token = f"OUTER_PARITY_{suffix:03d}"
    file_id = f"file-parity-{len(seeded_snapshot['files']) + 1:03d}"
    attempt_id = f"attempt-parity-{len(seeded_snapshot['auth_attempts']) + 1:03d}"
    session_id = f"session-parity-{suffix:03d}"

    result = {
        "authorityModel": {
            "db": "authoritative",
            "bPlusTree": "acceleration and range-scan layer",
        },
        "sourceSnapshot": snapshot_source,
        "seedCounts": snapshot_counts(seeded_snapshot),
        "steps": [],
    }

    result["steps"].append(
        {
            "step": "initial_state",
            "parity": manager.validate_parity(),
        }
    )

    result["steps"].append(
        {
            "step": "commit_vault_success",
            "commit": manager.commit_vault(
                outer_token=outer_token,
                vault_id=vault_id,
                expires_at_epoch=1712600000,
            ),
            "parity": manager.validate_parity(),
        }
    )

    result["steps"].append(
        {
            "step": "commit_file_success",
            "commit": manager.commit_file(
                vault_id=vault_id,
                status="ACTIVE",
                created_at_epoch=1712500000,
                file_id=file_id,
            ),
            "parity": manager.validate_parity(),
        }
    )

    result["steps"].append(
        {
            "step": "commit_auth_attempt_success",
            "commit": manager.commit_auth_attempt(
                session_id=session_id,
                attempt_time_epoch=1712500600,
                attempt_id=attempt_id,
            ),
            "parity": manager.validate_parity(),
        }
    )

    pre_failure_snapshot = manager.store.clone_snapshot()
    pre_failure_parity = manager.validate_parity()
    failure_details = {}
    try:
        manager.commit_vault(
            outer_token="OUTER_PARITY_FAIL",
            vault_id="vault-parity-fail",
            expires_at_epoch=1712700000,
            inject_index_failure=True,
        )
    except RuntimeError as err:
        failure_details = {
            "error": str(err),
            "dbRolledBack": manager.store.clone_snapshot() == pre_failure_snapshot,
            "parityPreserved": manager.validate_parity()["ok"] and pre_failure_parity["ok"],
            "failedVaultVisible": bool(manager.store.find_vault_by_outer_token("OUTER_PARITY_FAIL")),
        }

    result["steps"].append(
        {
            "step": "forced_index_failure_with_rollback",
            **failure_details,
        }
    )

    divergence_detected = manager.force_outer_token_divergence(
        outer_token,
        vault_id,
    )
    result["steps"].append(
        {
            "step": "manual_divergence_detection",
            "divergenceInjected": divergence_detected,
            "parity": manager.validate_parity(),
        }
    )

    repair_result = manager.lookup_vault_with_repair(outer_token)
    result["steps"].append(
        {
            "step": "read_path_lazy_repair",
            "lookup": repair_result,
            "parity": manager.validate_parity(),
        }
    )

    manager.force_outer_token_divergence(outer_token, vault_id)
    parity_before_rebuild = manager.validate_parity()
    manager.rebuild_indexes()
    result["steps"].append(
        {
            "step": "full_rebuild_from_authoritative_db",
            "parityBeforeRebuild": parity_before_rebuild,
            "parityAfterRebuild": manager.validate_parity(),
        }
    )

    final_snapshot = manager.store.clone_snapshot()
    result["finalCounts"] = snapshot_counts(final_snapshot)
    result["appendedRecords"] = {
        "vault": next((row for row in final_snapshot["vaults"] if str(row.get("vault_id")) == vault_id), None),
        "file": next((row for row in final_snapshot["files"] if str(row.get("file_id")) == file_id), None),
        "authAttempt": next(
            (row for row in final_snapshot["auth_attempts"] if str(row.get("attempt_id")) == attempt_id),
            None,
        ),
    }

    output_path = Path(__file__).with_name("db_index_parity_demo_output.json")
    summary_path = Path(__file__).with_name("db_index_parity_demo_summary.md")

    output_path.write_text(json.dumps(result, indent=2), encoding="utf8")
    summary_path.write_text(build_summary(result), encoding="utf8")

    print(json.dumps(result, indent=2))
    print(f"Saved parity demo output to {output_path}")
    print(f"Saved parity demo summary to {summary_path}")


def build_summary(result: dict) -> str:
    lines = [
        "# DB and B+ Tree Parity Proof",
        "",
        "This proof demonstrates the Assignment 2 contract in executable form on top of the packaged GhostDrop-shaped snapshot:",
        "",
        "- relational state is authoritative",
        "- the custom B+ Tree is synchronized before commit becomes visible",
        "- forced index failure prevents partial visibility",
        "- parity divergence can be detected",
        "- read-path lazy repair can heal a missing index entry",
        "- full rebuild can restore parity from authoritative state",
        "",
        f"Source snapshot: `{result['sourceSnapshot']}`",
        "",
        "| Seeded vaults | Seeded files | Seeded auth attempts | Final vaults | Final files | Final auth attempts |",
        "| --- | --- | --- | --- | --- | --- |",
        "| {vaults} | {files} | {auth} | {final_vaults} | {final_files} | {final_auth} |".format(
            vaults=result["seedCounts"].get("vaults", 0),
            files=result["seedCounts"].get("files", 0),
            auth=result["seedCounts"].get("auth_attempts", 0),
            final_vaults=result["finalCounts"].get("vaults", 0),
            final_files=result["finalCounts"].get("files", 0),
            final_auth=result["finalCounts"].get("auth_attempts", 0),
        ),
        "",
        "## Key Outcomes",
        "",
    ]

    for step in result["steps"]:
        label = step["step"]
        if label == "forced_index_failure_with_rollback":
            lines.append(
                f"- `{label}`: rollback worked = `{step['dbRolledBack']}`, failed vault visible = `{step['failedVaultVisible']}`"
            )
        elif label == "read_path_lazy_repair":
            lines.append(
                f"- `{label}`: repaired = `{step['lookup']['repaired']}`, parity ok after repair = `{step['parity']['ok']}`"
            )
        elif label == "full_rebuild_from_authoritative_db":
            lines.append(
                f"- `{label}`: parity before rebuild = `{step['parityBeforeRebuild']['ok']}`, after rebuild = `{step['parityAfterRebuild']['ok']}`"
            )
        elif "parity" in step:
            lines.append(f"- `{label}`: parity ok = `{step['parity']['ok']}`")

    lines.extend(
        [
            "",
            "## Viva Line",
            "",
            "`The write path is DB-authoritative. If index mutation fails, the DB snapshot is not committed. If the index diverges later, parity checks detect it, lazy repair can restore a missed key during reads, and a full rebuild can reconstruct the complete B+ Tree from the authoritative relational state.`",
            "",
        ]
    )
    return "\n".join(lines)


if __name__ == "__main__":
    main()
