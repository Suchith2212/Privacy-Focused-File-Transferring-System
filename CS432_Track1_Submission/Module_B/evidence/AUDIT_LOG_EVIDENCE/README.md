# Audit Log Evidence

This folder contains the written and extracted proof that Module B records security-relevant and business-relevant actions to a local log file.

## Packaged files

- `01_audit_log_snapshot.txt`
- `02_audit_summary.md`

## What this evidence demonstrates

- successful login activity is logged
- protected CRUD actions are logged
- denied access attempts are logged
- unauthorized-check execution is logged
- the log format contains a tamper-evident hash chain

## Main packaged log artifact

The full log file included with the package is:

- `Module_B/logs/audit.log`

This evidence folder exists to provide shorter excerpts and a written explanation that can be read quickly during evaluation.
