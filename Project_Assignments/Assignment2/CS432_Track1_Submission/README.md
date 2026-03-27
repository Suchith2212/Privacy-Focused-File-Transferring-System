# CS432 Track 1 Submission

This folder is the final combined submission package for **CS432 Track 1 Assignment 2**. It contains the completed **Module A** and **Module B** deliverables derived from the Ghost Drop project, together with evaluator-facing reports, notebooks, evidence folders, and technical documentation.

## Submission summary

- **Project title:** Ghost Drop / `Ghost_Drop`
- **Submission scope:** custom B+ Tree implementation, project-specific index integration, local authenticated web application, RBAC CRUD, audit logging, tamper detection, and SQL optimization
- **Primary source project:** `Ghost_Drop`
- **Packaged submission folder:** `CS432_Track1_Submission`

## Package structure

- `Docs/`
  Shared submission documents, cover page, end-to-end project documentation, demo guide, checklist, architecture notes, API reference, and assignment PDF.
- `Module_A/`
  Final Module A package containing the standalone Python B+ Tree database layer, Ghost Drop integration, tree visualizations, benchmarks, evidence, and notebook report.
- `Module_B/`
  Final Module B package containing the backend, frontend, SQL schema, logs, evidence, technical documentation, and notebook report.

## What this submission demonstrates

- a B+ Tree implemented from scratch in Python
- a brute-force comparison baseline and lightweight DB/table wrapper
- project-specific indexing over the Ghost Drop data domain using `Ghost_Drop/backend/database_export.json`
- Graphviz-based visualization of integrated tree structures
- detailed Module A benchmarking and parity validation
- a local database-backed Ghost Drop web application
- session-based login and validation
- role mapping from Ghost Drop credentials to `admin` and `user`
- portfolio CRUD with owner-aware RBAC
- tamper-evident audit logging
- unauthorized direct database modification detection
- SQL index design backed by `EXPLAIN` and benchmark evidence

## Recommended reading order

1. `Docs/project_documentation.md`
2. `Docs/Project_Documentation.pdf`
3. `Docs/Track1_Assignment2.pdf`
4. `Module_A/README.md`
5. `Module_B/README.md`
6. `Docs/document_parts/demo_and_verification_guide.md`
7. `Docs/document_parts/technical_architecture_and_stack.md`
8. `Docs/document_parts/api_reference.md`

## Important package notes

- `Module_A/report.ipynb` and `Module_B/report.ipynb` are the notebook reports included in the submission bundle.
- The Module A integration, visualization, and domain benchmarks are driven by the real snapshot export at `Ghost_Drop/backend/database_export.json`.
- The packaged Module B benchmark evidence records:
  - `Baseline full scan`: `452.8318 ms`
  - `Composite lookup index`: `40.0727 ms`
  - `Composite + covering comparison stage`: `36.8205 ms`
- The captured `EXPLAIN` output for the third Module B benchmark stage still selects `idx_portfolio_benchmark_lookup`, so that stage should be interpreted as a comparison stage with the covering index present, not as proof that MySQL switched to the covering index.

## Final hand-in notes

- Module A demo video: https://youtu.be/T24vXjLI5dI?si=URhvw7nJmuug-nHH
- Module B demo video: https://youtu.be/FzY8OeX4d5E?si=ptfeexguYQ99MdmG

