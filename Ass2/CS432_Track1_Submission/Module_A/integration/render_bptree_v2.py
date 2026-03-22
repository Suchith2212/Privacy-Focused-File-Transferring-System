"""Render BlindDrop-oriented B+ tree visuals from the exported backend snapshot."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

try:
    from .snapshot_utils import load_snapshot, snapshot_counts
except ImportError:  # pragma: no cover - direct script execution fallback
    from snapshot_utils import load_snapshot, snapshot_counts


def epoch_value(row: Dict[str, Any], *keys: str) -> int:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, (int, float)):
            return int(value)
        text = str(value).replace("Z", "+00:00")
        try:
            return int(datetime.fromisoformat(text).timestamp())
        except ValueError:
            try:
                parsed = datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")
                return int(parsed.replace(tzinfo=timezone.utc).timestamp())
            except ValueError:
                continue
    return 0


def short_text(value: Any, limit: int = 18) -> str:
    if value is None:
        return "NULL"
    return str(value)[:limit]


def dot_binary() -> str:
    resolved = shutil.which("dot")
    if resolved:
        return resolved
    candidates = [
        Path(r"C:\Program Files\Graphviz\bin\dot.exe"),
        Path(r"C:\Program Files (x86)\Graphviz\bin\dot.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError("Graphviz 'dot' executable not found.")


@dataclass
class Node:
    keys: List[Any] = field(default_factory=list)
    values: List[Any] = field(default_factory=list)
    children: List["Node"] = field(default_factory=list)
    is_leaf: bool = True
    next_leaf: Optional["Node"] = None
    node_id: str = ""


class BPTree:
    def __init__(self, order: int = 5):
        self.order = max(3, order)
        self._counter = 1
        self.root = Node(is_leaf=True, node_id="n0")

    def _new_node(self, is_leaf: bool) -> Node:
        node = Node(is_leaf=is_leaf, node_id=f"n{self._counter}")
        self._counter += 1
        return node

    @staticmethod
    def _position(keys: List[Any], key: Any) -> int:
        for index, current in enumerate(keys):
            if key < current:
                return index
        return len(keys)

    def insert(self, key: Any, value: Any) -> None:
        split = self._insert(self.root, key, value)
        if split:
            middle_key, sibling = split
            new_root = self._new_node(is_leaf=False)
            new_root.keys = [middle_key]
            new_root.children = [self.root, sibling]
            self.root = new_root

    def _insert(self, node: Node, key: Any, value: Any) -> Optional[tuple[Any, Node]]:
        if node.is_leaf:
            position = self._position(node.keys, key)
            node.keys.insert(position, key)
            node.values.insert(position, value)
            if len(node.keys) >= self.order:
                return self._split_leaf(node)
            return None

        position = self._position(node.keys, key)
        split = self._insert(node.children[position], key, value)
        if not split:
            return None

        middle_key, sibling = split
        node.keys.insert(position, middle_key)
        node.children.insert(position + 1, sibling)
        if len(node.keys) >= self.order:
            return self._split_internal(node)
        return None

    def _split_leaf(self, node: Node) -> tuple[Any, Node]:
        mid = len(node.keys) // 2
        sibling = self._new_node(is_leaf=True)
        sibling.keys = node.keys[mid:]
        sibling.values = node.values[mid:]
        sibling.next_leaf = node.next_leaf
        node.next_leaf = sibling
        node.keys = node.keys[:mid]
        node.values = node.values[:mid]
        return sibling.keys[0], sibling

    def _split_internal(self, node: Node) -> tuple[Any, Node]:
        mid = len(node.keys) // 2
        middle_key = node.keys[mid]
        sibling = self._new_node(is_leaf=False)
        sibling.keys = node.keys[mid + 1 :]
        sibling.children = node.children[mid + 1 :]
        node.keys = node.keys[:mid]
        node.children = node.children[: mid + 1]
        return middle_key, sibling

    def all_nodes(self) -> List[Node]:
        queue = [self.root]
        ordered: List[Node] = []
        while queue:
            node = queue.pop(0)
            ordered.append(node)
            if not node.is_leaf:
                queue.extend(node.children)
        return ordered

    def height(self) -> int:
        level = 0
        node = self.root
        while True:
            level += 1
            if node.is_leaf:
                return level
            node = node.children[0]

    def stats(self) -> Dict[str, int]:
        nodes = self.all_nodes()
        leaf_nodes = [node for node in nodes if node.is_leaf]
        return {
            "total_nodes": len(nodes),
            "leaf_nodes": len(leaf_nodes),
            "internal_nodes": len(nodes) - len(leaf_nodes),
            "height": self.height(),
            "total_keys": sum(len(node.keys) for node in leaf_nodes),
        }


def escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def format_key(key: Any) -> str:
    if isinstance(key, tuple):
        return " | ".join(short_text(part, 12) for part in key)
    return short_text(key, 18)


def leaf_label(node: Node, accent: str, max_keys: int = 4) -> str:
    rows = []
    for key in node.keys[:max_keys]:
        rows.append(
            "<TR>"
            f'<TD ALIGN="LEFT" BGCOLOR="#ffffff" BORDER="0" CELLPADDING="3">'
            f'<FONT COLOR="{accent}" POINT-SIZE="9"><B>{escape_html(format_key(key))}</B></FONT>'
            "</TD>"
            '<TD ALIGN="CENTER" BGCOLOR="#f6f8fa" BORDER="0" CELLPADDING="3" WIDTH="14">'
            '<FONT COLOR="#6b7280" POINT-SIZE="8">&#10140;</FONT>'
            "</TD>"
            "</TR>"
        )
    extra = len(node.keys) - max_keys
    if extra > 0:
        rows.append(
            "<TR>"
            '<TD COLSPAN="2" ALIGN="CENTER" BGCOLOR="#f8fafc" BORDER="0" CELLPADDING="2">'
            f'<FONT COLOR="#6b7280" POINT-SIZE="8">+{extra} more</FONT>'
            "</TD>"
            "</TR>"
        )
    rows.append(
        "<TR>"
        '<TD COLSPAN="2" ALIGN="RIGHT" BGCOLOR="#f6f8fa" BORDER="0" CELLPADDING="2">'
        f'<FONT COLOR="{accent}" POINT-SIZE="8">&#9654;&#9654;</FONT>'
        "</TD>"
        "</TR>"
    )
    return (
        '<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="2" CELLPADDING="0" '
        f'COLOR="{accent}" BGCOLOR="#ffffff" STYLE="rounded">'
        + "".join(rows)
        + "</TABLE>>"
    )


def internal_label(node: Node, accent: str, max_keys: int = 5) -> str:
    cells = ['<TD BGCOLOR="#eef2f7" BORDER="0" WIDTH="10" CELLPADDING="4"> </TD>']
    for key in node.keys[:max_keys]:
        cells.append(
            '<TD BGCOLOR="#e5ebf3" BORDER="1" CELLPADDING="5" STYLE="rounded">'
            f'<FONT COLOR="{accent}" POINT-SIZE="10"><B>{escape_html(format_key(key))}</B></FONT>'
            "</TD>"
        )
        cells.append('<TD BGCOLOR="#eef2f7" BORDER="0" WIDTH="10" CELLPADDING="4"> </TD>')
    extra = len(node.keys) - max_keys
    if extra > 0:
        cells.append(
            '<TD BGCOLOR="#eef2f7" BORDER="0" CELLPADDING="4">'
            f'<FONT COLOR="#6b7280" POINT-SIZE="8">+{extra}</FONT>'
            "</TD>"
        )
    return (
        '<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" '
        f'COLOR="#8b9bb0" BGCOLOR="#eef2f7" STYLE="rounded">'
        f"<TR>{''.join(cells)}</TR>"
        "</TABLE>>"
    )


def render_tree(tree: BPTree, title: str, subtitle: str, accent: str, output_base: Path, fmt: str) -> Dict[str, int]:
    stats = tree.stats()
    nodes = tree.all_nodes()
    lines = [
        "digraph BPTree {",
        '  bgcolor="#ffffff";',
        '  rankdir="TB";',
        '  splines="polyline";',
        '  nodesep="0.35";',
        '  ranksep="0.7";',
        '  pad="0.6";',
        '  fontname="Helvetica Neue,Helvetica,Arial,sans-serif";',
        (
            '  label=<<TABLE BORDER="0" CELLPADDING="6">'
            f'<TR><TD><FONT COLOR="#111827" POINT-SIZE="18"><B>{escape_html(title)}</B></FONT></TD></TR>'
            f'<TR><TD><FONT COLOR="{accent}" POINT-SIZE="11">{escape_html(subtitle)}</FONT></TD></TR>'
            f'<TR><TD><FONT COLOR="#6b7280" POINT-SIZE="9">'
            f"height={stats['height']}  nodes={stats['total_nodes']}  leaves={stats['leaf_nodes']}  keys={stats['total_keys']}"
            "</FONT></TD></TR>"
            "</TABLE>>;"
        ),
        '  labelloc="t";',
        '  node [shape="none", margin="0", fontname="Helvetica Neue,Helvetica,Arial,sans-serif"];',
        '  edge [fontname="Helvetica Neue,Helvetica,Arial,sans-serif"];',
    ]

    for node in nodes:
        label = leaf_label(node, accent) if node.is_leaf else internal_label(node, accent)
        tooltip = f"{len(node.keys)} keys" if node.is_leaf else f"{len(node.keys)} separators"
        lines.append(f'  {node.node_id} [label={label}, tooltip="{tooltip}"];')

    for node in nodes:
        if not node.is_leaf:
            for child in node.children:
                lines.append(
                    f'  {node.node_id} -> {child.node_id} '
                    '[color="#c7d2de", arrowsize="0.5", penwidth="1.0", style="solid"];'
                )

    for node in nodes:
        if node.is_leaf and node.next_leaf:
            lines.append(
                f'  {node.node_id} -> {node.next_leaf.node_id} '
                f'[style="dashed", color="{accent}", constraint="false", arrowhead="open", arrowsize="0.6", penwidth="0.8", weight="0"];'
            )

    lines.append("}")
    dot_path = output_base.with_suffix(".dot")
    output_path = output_base.with_suffix(f".{fmt}")
    dot_path.write_text("\n".join(lines), encoding="utf-8")
    try:
        subprocess.run(
            [dot_binary(), f"-T{fmt}", "-Gdpi=150", str(dot_path), "-o", str(output_path)],
            check=True,
            capture_output=True,
        )
    finally:
        dot_path.unlink(missing_ok=True)
    return stats


def normalize_snapshot(raw: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    return {
        "vaults": [
            {
                "vault_id": str(row.get("vault_id", "")),
                "outer_token": str(row.get("outer_token", "")),
                "status": str(row.get("status", "")),
                "expires_at_epoch": epoch_value(row, "expires_at_epoch", "expires_at"),
            }
            for row in raw.get("vaults", [])
        ],
        "inner_tokens": [
            {
                "inner_token_id": str(row.get("inner_token_id", "")),
                "vault_id": str(row.get("vault_id", "")),
                "token_hash": str(row.get("token_hash", "")),
                "status": str(row.get("status", "")),
            }
            for row in raw.get("inner_tokens", [])
        ],
        "files": [
            {
                "file_id": str(row.get("file_id", "")),
                "vault_id": str(row.get("vault_id", "")),
                "drive_file_id": str(row.get("drive_file_id", "")),
                "status": str(row.get("status", "")),
                "created_at_epoch": epoch_value(row, "created_at_epoch", "created_at"),
                "deleted_at_epoch": epoch_value(row, "deleted_at_epoch", "deleted_at")
                if row.get("deleted_at") or row.get("deleted_at_epoch")
                else None,
            }
            for row in raw.get("files", [])
        ],
        "file_key_access": [
            {
                "access_id": str(row.get("access_id", "")),
                "file_id": str(row.get("file_id", "")),
                "inner_token_id": str(row.get("inner_token_id", "")),
            }
            for row in raw.get("file_key_access", [])
        ],
        "sessions": [
            {
                "session_id": str(row.get("session_id", "")),
                "ip_address": str(row.get("ip_address", "")),
                "created_at_epoch": epoch_value(row, "created_at_epoch", "created_at"),
            }
            for row in raw.get("sessions", [])
        ],
        "auth_attempts": [
            {
                "attempt_id": str(row.get("attempt_id", "")),
                "session_id": str(row.get("session_id", "")),
                "vault_id": str(row.get("vault_id", "")),
                "success": bool(row.get("success", False)),
                "attempt_time_epoch": epoch_value(row, "attempt_time_epoch", "attempt_time"),
            }
            for row in raw.get("auth_attempts", [])
        ],
        "download_logs": [
            {
                "download_id": str(row.get("download_id", "")),
                "file_id": str(row.get("file_id", "")),
                "inner_token_id": str(row.get("inner_token_id", "")),
                "download_time_epoch": epoch_value(row, "download_time_epoch", "download_time"),
            }
            for row in raw.get("download_logs", [])
        ],
        "captcha_tracking": [
            {
                "captcha_id": str(row.get("captcha_id", "")),
                "session_id": str(row.get("session_id", "")),
            }
            for row in raw.get("captcha_tracking", [])
        ],
        "expiry_jobs": [
            {
                "job_id": str(row.get("job_id", "")),
                "vault_id": str(row.get("vault_id", "")),
                "processed": int(bool(row.get("processed", False))),
                "scheduled_time_epoch": epoch_value(row, "scheduled_time_epoch", "scheduled_time"),
            }
            for row in raw.get("expiry_jobs", [])
        ],
        "portfolio_entries": [
            {
                "entry_id": str(row.get("entry_id", "")),
                "vault_id": str(row.get("vault_id", "")),
                "owner_token_id": str(row.get("owner_token_id", "")),
                "integrity_hash": str(row.get("integrity_hash", "")),
                "status": str(row.get("status", "")),
                "updated_at_epoch": epoch_value(row, "updated_at_epoch", "updated_at"),
            }
            for row in raw.get("portfolio_entries", [])
        ],
    }


KeyFunc = Callable[[Dict[str, Any]], Any]
ValFunc = Callable[[Dict[str, Any]], Any]


@dataclass
class IndexDef:
    slug: str
    title: str
    subtitle: str
    table: str
    key_fn: KeyFunc
    value_fn: ValFunc
    accent: str


ACCENTS = [
    "#2563eb",
    "#15803d",
    "#dc2626",
    "#7c3aed",
    "#d97706",
    "#0f766e",
    "#4338ca",
    "#b45309",
    "#be123c",
    "#0369a1",
    "#166534",
    "#7e22ce",
    "#c2410c",
    "#1d4ed8",
    "#b91c1c",
    "#0f766e",
    "#6d28d9",
    "#7c2d12",
    "#0891b2",
]


ALL_INDEXES: List[IndexDef] = [
    IndexDef("01_vaults__outer_token", "vaults | outer_token", "Unique lookup for public share token", "vaults", lambda row: short_text(row.get("outer_token", ""), 20), lambda row: short_text(row.get("vault_id", ""), 8), ACCENTS[0]),
    IndexDef("02_vaults__status_expires", "vaults | (status, expires_at)", "Range path for expiry worker scans", "vaults", lambda row: (str(row.get("status", "")), epoch_value(row, "expires_at_epoch", "expires_at")), lambda row: short_text(row.get("vault_id", ""), 8), ACCENTS[1]),
    IndexDef("03_inner_tokens__token_hash", "inner_tokens | token_hash", "Authentication hot-path lookup", "inner_tokens", lambda row: short_text(row.get("token_hash", ""), 20), lambda row: short_text(row.get("inner_token_id", ""), 8), ACCENTS[2]),
    IndexDef("04_inner_tokens__vault_status", "inner_tokens | (vault_id, status)", "Fetch active tokens for a vault", "inner_tokens", lambda row: (short_text(row.get("vault_id", ""), 8), str(row.get("status", ""))), lambda row: short_text(row.get("inner_token_id", ""), 8), ACCENTS[3]),
    IndexDef("05_files__vault_status_created", "files | (vault_id, status, created_at)", "Ordered file listing inside a vault", "files", lambda row: (short_text(row.get("vault_id", ""), 8), str(row.get("status", "")), epoch_value(row, "created_at_epoch", "created_at")), lambda row: short_text(row.get("file_id", ""), 8), ACCENTS[4]),
    IndexDef("06_files__drive_file_id", "files | drive_file_id", "External storage identifier lookup", "files", lambda row: short_text(row.get("drive_file_id", ""), 20), lambda row: short_text(row.get("file_id", ""), 8), ACCENTS[5]),
    IndexDef("07_files__deleted_at", "files | deleted_at", "Cleanup path for soft-deleted rows", "files", lambda row: row.get("deleted_at_epoch"), lambda row: short_text(row.get("file_id", ""), 8), ACCENTS[6]),
    IndexDef("08_fka__file_token", "file_key_access | (file_id, inner_token_id)", "File-first encrypted key lookup", "file_key_access", lambda row: (short_text(row.get("file_id", ""), 8), short_text(row.get("inner_token_id", ""), 8)), lambda row: short_text(row.get("access_id", ""), 8), ACCENTS[7]),
    IndexDef("09_fka__token", "file_key_access | inner_token_id", "Token-first access expansion", "file_key_access", lambda row: short_text(row.get("inner_token_id", ""), 8), lambda row: short_text(row.get("file_id", ""), 8), ACCENTS[8]),
    IndexDef("10_sessions__ip_created", "sessions | (ip_address, created_at)", "IP-based security window", "sessions", lambda row: (str(row.get("ip_address", "")), epoch_value(row, "created_at_epoch", "created_at")), lambda row: short_text(row.get("session_id", ""), 8), ACCENTS[9]),
    IndexDef("11_auth__vault_time", "auth_attempts | (vault_id, attempt_time)", "Per-vault brute-force detection", "auth_attempts", lambda row: (short_text(row.get("vault_id", "") or "NULL", 8), epoch_value(row, "attempt_time_epoch", "attempt_time")), lambda row: short_text(row.get("attempt_id", ""), 8), ACCENTS[10]),
    IndexDef("12_auth__session_time_success", "auth_attempts | (session_id, attempt_time, success)", "Session timeline with success flag", "auth_attempts", lambda row: (short_text(row.get("session_id", ""), 8), epoch_value(row, "attempt_time_epoch", "attempt_time"), bool(row.get("success", False))), lambda row: short_text(row.get("attempt_id", ""), 8), ACCENTS[11]),
    IndexDef("13_auth__time", "auth_attempts | attempt_time", "Global cleanup over auth attempts", "auth_attempts", lambda row: epoch_value(row, "attempt_time_epoch", "attempt_time"), lambda row: short_text(row.get("attempt_id", ""), 8), ACCENTS[12]),
    IndexDef("14_downloads__file_time", "download_logs | (file_id, download_time)", "Per-file audit history", "download_logs", lambda row: (short_text(row.get("file_id", ""), 8), epoch_value(row, "download_time_epoch", "download_time")), lambda row: short_text(row.get("download_id", ""), 8), ACCENTS[13]),
    IndexDef("15_downloads__token_time", "download_logs | (inner_token_id, download_time)", "Per-token audit history", "download_logs", lambda row: (short_text(row.get("inner_token_id", ""), 8), epoch_value(row, "download_time_epoch", "download_time")), lambda row: short_text(row.get("download_id", ""), 8), ACCENTS[14]),
    IndexDef("16_captcha__session", "captcha_tracking | session_id", "Captcha state per session", "captcha_tracking", lambda row: short_text(row.get("session_id", ""), 20), lambda row: short_text(row.get("captcha_id", ""), 8), ACCENTS[15]),
    IndexDef("17_expiry__processed_sched", "expiry_jobs | (processed, scheduled_time)", "Worker queue polling path", "expiry_jobs", lambda row: (int(bool(row.get("processed", False))), epoch_value(row, "scheduled_time_epoch", "scheduled_time")), lambda row: short_text(row.get("job_id", ""), 8), ACCENTS[16]),
    IndexDef("18_portfolio__vault_owner_status", "portfolio_entries | (vault_id, owner_token_id, status, updated_at)", "Submission-facing portfolio lookup path", "portfolio_entries", lambda row: (short_text(row.get("vault_id", ""), 8), short_text(row.get("owner_token_id", ""), 8), str(row.get("status", "")), epoch_value(row, "updated_at_epoch", "updated_at")), lambda row: short_text(row.get("entry_id", ""), 8), ACCENTS[17]),
    IndexDef("19_portfolio__integrity_hash", "portfolio_entries | integrity_hash", "Tamper-check index path", "portfolio_entries", lambda row: short_text(row.get("integrity_hash", ""), 20), lambda row: short_text(row.get("entry_id", ""), 8), ACCENTS[18]),
]


def render_all(snapshot: Dict[str, List[Dict[str, Any]]], out_dir: Path, order: int, fmt: str, source_path: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "sourceSnapshot": str(source_path),
        "snapshotCounts": snapshot_counts(snapshot),
        "order": order,
        "format": fmt,
        "indexes": [],
    }

    print(f"Rendering {len(ALL_INDEXES)} trees into {out_dir}")
    for index, definition in enumerate(ALL_INDEXES, start=1):
        tree = BPTree(order=order)
        inserted = 0
        for row in snapshot.get(definition.table, []):
            try:
                key = definition.key_fn(row)
                if key is None:
                    continue
                tree.insert(key, definition.value_fn(row))
                inserted += 1
            except Exception:
                continue
        output_base = out_dir / definition.slug
        stats = render_tree(tree, definition.title, definition.subtitle, definition.accent, output_base, fmt)
        manifest["indexes"].append(
            {
                "slug": definition.slug,
                "table": definition.table,
                "rowsInserted": inserted,
                "outputFile": f"{definition.slug}.{fmt}",
                "stats": stats,
            }
        )
        print(
            f"[{index:02d}/{len(ALL_INDEXES)}] {definition.slug}.{fmt} "
            f"rows={inserted} nodes={stats['total_nodes']} leaves={stats['leaf_nodes']} height={stats['height']}"
        )

    manifest_path = out_dir / "render_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Saved render manifest to {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render BlindDrop-oriented B+ tree visuals.")
    parser.add_argument("--snapshot", type=str, default=None, help="Optional path to a JSON snapshot export.")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "bptree_v2")
    parser.add_argument("--order", type=int, default=5)
    parser.add_argument("--format", choices=["png", "svg", "pdf"], default="png")
    args = parser.parse_args()

    raw_snapshot, source_path = load_snapshot(args.snapshot)
    normalized = normalize_snapshot(raw_snapshot)
    render_all(normalized, args.out_dir, args.order, args.format, source_path)


if __name__ == "__main__":
    main()
