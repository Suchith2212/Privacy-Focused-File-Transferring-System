import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "CS432_Track1_Submission" / "Module_A" / "report.ipynb"

with path.open("r", encoding="utf-8-sig") as f:
    data = json.load(f)

for i, cell in enumerate(data.get("cells", [])):
    cell_type = cell.get("cell_type", "")
    source = "".join(cell.get("source", [])) if isinstance(cell.get("source"), list) else cell.get("source", "")
    prefix = source.strip().splitlines()[0] if source.strip() else ""
    print(f"{i}: {cell_type}: {prefix[:80]}")
