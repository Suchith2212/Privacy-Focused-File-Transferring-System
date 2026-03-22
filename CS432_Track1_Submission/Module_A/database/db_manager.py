"""Simple database manager for multiple indexed tables."""

from __future__ import annotations

from .table import Table


class DatabaseManager:
    def __init__(self):
        self.tables = {}

    def create_table(self, table_name: str, index_type: str = "bplustree", order: int = 4) -> Table:
        if table_name in self.tables:
            raise ValueError(f"table '{table_name}' already exists")
        table = Table(table_name, index_type=index_type, order=order)
        self.tables[table_name] = table
        return table

    def drop_table(self, table_name: str) -> None:
        if table_name not in self.tables:
            raise ValueError(f"table '{table_name}' does not exist")
        del self.tables[table_name]

    def get_table(self, table_name: str) -> Table:
        if table_name not in self.tables:
            raise ValueError(f"table '{table_name}' does not exist")
        return self.tables[table_name]
