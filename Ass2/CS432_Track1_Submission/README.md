# CS432 Track 1 Submission

This folder is the final combined submission package for **CS432 Track 1 Assignment 2**. It contains the completed **Module A** and **Module B** deliverables derived from the BlindDrop project, together with evaluator-facing reports, notebooks, evidence folders, and technical documentation.

## Submission summary

- **Project title:** BlindDrop / `Project_432`
- **Submission scope:** custom B+ Tree implementation, project-specific index integration, local authenticated web application, RBAC CRUD, audit logging, tamper detection, and SQL optimization
- **Primary source project:** `Project_432`
- **Packaged submission folder:** `CS432_Track1_Submission`

## Package structure

- `Docs/`
  Shared submission documents, cover page, end-to-end project documentation, demo guide, checklist, architecture notes, API reference, and assignment PDF.
- `Module_A/`
  Final Module A package containing the standalone Python B+ Tree database layer, BlindDrop integration, tree visualizations, benchmarks, evidence, and notebook report.
- `Module_B/`
  Final Module B package containing the backend, frontend, SQL schema, logs, evidence, technical documentation, and notebook report.

## What this submission demonstrates

- a B+ Tree implemented from scratch in Python
- a brute-force comparison baseline and lightweight DB/table wrapper
- project-specific indexing over the BlindDrop data domain using `Project_432/backend/database_export.json`
- Graphviz-based visualization of integrated tree structures
- detailed Module A benchmarking and parity validation
- a local database-backed BlindDrop web application
- session-based login and validation
- role mapping from BlindDrop credentials to `admin` and `user`
- portfolio CRUD with owner-aware RBAC
- tamper-evident audit logging
- unauthorized direct database modification detection
- SQL index design backed by `EXPLAIN` and benchmark evidence

## Recommended reading order

1. `Docs/00_COVER_PAGE.md`
2. `Docs/PROJECT_DOCUMENTATION.md`
3. `Docs/01_PROJECT_432_FINAL_REPORT.md`
4. `Module_A/README.md`
5. `Module_B/README.md`
6. `Docs/02_DEMO_AND_VERIFICATION_GUIDE.md`
7. `Docs/09_TECHNICAL_ARCHITECTURE_AND_STACK.md`
8. `Docs/10_API_REFERENCE.md`

## Important package notes

- `Module_A/report.ipynb` and `Module_B/report.ipynb` are the notebook reports included in the submission bundle.
- The Module A integration, visualization, and domain benchmarks are driven by the real snapshot export at `Project_432/backend/database_export.json`.
- The packaged Module B benchmark evidence records:
  - `Baseline full scan`: `452.8318 ms`
  - `Composite lookup index`: `40.0727 ms`
  - `Composite + covering comparison stage`: `36.8205 ms`
- The captured `EXPLAIN` output for the third Module B benchmark stage still selects `idx_portfolio_benchmark_lookup`, so that stage should be interpreted as a comparison stage with the covering index present, not as proof that MySQL switched to the covering index.

## Final manual checks before hand-in

- fill student details in `Docs/00_COVER_PAGE.md`
- insert the final hosted demo link into `Module_A/report.ipynb`
- insert the final hosted demo link into `Module_B/report.ipynb`
