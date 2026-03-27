# Module B Runbook

This runbook gives the exact end-to-end flow for running the packaged Module B system, verifying the assignment features, and refreshing the key evidence artifacts.

## 1. Prerequisites

- Node.js 18+
- npm 9+
- MySQL 8+
- Python 3.10+ with `matplotlib` if benchmark plots need to be regenerated

## 2. Package entry points

- backend root: `Module_B/app/backend`
- frontend root: `Module_B/app/frontend`
- packaged schema copy: `Module_B/sql/init_schema.sql`
- packaged log artifact: `Module_B/logs/audit.log`
- packaged evidence folders: `Module_B/evidence/*`

## 3. Environment preparation

The packaged submission is intentionally source-only. It does **not** include `node_modules/`, `.npm-cache/`, or a live `.env` file.

1. Copy `app/backend/.env.example` to `app/backend/.env`
2. Fill in:
   - `DB_HOST`
   - `DB_PORT`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_NAME`
   - `PORTFOLIO_INTEGRITY_SECRET`
3. Add Google Drive credentials only if the full BlindDrop upload/download flow will be demonstrated

## 4. Database setup

From `Module_B/app/backend` run:

```powershell
Get-Content .\sql\init_schema.sql | mysql -h 127.0.0.1 -P 3306 -u <db_user> -p --protocol=TCP
```

This creates:

- core BlindDrop tables
- `portfolio_entries`
- production indexes
- the application-side integrity and tamper-detection path used by the submission

## 5. Start the application

From `Module_B/app/backend` run:

```powershell
npm install
npm run dev
```

Verify:

- app: `http://localhost:4000`
- health: `http://localhost:4000/api/health`

Expected result:

```json
{"status":"ok"}
```

For a packaged end-to-end verifier that seeds demo data, starts the backend, exercises auth/RBAC/CRUD, and confirms tamper detection, run:

```powershell
npm run verify:e2e
```

## 6. Seed reproducible demo data

From `Module_B/app/backend` run:

```powershell
node reports/seed_module_b_demo.js
```

This creates a predictable local dataset containing:

- one active vault
- one MAIN token
- one SUB token
- portfolio rows suitable for admin CRUD and denied-access proof

## 7. Verify the assignment-facing APIs

### Authentication

- `POST /api/auth/login`
- `GET /api/auth/isAuth`

### Portfolio CRUD

- `GET /api/portfolio`
- `GET /api/portfolio/:entryId`
- `POST /api/portfolio`
- `PUT /api/portfolio/:entryId`
- `DELETE /api/portfolio/:entryId`

### Security and evidence

- `GET /api/security/unauthorized-check`
- `GET /api/module-b/evidence`

## 8. Regenerate evidence if needed

### API evidence

Capture request/response output with PowerShell, Postman, or browser devtools and update `evidence/api_evidence/`.

### Audit evidence

After exercising the protected routes, copy the relevant log lines from `logs/audit.log` into `evidence/audit_log_evidence/` if a fresh package is needed.

### Database evidence

Run the SQL inspection commands described in `evidence/database_evidence/README.md` and refresh the text files if the package is being rebuilt.

### Benchmark evidence

From `Module_B/app/backend` run:

```powershell
node reports/index_benchmark.js > ..\..\evidence\benchmark_evidence\benchmark_results.txt
```

Then from `Module_B` run:

```powershell
python scripts\generate_benchmark_assets.py
```

This refreshes:

- `benchmark_summary.md`
- `duration_comparison.png`
- `speedup_comparison.png`
- `rows_examined.png`
- `explain_plan_table.md`
- `benchmark_results.json`
- `benchmark_comparison.csv`

## 9. Recommended presentation order

1. show `GET /api/health`
2. log in as admin
3. show `GET /api/auth/isAuth`
4. show admin list/create/update/delete on `/api/portfolio`
5. log in as user
6. show a denied user action
7. run `GET /api/security/unauthorized-check`
8. open `logs/audit.log`
9. show the benchmark table and plots
10. open `GET /api/module-b/evidence`

## 10. Final packaging check

Before submission, confirm that `Module_B` contains:

- source code
- schema scripts
- report notebook
- markdown reports
- packaged `logs/audit.log`
- API evidence
- DB evidence
- audit evidence
- benchmark evidence

