# Project Documentation

## 1. Document purpose

This document is the **primary end-to-end technical explanation** for the combined `CS432_Track1_Submission` package. It is written so that the full submission can be understood without needing to reconstruct context from the original working repository.

## Repository Link

GitHub Repository: https://github.com/Suchith2212/Privacy-Focused-File-Transferring-System

The package combines:

- **Module A**
  custom B+ Tree implementation, lightweight database wrapper, visualization, and BlindDrop-specific index integration
- **Module B**
  local authenticated web application, RBAC CRUD, audit logging, tamper detection, and SQL optimization

## 2. Project overview

The underlying project is **BlindDrop**, a secure temporary file-sharing system built around expiring vaults. A sender creates a vault, uploads files, receives a public `outerToken`, and controls access through one or more private `innerToken` values. `MAIN` tokens provide full vault access, while `SUB` tokens can be restricted to a selected set of files.

This product model already contains meaningful access control, expiry, and security behavior. The submission therefore uses that real domain as the foundation for both assignment modules instead of fabricating a separate unrelated academic example.

## 3. Assignment interpretation and submission strategy

The assignment requires two modules with different goals:

- **Module A**
  implement a B+ Tree from scratch, compare it with a brute-force baseline, visualize it, and benchmark it
- **Module B**
  implement a local DB-backed application with login, session validation, RBAC, CRUD, audit logging, tamper detection, and SQL optimization evidence

The main design decision in this submission was to keep the real BlindDrop domain intact while adding assignment-facing layers that remain technically defensible.

### 3.1 Strategy for Module A

Module A is split into:

- a standalone Python B+ Tree database layer that directly satisfies the assignment brief
- a BlindDrop-specific integration layer that applies the same structure to real exported project data

### 3.2 Strategy for Module B

Module B reuses the existing BlindDrop credential model instead of inventing a second artificial authentication system:

- `outerToken + MAIN innerToken` -> `admin`
- `outerToken + SUB innerToken` -> `user`

This decision keeps the submission coherent because the same credentials that govern file access also govern the assignment-facing RBAC routes.

## 4. Submission package structure

### 4.1 Root documents

- `Docs/project_documentation_parts/02_DEMO_AND_VERIFICATION_GUIDE.md`
- `Docs/project_documentation_parts/03_SUBMISSION_CHECKLIST.md`
- `Docs/project_documentation_parts/09_TECHNICAL_ARCHITECTURE_AND_STACK.md`
- `Docs/project_documentation_parts/10_API_REFERENCE.md`
- `Docs/Track1_Assignment2.pdf`

### 4.2 Module A package

- `Module_A/database/`
- `Module_A/integration/`
- `Module_A/docs/`
- `Module_A/evidence/`
- `Module_A/report.ipynb`

### 4.3 Module B package

- `Module_B/app/backend/`
- `Module_B/app/frontend/`
- `Module_B/sql/`
- `Module_B/docs/`
- `Module_B/logs/`
- `Module_B/evidence/`
- `Module_B/report.ipynb`

## 5. Overall architecture

The full submission spans two runtime styles:

- **Node.js + Express + MySQL + static frontend + Google Drive**
  for the main BlindDrop product and Module B behavior
- **Python + custom B+ Tree + Graphviz tooling**
  for Module A implementation, analysis, and integration

### 5.1 Product-side architecture

- **Frontend**
  static HTML, CSS, and JavaScript served by Express
- **Backend**
  route handling, validation, security services, audit logging, and DB access
- **Database**
  MySQL stores authoritative metadata and relational state
- **Blob storage**
  Google Drive stores uploaded file bytes in the product workflow

### 5.2 Assignment-side architecture

- **Module A**
  standalone B+ Tree engine plus integration scripts, benchmarks, and renderers
- **Module B**
  session-based access layer, portfolio CRUD, evidence endpoint, integrity guard, and optimization reports

## 6. BlindDrop product model

BlindDrop is built around an expiring-vault workflow:

1. a sender creates a vault
2. files are uploaded
3. a public `outerToken` is generated
4. a private `MAIN` inner token controls full access
5. optional `SUB` tokens can be created for limited file visibility
6. downloads are controlled and can be one-time
7. vaults and jobs are expiry-aware

This product model matters because both modules were designed to align with it rather than replace it.

## 7. Module A end-to-end explanation

### 7.1 Module A objective

Module A demonstrates:

- a B+ Tree from scratch
- a brute-force comparison baseline
- a lightweight table/database abstraction
- Graphviz visualization
- performance benchmarking
- integration with real BlindDrop-style data

### 7.2 Standalone Module A implementation

The standalone Module A code lives in:

- `Module_A/database/bplustree.py`
- `Module_A/database/bruteforce.py`
- `Module_A/database/table.py`
- `Module_A/database/db_manager.py`

This layer directly satisfies the assignment brief.

#### 7.2.1 B+ Tree logic

The B+ Tree implementation supports:

- insertion
- exact search
- update
- deletion
- range query
- ordered traversal through linked leaves
- visualization output

The design follows the core B+ Tree rules:

- internal nodes store separator keys
- leaf nodes store the actual values
- leaves are linked for ordered traversal
- nodes split when full
- underflow conditions are handled through redistribution or merge

#### 7.2.2 Lightweight DB abstraction

The table/database wrapper exists to show how the tree can be used as part of a simple structured data layer rather than only as a standalone algorithmic object. This makes the module more complete and closer to the assignment's database-engine intent.

### 7.3 Module A integration with BlindDrop

The packaged integration uses the exported dataset at:

- `Project_432/backend/database_export.json`

This is a key strength of the submission. The integration is not based on random classroom-only rows. Instead, it derives realistic indexes from the actual BlindDrop data snapshot.

#### 7.3.1 Snapshot-driven indexing

The integration reads the exported project data and constructs B+ Tree-backed indexes for:

- `outer_token -> vault_id`
- `expires_at_epoch -> vault_id[]`
- `(vault_id, status, created_at_epoch) -> file_id[]`
- `(session_id, attempt_time_epoch) -> auth_attempt_id[]`

#### 7.3.2 Posting list design

Real project data often contains duplicate logical keys. The integration therefore uses a posting-list wrapper so the tree can represent one-to-many relationships without rewriting the standalone B+ Tree implementation.

### 7.4 Module A parity, rebuild, and recovery story

One of the stronger parts of the current package is the parity demonstration. The integration shows:

- synchronized writes to authoritative state and custom index
- rollback when an injected index failure occurs
- parity validation after updates
- repair on read-path mismatch
- full rebuild from authoritative state

This gives the project a defensible answer to the question: *what happens if the custom index diverges from the underlying database view?*

### 7.5 Module A visualization package

The Module A renderer generates a set of B+ Tree images under:

- `Module_A/integration/bptree_v2/`

The package currently contains:

- **19 rendered tree PNGs**
- a render manifest at `Module_A/integration/bptree_v2/render_manifest.json`

The render manifest records snapshot origin, row counts, and index statistics so the visual package is traceable and not just decorative.

### 7.6 Module A benchmark package

Two benchmark styles are included.

#### 7.6.1 Domain benchmark

`Module_A/integration/benchmark_blinddrop_paths.py` compares the B+ Tree wrapper with brute force on BlindDrop-shaped paths. The current packaged run uses:

- the real exported snapshot
- **20 deterministic benchmark points**

Approximate average speedups in the packaged result are:

- outer-token lookup: `15.3x`
- expiry range scan: `37.2x`
- vault-file range scan: `50.3x`
- auth-attempt timeline scan: `7.7x`

#### 7.6.2 Detailed benchmark

`Module_A/integration/benchmark_detailed.py` performs a denser sweep across larger dataset sizes and generates:

- insertion plot
- search plot
- deletion plot
- range-query plot
- random workload plot
- speedup plot
- memory plot
- combined dashboard

The current packaged detailed run contains:

- **22 benchmark points**
- **2 repeats per point**

### 7.7 Module A evidence and report

The Module A package includes:

- a full notebook report in `Module_A/report.ipynb`
- integration and evidence Markdown summaries
- visualization assets
- benchmark outputs
- parity outputs

The notebook has been expanded into a complete report structure with problem statement, solution overview, implementation details, B+ Tree logic, visualization, performance analysis, discussion, and conclusion.

## 8. Module B end-to-end explanation

### 8.1 Module B objective

Module B demonstrates:

- local authenticated access
- session validation
- admin versus regular-user behavior
- CRUD over project-specific data
- audit logging
- unauthorized direct database modification detection
- SQL indexing and benchmark evidence

### 8.2 Authentication and role mapping

Instead of inventing a separate username/password system, Module B maps existing BlindDrop credentials to roles:

- `MAIN` token -> `admin`
- `SUB` token -> `user`

This is implemented through:

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

The backend issues a session token for protected Module B routes and revalidates vault/token state against MySQL on subsequent requests.

### 8.3 Why `portfolio_entries` was added

The existing BlindDrop tables are real business tables, but they are not ideal as the assignment CRUD target:

- `vaults` are top-level containers
- `inner_tokens` are secrets
- `files` are tightly coupled to upload/download and storage lifecycle

To provide a clean evaluation surface, the project introduces:

- `portfolio_entries`

This table supports:

- admin/user RBAC
- row ownership
- integrity hashing
- benchmarkable query patterns
- soft delete behavior

### 8.4 Module B CRUD and RBAC behavior

The protected CRUD routes are:

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

#### Admin behavior

- can list all active entries in the vault
- can create entries
- can update any active entry in the vault
- can delete entries
- can run the unauthorized-check route

#### User behavior

- can list only owned active entries
- can read only owned active entries
- can update only owned active entries
- cannot create entries
- cannot delete entries
- cannot run unauthorized-check

### 8.5 Module B security controls

#### 8.5.1 Audit logging

The backend writes JSON-line audit events to:

- `Module_B/logs/audit.log`

Each entry includes:

- timestamp
- severity
- session ID
- IP address
- user agent
- action
- `previousHash`
- `entryHash`

This creates a tamper-evident chain rather than a plain text event list.

#### 8.5.2 Unauthorized direct DB modification detection

Each `portfolio_entries` row stores an `integrity_hash` derived from protected fields plus a server-side secret. If a row is modified directly in MySQL without going through application logic, the system can detect it.

Two detection paths exist:

- **passive read-time protection**
  tampered rows are blocked from normal read responses
- **active admin check**
  `GET /api/security/unauthorized-check` reports tampered rows

#### 8.5.3 Anti-abuse controls

The wider product and Module B layer also include:

- rate limiting
- repeated failure tracking
- CAPTCHA challenge and verification
- temporary blocking
- security status reporting

### 8.6 Module B schema and indexing

The main application schema includes:

- `vaults`
- `inner_tokens`
- `files`
- `file_metadata`
- `file_key_access`
- `sessions`
- `auth_attempts`
- `download_logs`
- `captcha_tracking`
- `expiry_jobs`
- `portfolio_entries`

The key Module B optimization indexes include:

- `(vault_id, owner_token_id, status, updated_at)` for user listing
- `(vault_id, status, updated_at)` for admin listing
- `integrity_hash` support for tamper checks
- lookup and maintenance indexes for tokens, downloads, files, auth attempts, vault expiry, and expiry jobs

### 8.7 Module B benchmark and performance analysis

The benchmark is built around the protected portfolio list query path. The packaged benchmark stages are named:

- `Baseline full scan`
- `Composite lookup index`
- `Composite + covering comparison stage`

The packaged result is:

| Stage | Duration (ms) | Plan type | Rows examined | Extra |
| --- | ---: | --- | ---: | --- |
| Baseline full scan | `452.8318` | `ALL` | `4999` | `Using where; Using filesort` |
| Composite lookup index | `40.0727` | `ref` | `1` | `Backward index scan` |
| Composite + covering comparison stage | `36.8205` | `ref` | `1` | `Backward index scan` |

Interpretation:

- before indexing, MySQL performed a broad scan and separate sort
- after indexing, the protected query path became much narrower and faster
- the measured improvement is about `11.30x` for the composite lookup index and `12.30x` for the comparison stage with the covering index present

Important note:

The captured `EXPLAIN` output for the third stage still selects `idx_portfolio_benchmark_lookup`. Therefore, the third stage should be described as a comparison stage with the covering index available, not as proof that MySQL switched to the covering index.

### 8.8 Module B evidence and report

The Module B package includes:

- a notebook report in `Module_B/report.ipynb`
- technical docs in `Module_B/docs/`
- packaged `audit.log`
- evidence folders for API, DB, audit, and benchmarks

The notebook has been expanded into a full report structure covering problem statement, solution overview, requirement mapping, architecture, security, performance analysis, discussion, and conclusion.

## 9. How the modules connect

Although the assignment separates the work into two modules, this submission connects them through the same project domain:

- Module A uses the exported BlindDrop dataset for custom indexing, visualization, and benchmark analysis
- Module B uses the live BlindDrop application model for authentication, RBAC, auditing, and SQL optimization

This makes the combined submission stronger than a pair of disconnected examples because both modules are traceable to the same underlying system.

## 10. Evidence and reading guide

The recommended reading order for evaluation is:

1. `Docs/PROJECT_DOCUMENTATION.md`
2. `Docs/01_PROJECT_432_FINAL_REPORT.md`
3. `Module_A/README.md`
4. `Module_A/report.ipynb`
5. `Module_B/README.md`
6. `Module_B/report.ipynb`
7. `Docs/02_DEMO_AND_VERIFICATION_GUIDE.md`
8. `Docs/09_TECHNICAL_ARCHITECTURE_AND_STACK.md`
9. `Docs/10_API_REFERENCE.md`

## 11. Submission strengths

This package is strong because it provides:

- complete source code for both modules
- notebook reports for both modules
- detailed Markdown documentation
- project-specific integration instead of isolated toy examples
- visualization and benchmark evidence
- security controls backed by actual implementation
- SQL optimization backed by real measurement

## 12. Conclusion

The `CS432_Track1_Submission` package is an end-to-end submission built around the BlindDrop project. Module A demonstrates a from-scratch B+ Tree and its integration into realistic project-shaped indexing workloads. Module B demonstrates local authentication, RBAC CRUD, tamper-evident audit logging, unauthorized modification detection, and SQL optimization on a project-specific data model. Together they form one coherent technical submission rather than two unrelated deliverables.

The only remaining manual items outside the Markdown package are:

- filling in student details on the cover page
- inserting the final hosted demo link into the two notebook reports
