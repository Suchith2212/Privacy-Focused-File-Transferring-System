import json
from pathlib import Path
path = Path('CS432_Track1_Submission/Module_A/report.ipynb')
data = json.loads(path.read_text(encoding='utf-8'))
for i, cell in enumerate(data['cells']):
    src = cell.get('source', [])
    text = ''.join(src) if isinstance(src, list) else src
    summary = text.strip().splitlines()[0] if text.strip() else ''
    if cell['cell_type'] == 'markdown':
        print(f"{i:03d} MD: {summary[:60]}")
    else:
        print(f"{i:03d} CODE: {summary[:60]}")
