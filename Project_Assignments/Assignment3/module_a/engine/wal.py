"""Append-only write-ahead logging for Module A transaction support."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator


class WriteAheadLog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def append(self, record: Dict) -> None:
        payload = dict(record)
        payload.setdefault("ts", datetime.now(timezone.utc).isoformat())
        line = json.dumps(payload, separators=(",", ":"))
        with self.path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
            os.fsync(f.fileno())

    def iter_records(self) -> Iterator[Dict]:
        with self.path.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                yield json.loads(line)

    def all_records(self) -> Iterable[Dict]:
        return list(self.iter_records())
