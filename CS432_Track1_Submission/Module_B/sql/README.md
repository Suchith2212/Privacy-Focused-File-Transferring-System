# SQL Folder

This folder is the evaluator-facing SQL entry point for Module B.

## Use this file

- `init_schema.sql`

It mirrors the runnable backend schema in `app/backend/sql/init_schema.sql` and contains:

- core BlindDrop tables
- the Module B `portfolio_entries` table
- packaged index definitions
- the portable application-side integrity setup used by the submission

## Notes

- The schema is written to be rerunnable on ordinary MySQL 8 setups.
- Unauthorized direct database modification detection in this package is enforced primarily through the `integrity_hash` model and the protected API checks, not through a privileged trigger requirement.
