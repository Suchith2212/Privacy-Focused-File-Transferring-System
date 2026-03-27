# Module A

This folder is the final **Module A** submission package for **CS432 Track 1 Assignment 2**. It packages the custom Python B+ Tree implementation, the lightweight database wrapper built around it, and the BlindDrop-specific integration layer used to connect the structure back to the project domain.

## Submission objective

Module A requires:

- a B+ Tree implemented from scratch in Python
- value storage through a lightweight database/table abstraction
- exact search, insertion, deletion, update, and range query support
- a brute-force baseline for comparison
- automated benchmarking
- Graphviz-based tree visualization
- a report and evidence demonstrating the above

This package satisfies those requirements while also showing how the same B+ Tree can be applied to real BlindDrop-style lookup paths.

The current packaged evidence is driven by the exported backend snapshot at `Project_432/backend/database_export.json`, so the integration, parity proof, renderer, and domain benchmark all start from the same reproducible project dataset.

## Package structure

- `database/`
  The standalone Module A engine: B+ Tree, brute-force baseline, table abstraction, and database manager.
- `integration/`
  BlindDrop-specific indexing layer, snapshot-driven demos, parity proof, domain benchmarks, renderer manifest, and generated Graphviz visuals.
- `docs/reference/`
  Submission-facing explanation documents and evidence guidance.
- `evidence/`
  Console outputs, JSON outputs, plot artifacts, and summary docs prepared for submission.
- `report.ipynb`
  Notebook report for the Module A submission.

## Recommended reading order

1. `report.ipynb`
2. [docs/reference/integration_report.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/docs/reference/integration_report.md)
3. [docs/reference/integration_summary.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/docs/reference/integration_summary.md)
4. [database/README.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/database/README.md)
5. [integration/README.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/README.md)
6. [evidence/README.md](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/evidence/README.md)

## Assignment mapping

| Module A requirement | Implementation in this package |
| --- | --- |
| B+ Tree from scratch | `database/bplustree.py` |
| Brute-force baseline | `database/bruteforce.py` |
| Table abstraction | `database/table.py` |
| Database manager | `database/db_manager.py` |
| Exact search / insert / delete / update / range query | `database/bplustree.py` |
| Graphviz visualization | `database/bplustree.py`, `integration/render_bptree_v2.py`, `integration/visualize_blinddrop_indexes.py` |
| Performance analysis | `integration/benchmark_detailed.py`, `integration/benchmark_blinddrop_paths.py`, generated dashboard plots |
| Submission evidence | `evidence/` and `integration/reports/*.md` |

## Key design decision

The package keeps two layers distinct:

- **Standalone Module A database layer**
  The custom B+ Tree and database wrapper required by the assignment.
- **BlindDrop integration layer**
  A project-specific adapter showing how the same data structure can index real application-shaped paths.

This is stronger than submitting only a synthetic classroom example because it preserves the assignment's from-scratch implementation while also connecting it to the actual project domain.

## Important source files

- [bplustree.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/database/bplustree.py)
- [bruteforce.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/database/bruteforce.py)
- [table.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/database/table.py)
- [db_manager.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/database/db_manager.py)
- [blinddrop_index_manager.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/blinddrop_index_manager.py)
- [blinddrop_index_demo.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/blinddrop_index_demo.py)
- [db_index_parity_demo.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/db_index_parity_demo.py)
- [benchmark_blinddrop_paths.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/benchmark_blinddrop_paths.py)
- [benchmark_detailed.py](/F:/SEM%20IV/lessons/DB/Project/Project_Assignments/Assignment2/CS432_Track1_Submission/Module_A/integration/benchmark_detailed.py)

## Submission status

This package already includes:

- source code
- notebook report
- markdown documentation
- domain integration explanation
- parity proof
- benchmark outputs
- Graphviz visuals

Notable generated artifacts include:

- `integration/path_speedup_benchmark.png`
- `integration/outer_lookup_benchmark.png`
- `evidence/memory_dashboard.png`
- `integration/bptree_v2/render_manifest.json`

Hosted demo video: https://youtu.be/T24vXjLI5dI?si=URhvw7nJmuug-nHH

