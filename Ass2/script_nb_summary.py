import json
path = 'CS432_Track1_Submission/Module_A/report.ipynb'
with open(path,'r',encoding='utf-8') as f:
    data=json.load(f)
for i,cell in enumerate(data.get('cells', [])):
    cell_type=cell.get('cell_type','')
    source=''.join(cell.get('source',[])) if isinstance(cell.get('source'), list) else cell.get('source','')
    prefix=source.strip().splitlines()[0] if source.strip() else ''
    print(f"{i}: {cell_type}: {prefix[:80]}")
