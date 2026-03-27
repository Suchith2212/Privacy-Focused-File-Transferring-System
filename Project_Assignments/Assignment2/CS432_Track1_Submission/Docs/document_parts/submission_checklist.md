# Submission Checklist

## 1. Cover page and identity

- [ ] student details reviewed in `Docs/project_documentation.md`
- [ ] project title written consistently as `BlindDrop` / `Project_432`
- [ ] course and assignment labels match instructor expectations
- [ ] submission date verified

## 2. Root documentation package

- [ ] `Docs/project_documentation.md` reviewed once from top to bottom
- [ ] `Docs/Project_Documentation.pdf` reviewed
- [ ] `Docs/document_parts/demo_and_verification_guide.md` reviewed
- [ ] `Docs/document_parts/technical_architecture_and_stack.md` reviewed
- [ ] `Docs/document_parts/api_reference.md` reviewed
- [ ] `Docs/Track1_Assignment2.pdf` included

## 3. Module A package completeness

- [ ] `Module_A/README.md` is current
- [ ] `Module_A/report.ipynb` is present and opens correctly
- [x] final hosted demo video link added in `Module_A/report.ipynb`
- [ ] `Module_A/database/` contains the standalone B+ Tree engine files
- [ ] `Module_A/integration/` contains the BlindDrop integration files
- [ ] `Module_A/integration/bptree_v2/` contains the rendered tree PNGs
- [ ] `Module_A/integration/bptree_v2/render_manifest.json` is present
- [ ] `Module_A/evidence/` contains benchmark outputs and summary Markdown files

## 4. Module A technical proof

- [ ] B+ Tree supports insert, search, delete, update, and range query
- [ ] brute-force baseline is included
- [ ] tree visualization tooling is included
- [ ] parity / rebuild evidence is included
- [ ] domain benchmark uses `Project_432/backend/database_export.json`
- [ ] detailed benchmark outputs and dashboard plots are included

## 5. Module B package completeness

- [ ] `Module_B/README.md` is current
- [ ] `Module_B/report.ipynb` is present and opens correctly
- [x] final hosted demo video link added in `Module_B/report.ipynb`
- [ ] `Module_B/app/backend/` contains the backend source
- [ ] `Module_B/app/frontend/` contains the frontend
- [ ] `Module_B/sql/` contains the packaged schema copy
- [ ] `Module_B/logs/audit.log` is included
- [ ] `Module_B/evidence/` contains API, DB, audit, and benchmark evidence

## 6. Module B technical proof

- [ ] `POST /api/auth/login` and `GET /api/auth/isAuth` are documented
- [ ] RBAC mapping is documented as `MAIN -> admin` and `SUB -> user`
- [ ] `portfolio_entries` is documented as the project-specific CRUD resource
- [ ] audit logging and hash-chain fields are documented
- [ ] unauthorized direct database modification detection is documented
- [ ] SQL indexing and benchmark evidence are documented

## 7. Packaged benchmark values

- [ ] Module B benchmark wording uses:
  - `Baseline full scan`
  - `Composite lookup index`
  - `Composite + covering comparison stage`
- [ ] benchmark values are consistent with packaged evidence:
  - `452.8318 ms`
  - `40.0727 ms`
  - `36.8205 ms`
- [ ] documentation clarifies that the third stage still uses `idx_portfolio_benchmark_lookup` in the captured `EXPLAIN`

## 8. Final package review

- [ ] Module A integration references point to `CS432_Track1_Submission/Module_A/integration`
- [ ] no stale references to old evidence folder names such as `04_SCREENSHOTS/` or `api_evidence/`
- [ ] root `README.md` matches the current package structure
- [ ] both module readmes match the current package structure
- [ ] final submission folder opens cleanly and reads as a coherent bundle
