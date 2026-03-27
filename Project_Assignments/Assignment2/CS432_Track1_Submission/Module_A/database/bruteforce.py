"""Linear baseline DB for benchmarking."""

from __future__ import annotations

from typing import Any, List, Tuple


class BruteForceDB:
    def __init__(self):
        self.data: List[Tuple[int, Any]] = []

    def insert(self, key: int, value: Any) -> None:
        for idx, (k, _) in enumerate(self.data):
            if k == key:
                self.data[idx] = (key, value)
                return
        self.data.append((key, value))

    def search(self, key: int):
        for k, v in self.data:
            if k == key:
                return v
        return None

    def update(self, key: int, value: Any) -> bool:
        for idx, (k, _) in enumerate(self.data):
            if k == key:
                self.data[idx] = (k, value)
                return True
        return False

    def delete(self, key: int) -> bool:
        for idx, (k, _) in enumerate(self.data):
            if k == key:
                self.data.pop(idx)
                return True
        return False

    def range_query(self, start: int, end: int):
        return sorted([(k, v) for k, v in self.data if start <= k <= end], key=lambda item: item[0])

    def get_all(self):
        return sorted(self.data, key=lambda item: item[0])
