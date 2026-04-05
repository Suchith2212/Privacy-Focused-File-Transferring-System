# Module B Auth Profile Comparison (Endpoint-Isolated)

## Token Used
- outerToken: y8WvF76
- innerToken: Dragons432

## Profile A: Access-Only
Command:
```powershell
python module_b/concurrent_api_stress.py --mode auth --auth-pattern access --base-url http://localhost:4000 --outer-token y8WvF76 --inner-token Dragons432 --users 20 --requests-per-user 30 --out ../evidence/module_b_auth_access_only_summary.json
```
Result:
- total: 600
- success: 0
- failed: 600
- success_rate: 0.0%
- status: 429 only
- operation: vault_access only

## Profile B: List-Only
Command:
```powershell
python module_b/concurrent_api_stress.py --mode auth --auth-pattern list --base-url http://localhost:4000 --outer-token y8WvF76 --inner-token Dragons432 --users 8 --requests-per-user 20 --out ../evidence/module_b_auth_list_only_summary.json
```
Result:
- total: 160
- success: 160
- failed: 0
- success_rate: 100.0%
- status: 200 only
- operation: files_list only

## Profile C: Mixed + Pacing
Command:
```powershell
python module_b/concurrent_api_stress.py --mode auth --auth-pattern mixed --delay-ms 150 --base-url http://localhost:4000 --outer-token y8WvF76 --inner-token Dragons432 --users 8 --requests-per-user 20 --out ../evidence/module_b_auth_mixed_paced_summary.json
```
Result:
- total: 160
- success: 80
- failed: 80
- success_rate: 50.0%
- status: 200 and 429 split evenly
- operation split: 80 vault_access + 80 files_list

## Conclusion
The 50% acceptance in mixed auth mode is explained by endpoint behavior, not random failures:
- `vault_access` is being throttled (429-heavy)
- `files_list` remains serviceable (200-heavy)

So when traffic is mixed evenly between both endpoints, overall success naturally trends toward ~50%.
