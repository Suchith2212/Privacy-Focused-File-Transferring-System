# Module A - Lightweight DBMS with B+ Tree

## Run

```powershell
cd Module_A
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python benchmark.py
```

## What this includes

- `database/bplustree.py`: B+ Tree with insert/delete/search/update/range query/get all + Graphviz.
- `database/bruteforce.py`: Linear baseline structure.
- `database/table.py`: Table abstraction for record operations.
- `database/db_manager.py`: Multi-table manager.
- `benchmark.py`: Automated timing + memory benchmarking and plots.
- `report.ipynb`: Notebook scaffold for final report.

## Expected outputs

Running `python benchmark.py` should generate:

- `benchmark_insert.png`
- `benchmark_search.png`
- `benchmark_delete.png`
- `benchmark_range.png`
- `benchmark_memory.png`
- `bplustree_visualization.png` if Graphviz rendering works
- `bplustree_visualization.dot` if the Graphviz executable is not installed

## Submission checklist

- Run the benchmark and keep the generated plots in this folder.
- Add your benchmark observations and conclusion to `report.ipynb`.
- Add your 3-5 minute demo video link in `report.ipynb`.
- Be ready to explain insert/search/delete/range query complexity and one node split example during viva.
