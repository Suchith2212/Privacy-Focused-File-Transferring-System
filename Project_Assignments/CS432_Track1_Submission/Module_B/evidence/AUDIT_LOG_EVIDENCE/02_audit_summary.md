# Audit Summary

## Overview

The packaged `logs/audit.log` and the extracted `01_audit_log_snapshot.txt` show that the Module B backend records both normal operations and security-sensitive events.

## Representative actions visible in the package

| Action | Why it matters |
| --- | --- |
| `auth.login.success` | proves successful session creation is auditable |
| `portfolio.create` | proves protected writes are auditable |
| `portfolio.update` | proves updates are traceable |
| `portfolio.delete` | proves soft delete is traceable |
| `portfolio.read.denied` | proves authorization failures are recorded |
| `security.unauthorized-check` | proves integrity-check execution is recorded |

## Hash-chain model

Each log line contains:

- `previousHash`
- `entryHash`

This means the file is not just append-only text. It is structured so that removing or reordering entries can break the chain and become detectable.

## Packaged evidence note

The packaged API summary reports:

- audit event count: `18`
- hash chain valid: `True`

That aligns with the packaged log artifact and strengthens the submission’s auditability story.
