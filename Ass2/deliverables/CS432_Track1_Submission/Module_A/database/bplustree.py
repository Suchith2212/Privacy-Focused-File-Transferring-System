"""B+ Tree implementation used as a lightweight DB index."""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any, List, Optional, Tuple


@dataclass
class BPlusTreeNode:
    is_leaf: bool = False
    keys: List[int] = field(default_factory=list)
    children: List["BPlusTreeNode"] = field(default_factory=list)
    values: List[Any] = field(default_factory=list)
    next: Optional["BPlusTreeNode"] = None


class BPlusTree:
    def __init__(self, order: int = 4):
        if order < 3:
            raise ValueError("order must be >= 3")
        self.order = order
        self.max_keys = order - 1
        self.min_keys = ((order + 1) // 2) - 1
        self.root = BPlusTreeNode(is_leaf=True)

    def search(self, key: int) -> Any:
        leaf = self._find_leaf(key)
        idx = bisect_left(leaf.keys, key)
        if idx < len(leaf.keys) and leaf.keys[idx] == key:
            return leaf.values[idx]
        return None

    def insert(self, key: int, value: Any) -> None:
        if len(self.root.keys) >= self.max_keys:
            new_root = BPlusTreeNode(is_leaf=False, children=[self.root])
            self._split_child(new_root, 0)
            self.root = new_root
        self._insert_non_full(self.root, key, value)

    def _insert_non_full(self, node: BPlusTreeNode, key: int, value: Any) -> None:
        if node.is_leaf:
            idx = bisect_left(node.keys, key)
            if idx < len(node.keys) and node.keys[idx] == key:
                node.values[idx] = value
                return
            node.keys.insert(idx, key)
            node.values.insert(idx, value)
            return

        idx = bisect_right(node.keys, key)
        child = node.children[idx]
        if len(child.keys) >= self.max_keys:
            self._split_child(node, idx)
            idx = bisect_right(node.keys, key)
        self._insert_non_full(node.children[idx], key, value)
        self._recompute_keys(node)

    def _split_child(self, parent: BPlusTreeNode, index: int) -> None:
        child = parent.children[index]
        sibling = BPlusTreeNode(is_leaf=child.is_leaf)
        mid = len(child.keys) // 2

        if child.is_leaf:
            sibling.keys = child.keys[mid:]
            sibling.values = child.values[mid:]
            child.keys = child.keys[:mid]
            child.values = child.values[:mid]
            sibling.next = child.next
            child.next = sibling
            parent.keys.insert(index, sibling.keys[0])
        else:
            promoted = child.keys[mid]
            sibling.children = child.children[mid + 1 :]
            sibling.keys = child.keys[mid + 1 :]
            child.children = child.children[: mid + 1]
            child.keys = child.keys[:mid]
            parent.keys.insert(index, promoted)

        parent.children.insert(index + 1, sibling)
        self._recompute_keys(parent)

    def delete(self, key: int) -> bool:
        removed = self._delete(self.root, key)
        if not self.root.is_leaf and len(self.root.children) == 1:
            self.root = self.root.children[0]
        if self.root.is_leaf and not self.root.keys:
            self.root.next = None
        return removed

    def _delete(self, node: BPlusTreeNode, key: int) -> bool:
        if node.is_leaf:
            idx = bisect_left(node.keys, key)
            if idx >= len(node.keys) or node.keys[idx] != key:
                return False
            node.keys.pop(idx)
            node.values.pop(idx)
            return True

        idx = bisect_right(node.keys, key)
        if len(node.children[idx].keys) <= self.min_keys:
            self._fill_child(node, idx)
            if idx >= len(node.children):
                idx = len(node.children) - 1

        removed = self._delete(node.children[idx], key)
        self._recompute_keys(node)
        return removed

    def _fill_child(self, node: BPlusTreeNode, index: int) -> None:
        if index > 0 and len(node.children[index - 1].keys) > self.min_keys:
            self._borrow_from_prev(node, index)
            return
        if index < len(node.children) - 1 and len(node.children[index + 1].keys) > self.min_keys:
            self._borrow_from_next(node, index)
            return
        if index < len(node.children) - 1:
            self._merge(node, index)
        else:
            self._merge(node, index - 1)

    def _borrow_from_prev(self, node: BPlusTreeNode, index: int) -> None:
        child = node.children[index]
        sibling = node.children[index - 1]

        if child.is_leaf:
            child.keys.insert(0, sibling.keys.pop())
            child.values.insert(0, sibling.values.pop())
        else:
            child.children.insert(0, sibling.children.pop())
            self._recompute_keys(sibling)
            self._recompute_keys(child)

        self._recompute_keys(node)

    def _borrow_from_next(self, node: BPlusTreeNode, index: int) -> None:
        child = node.children[index]
        sibling = node.children[index + 1]

        if child.is_leaf:
            child.keys.append(sibling.keys.pop(0))
            child.values.append(sibling.values.pop(0))
        else:
            child.children.append(sibling.children.pop(0))
            self._recompute_keys(sibling)
            self._recompute_keys(child)

        self._recompute_keys(node)

    def _merge(self, node: BPlusTreeNode, index: int) -> None:
        left = node.children[index]
        right = node.children[index + 1]

        if left.is_leaf:
            left.keys.extend(right.keys)
            left.values.extend(right.values)
            left.next = right.next
        else:
            left.children.extend(right.children)
            self._recompute_keys(left)

        node.children.pop(index + 1)
        self._recompute_keys(node)

    def update(self, key: int, new_value: Any) -> bool:
        leaf = self._find_leaf(key)
        idx = bisect_left(leaf.keys, key)
        if idx < len(leaf.keys) and leaf.keys[idx] == key:
            leaf.values[idx] = new_value
            return True
        return False

    def range_query(self, start_key: int, end_key: int) -> List[Tuple[int, Any]]:
        if start_key > end_key:
            return []
        node = self._find_leaf(start_key)
        result: List[Tuple[int, Any]] = []

        while node is not None:
            for k, v in zip(node.keys, node.values):
                if k < start_key:
                    continue
                if k > end_key:
                    return result
                result.append((k, v))
            node = node.next

        return result

    def get_all(self) -> List[Tuple[int, Any]]:
        node = self.root
        while not node.is_leaf:
            node = node.children[0]

        out: List[Tuple[int, Any]] = []
        while node:
            out.extend(zip(node.keys, node.values))
            node = node.next
        return out

    def _ensure_graphviz_path(self) -> None:
        if shutil.which("dot"):
            return

        candidates = []
        graphviz_dot = os.environ.get("GRAPHVIZ_DOT")
        if graphviz_dot:
            candidates.append(Path(graphviz_dot))

        candidates.extend(
            [
                Path(r"C:\Program Files\Graphviz\bin\dot.exe"),
                Path(r"C:\Program Files (x86)\Graphviz\bin\dot.exe"),
            ]
        )

        for candidate in candidates:
            if not candidate.is_file():
                continue
            dot_dir = str(candidate.parent)
            current_path = os.environ.get("PATH", "")
            os.environ["PATH"] = dot_dir if not current_path else dot_dir + os.pathsep + current_path
            return

    def visualize_tree(self, filename: str = "bplustree", output_format: str = "png"):
        self._ensure_graphviz_path()
        dot_binary = shutil.which("dot")
        if not dot_binary:
            raise RuntimeError("Graphviz 'dot' executable is required for visualisation")

        base_path = Path(filename)
        dot_path = base_path.with_suffix(".dot")
        output_path = base_path.with_suffix(f".{output_format}")
        dot_path.write_text(self._build_dot_source(), encoding="utf-8")
        subprocess.run(
            [dot_binary, f"-T{output_format}", str(dot_path), "-o", str(output_path)],
            check=True,
        )
        dot_path.unlink(missing_ok=True)
        return output_path

    def _build_dot_source(self) -> str:
        lines = [
            "digraph BPlusTree {",
            '  graph [label="B+ Tree", labelloc="t"];',
        ]
        self._append_dot_nodes(lines, self.root)
        self._append_dot_edges(lines, self.root)
        lines.append("}")
        return "\n".join(lines)

    def _append_dot_nodes(self, lines: List[str], node: BPlusTreeNode) -> None:
        node_id = str(id(node))
        if node.is_leaf:
            label = "|".join(str(k) for k in node.keys) or "empty"
            lines.append(f'  "{node_id}" [label="Leaf: {label}", shape="box"];')
            return

        label = "|".join(str(k) for k in node.keys) or "root"
        lines.append(f'  "{node_id}" [label="Internal: {label}", shape="ellipse"];')
        for child in node.children:
            self._append_dot_nodes(lines, child)

    def _append_dot_edges(self, lines: List[str], node: BPlusTreeNode) -> None:
        node_id = str(id(node))
        if node.is_leaf:
            if node.next:
                lines.append(
                    f'  "{node_id}" -> "{id(node.next)}" [style="dashed", color="blue"];'
                )
            return

        for child in node.children:
            lines.append(f'  "{node_id}" -> "{id(child)}";')
            self._append_dot_edges(lines, child)

    def _add_nodes(self, dot, node: BPlusTreeNode) -> None:
        node_id = str(id(node))
        if node.is_leaf:
            label = "|".join(str(k) for k in node.keys) or "empty"
            dot.node(node_id, f"Leaf: {label}", shape="box")
        else:
            label = "|".join(str(k) for k in node.keys) or "root"
            dot.node(node_id, f"Internal: {label}", shape="ellipse")
            for child in node.children:
                self._add_nodes(dot, child)

    def _add_edges(self, dot, node: BPlusTreeNode) -> None:
        if node.is_leaf:
            if node.next:
                dot.edge(str(id(node)), str(id(node.next)), style="dashed", color="blue")
            return

        for child in node.children:
            dot.edge(str(id(node)), str(id(child)))
            self._add_edges(dot, child)

    def _find_leaf(self, key: int) -> BPlusTreeNode:
        node = self.root
        while not node.is_leaf:
            idx = bisect_right(node.keys, key)
            node = node.children[idx]
        return node

    def _first_key(self, node: BPlusTreeNode) -> int:
        cur = node
        while not cur.is_leaf:
            cur = cur.children[0]
        return cur.keys[0] if cur.keys else -1

    def _recompute_keys(self, node: BPlusTreeNode) -> None:
        if node.is_leaf:
            return
        if len(node.children) <= 1:
            node.keys = []
            return
        node.keys = [self._first_key(child) for child in node.children[1:]]
