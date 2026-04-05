# Module B Load and Failure Plan

## Objectives
- Simulate concurrent users
- Trigger race conditions on critical operations
- Inject failures and verify rollback behavior
- Capture throughput/latency/correctness under load

## Planned Scenarios
1. Concurrent access on same resource set
2. Burst download/upload traffic
3. Failure injection during update-heavy operations
4. Long-run stress (hundreds/thousands requests)

## Metrics
- total requests
- success/error counts
- p50/p95 latency
- correctness violations (must be zero)


## Ready Commands

### Public baseline (already completed)
```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3\module_b"
python .\concurrent_api_stress.py --mode public --base-url http://localhost:4000 --users 20 --requests-per-user 30 --out ..\evidence\module_b_public_load_summary.json
```

### Auth critical-path run (execute with real tokens)
```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3\module_b"
python .\concurrent_api_stress.py --mode auth --base-url http://localhost:4000 --outer-token <OUTER_TOKEN> --inner-token <INNER_TOKEN> --users 20 --requests-per-user 30 --out ..\evidence\module_b_auth_load_summary.json
```
