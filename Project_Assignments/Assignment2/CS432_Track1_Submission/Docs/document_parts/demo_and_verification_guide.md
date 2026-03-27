# Demo And Verification Guide

## 1. Purpose

This guide provides a clean end-to-end sequence for presenting the combined submission. The recommended order is:

1. introduce the BlindDrop product problem
2. show the running application
3. demonstrate the core product flow
4. present Module A integration and evidence
5. present Module B authentication and RBAC
6. present audit, tamper detection, and SQL optimization evidence

The package already contains prepared evidence folders, so the demo can be run live, presented from captured outputs, or handled in a mixed format.

## 2. Main package locations

- combined submission root:
  `CS432_Track1_Submission`
- Module A package:
  `CS432_Track1_Submission/Module_A`
- Module B package:
  `CS432_Track1_Submission/Module_B`
- primary source project:
  `Project_432`

## 3. Environment preparation

### 3.1 Product application prerequisites

- Node.js 18+
- MySQL 8+
- valid backend `.env` configuration
- Google Drive credentials if the full live upload/download workflow is to be demonstrated

### 3.2 Database setup for the original backend

From `Project_432/backend`:

```powershell
Get-Content .\sql\init_schema.sql | mysql -h 127.0.0.1 -P 3306 -u <db_user> -p --protocol=TCP
```

### 3.3 Start the backend

From `Project_432/backend`:

```powershell
npm install
npm run dev
```

Expected health endpoint:

- application: `http://localhost:4000`
- health: `http://localhost:4000/api/health`

Expected response:

```json
{"status":"ok"}
```

## 4. Product flow demonstration

### 4.1 Explain the BlindDrop model

State clearly:

- the vault is the primary container
- `outerToken` is public and used for vault discovery
- `innerToken` is private and used for authorization
- `MAIN` has full vault privileges
- `SUB` can be scoped to selected files

### 4.2 Create a vault

Use the UI or `POST /api/files/new-vault-upload`.

Capture or explain:

- uploaded files
- generated `outerToken`
- expiry time
- confirmation that the vault is created

### 4.3 Show access flow

Use:

- the `outerToken`
- the `MAIN` inner token

Verify:

- vault metadata loads
- file listing is visible
- remaining validity is shown

### 4.4 Show SUB token provisioning

As a `MAIN` user:

- create a SUB token
- assign selected files
- explain restricted access scope

### 4.5 Show restricted SUB access

Use the SUB token and verify:

- only scoped files are visible
- the token type is `SUB`
- the restricted access model matches the product design

## 5. Module A demonstration

### 5.1 What to explain first

Explain that Module A is not just a synthetic B+ Tree implementation. It contains:

- the required standalone B+ Tree database layer
- a BlindDrop-specific integration layer
- benchmarks and visualization evidence generated from the real exported snapshot

The source snapshot used by the packaged integration is:

- `Project_432/backend/database_export.json`

### 5.2 BlindDrop index demo

From `CS432_Track1_Submission/Module_A/integration`:

```powershell
python .\blinddrop_index_demo.py
```

Explain the four integrated paths:

- outer-token lookup
- expiry range scan
- vault-file range scan
- auth-attempt timeline scan

### 5.3 Parity and rebuild demo

From `CS432_Track1_Submission/Module_A/integration`:

```powershell
python .\db_index_parity_demo.py
```

Explain that this proves:

- synchronized write behavior
- rollback behavior on forced failure
- parity validation
- repair / rebuild from authoritative state

### 5.4 Domain benchmark

From `CS432_Track1_Submission/Module_A/integration`:

```powershell
python .\benchmark_blinddrop_paths.py
```

Use the packaged summary to explain that the B+ Tree wrapper outperforms the brute-force baseline on project-shaped paths, with approximate average speedups of:

- `15.3x` for outer-token lookup
- `37.2x` for expiry range scan
- `50.3x` for vault-file range scan
- `7.7x` for auth-attempt timeline scan

### 5.5 Detailed benchmark and visualization package

Use the packaged evidence:

- `Module_A/evidence/benchmark_operation_dashboard.png`
- `Module_A/integration/benchmark_path_dashboard.png`
- `Module_A/integration/path_speedup_benchmark.png`
- `Module_A/integration/bptree_v2/render_manifest.json`
- `Module_A/report.ipynb`

Explain that the current package includes:

- 22 detailed benchmark points
- 20 domain benchmark points
- all 19 rendered tree images

## 6. Module B demonstration

### 6.1 Login as admin

Call:

- `POST /api/auth/login`

Use:

- valid `outerToken`
- `MAIN` inner token

Expected result:

- session token returned
- role = `admin`
- vault context and expiry returned

### 6.2 Validate the session

Call:

- `GET /api/auth/isAuth`

Expected result:

- `authenticated: true`
- role and token type shown correctly

### 6.3 Login as user

Repeat the login using a valid `SUB` token.

Expected result:

- role = `user`
- same vault scope
- restricted permissions

### 6.4 Portfolio CRUD

Explain that `portfolio_entries` is the assignment-facing project-specific CRUD resource.

Show:

- `GET /api/portfolio`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

Demonstrate both:

- successful admin actions
- denied or restricted user behavior

### 6.5 Unauthorized modification detection

Call:

- `GET /api/security/unauthorized-check`

Explain:

- direct DB edits that bypass application logic cause an `integrity_hash` mismatch
- tampered rows are identifiable
- normal reads also block tampered rows

### 6.6 Evidence endpoint

Call:

- `GET /api/module-b/evidence`

Explain that this provides:

- current RBAC mapping
- portfolio index summary
- integrity-check status
- audit-event totals
- hash-chain validation state
- `EXPLAIN` output for the optimized query path

## 7. Packaged Module B benchmark explanation

The current packaged benchmark records:

- `Baseline full scan`: `452.8318 ms`
- `Composite lookup index`: `40.0727 ms`
- `Composite + covering comparison stage`: `36.8205 ms`

Use the following explanation:

- before optimization, MySQL scanned the table and sorted results separately
- after optimization, MySQL used the composite lookup path and reduced the effective scan to one row in the captured plan
- the third stage is a comparison stage with the covering index present
- the captured `EXPLAIN` still chooses `idx_portfolio_benchmark_lookup`

## 8. Best evidence to show

### 8.1 Module A

- `Module_A/report.ipynb`
- rendered tree gallery
- benchmark dashboards
- parity demo output

### 8.2 Module B

- `Module_B/report.ipynb`
- `Module_B/evidence/api_evidence/`
- `Module_B/evidence/database_evidence/`
- `Module_B/evidence/audit_log_evidence/`
- `Module_B/evidence/benchmark_evidence/`
- `Module_B/logs/audit.log`

## 9. Suggested viva talking points

- why the same BlindDrop credential model was reused for RBAC
- why `portfolio_entries` was added instead of overloading file tables
- how Module A uses the real exported dataset rather than a synthetic sample
- why the benchmark stages are named `Baseline full scan`, `Composite lookup index`, and `Composite + covering comparison stage`
- why the third Module B benchmark stage should not be misrepresented as a switch to the covering index

