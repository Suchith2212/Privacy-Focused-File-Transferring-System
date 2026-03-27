import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "Ghost_Drop" / "backend" / "database_export.json"

print("size", path.stat().st_size)
with path.open("r", encoding="utf-8") as f:
    data = json.load(f)

print("tables", list(data.keys()))
for table, rows in data.items():
    print(table, len(rows))
    if rows:
        print(" sample keys", list(rows[0].keys()))
        break
