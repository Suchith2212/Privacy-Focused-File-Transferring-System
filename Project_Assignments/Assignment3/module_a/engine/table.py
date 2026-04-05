"""Table abstraction for Assignment 3, strictly backed by B+ Tree storage."""

from __future__ import annotations

from typing import Any

from .bplustree import BPlusTree


class Table:
    def __init__(self, name: str, index_type: str = "bplustree", order: int = 4):
        self.name = name
        self.index_type = index_type
        if index_type != "bplustree":
            raise ValueError("Assignment 3 tables must use 'bplustree' index_type.")
        self.index = BPlusTree(order=order)

    def insert(self, key: int, value: Any) -> None:
        self.index.insert(key, value)

    def select(self, key: int):
        return self.index.search(key)

    def update(self, key: int, value: Any) -> bool:
        return self.index.update(key, value)

    def delete(self, key: int) -> bool:
        return self.index.delete(key)

    def range_query(self, start_key: int, end_key: int):
        return self.index.range_query(start_key, end_key)

    def all_rows(self):
        return self.index.get_all()
