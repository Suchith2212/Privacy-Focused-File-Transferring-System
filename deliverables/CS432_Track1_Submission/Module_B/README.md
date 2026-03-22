# Module B - Local API Development, RBAC, and SQL Optimization

## Run the app

```powershell
cd Module_B
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app\app.py
```

Open UI: `http://127.0.0.1:5000/ui`

## Default credentials
- Admin: `admin` / `admin123`
- Regular user: `user` / `user123`

## Required APIs included
- `POST /login`
- `GET /isAuth`
- `GET /` (welcome)
- Member portfolio CRUD under `/api/portfolio`
- Unauthorized direct DB modification detection: `GET /api/security/unauthorized-check`

## Indexing + profiling report
Run:

```powershell
python reports\index_benchmark.py
```

This generates:
- timing output (before/after indexing)
- EXPLAIN QUERY PLAN output
- `reports/index_benchmark.png`

## Expected submission evidence

- Working login with both `admin` and `user`
- RBAC proof:
  - admin can create/delete members
  - regular user can only view/update their own portfolio
- Session validation proof using `/isAuth` and protected `/api/portfolio` routes
- Audit log entries in `logs/audit.log` after create/update/delete operations
- SQL indexing evidence from:
  - `reports/index_benchmark.py`
  - `reports/index_benchmark.png`
  - `reports/optimization_report.md`

## Suggested demo flow

1. Start the Flask app and open `/ui`.
2. Login as `user` and show restricted portfolio visibility.
3. Login as `admin` and show create/delete access.
4. Trigger one update and one admin action, then open `logs/audit.log`.
5. Run `python reports\index_benchmark.py` and explain the before/after query plan.
