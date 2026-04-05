# Failure Simulation Checklist (Module B)

## Goal
Demonstrate rollback safety and no partial data under concurrent/failure conditions.

## Scenarios
1. Trigger abrupt backend stop during active request burst.
2. Force invalid token flood to observe CAPTCHA/rate limiting under load.
3. Simulate partial operation attempt (for example, interrupted download/upload) and verify final data state consistency.

## Evidence to save in `evidence/`
- API logs/snippets
- summary JSON from load script
- before/after table snapshots
- notes on observed rollback behaviour
