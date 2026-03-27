import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "Project_432" / "backend" / "database_export.json"

with path.open("r", encoding="utf-8") as f:
    data = json.load(f)

for key in ["files", "auth_attempts"]:
    rows = data.get(key, [])
    if not rows:
        continue
    print("\n", key, "count", len(rows))
    print("sample keys", rows[0].keys())
    for k, v in rows[0].items():
        print("  ", k, v)
        if isinstance(v, str) and len(v) > 120:
            break
