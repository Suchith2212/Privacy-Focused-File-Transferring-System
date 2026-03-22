import json
from pathlib import Path
path = Path('Project_432/backend/database_export.json')
print('size', path.stat().st_size)
with open(path,'r',encoding='utf-8') as f:
    data = json.load(f)
print('tables', list(data.keys()))
for table, rows in data.items():
    print(table, len(rows))
    if rows:
        print(' sample keys', list(rows[0].keys()))
        break
