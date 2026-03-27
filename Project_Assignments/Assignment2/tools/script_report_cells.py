import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "CS432_Track1_Submission" / "Module_A" / "report.ipynb"
data = json.loads(path.read_text(encoding="utf-8-sig"))

for idx in [3, 5, 7, 9, 11, 12, 13, 14, 15, 18, 19]:
    cell = data["cells"][idx]
    print("\n--- Cell", idx, cell["cell_type"], "---")
    print("".join(cell.get("source", [])).strip())
