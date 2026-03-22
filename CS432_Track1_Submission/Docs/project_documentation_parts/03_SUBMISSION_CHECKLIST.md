# Submission Checklist

## 1. Cover page and identity

- [ ] student details filled in `Docs/00_COVER_PAGE.md`
- [ ] project title written consistently as `BlindDrop` / `Project_432`
- [ ] course and assignment labels match instructor expectations
- [ ] submission date verified

## 2. Root documentation package

- [ ] `Docs/PROJECT_DOCUMENTATION.md` reviewed once from top to bottom
- [ ] `Docs/01_PROJECT_432_FINAL_REPORT.md` reviewed
- [ ] `Docs/02_DEMO_AND_VERIFICATION_GUIDE.md` reviewed
- [ ] `Docs/09_TECHNICAL_ARCHITECTURE_AND_STACK.md` reviewed
- [ ] `Docs/10_API_REFERENCE.md` reviewed
- [ ] `Docs/Track1_Assignment2.pdf` included

## 3. Module A package completeness

- [ ] `Module_A/README.md` is current
- [ ] `Module_A/report.ipynb` is present and opens correctly
- [ ] final hosted demo video link added in `Module_A/report.ipynb`
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
- [ ] final hosted demo video link added in `Module_B/report.ipynb`
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

- [ ] no stale references to `Project_432/module_a`
- [ ] no stale references to old evidence folder names such as `04_SCREENSHOTS/` or `08_API_EVIDENCE/`
- [ ] root `README.md` matches the current package structure
- [ ] both module readmes match the current package structure
- [ ] final submission folder opens cleanly and reads as a coherent bundle
