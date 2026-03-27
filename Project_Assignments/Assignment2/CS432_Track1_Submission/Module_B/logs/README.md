# Logs

This folder contains the packaged audit-log artifact for the Module B submission.

## Included file

- `audit.log`

## Why it is included

The assignment expects local security logging that makes protected actions and suspicious behavior observable. The packaged `audit.log` demonstrates that the backend records:

- successful logins
- protected CRUD mutations
- denied access attempts
- unauthorized-check execution

## Relationship to the evidence folders

The complete log file is stored here as the examiner-facing artifact. Shorter, curated excerpts and explanations are stored in:

- `evidence/audit_log_evidence/audit_log_snapshot.txt`
- `evidence/audit_log_evidence/audit_summary.md`

