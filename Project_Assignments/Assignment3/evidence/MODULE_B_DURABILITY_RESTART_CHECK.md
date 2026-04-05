# Module B Durability Restart Check

## Script
- `module_b/durability_restart_check.py`

## Phase 1
Command:
```powershell
python module_b/durability_restart_check.py --phase phase1 --base-url http://localhost:4000 --inner-token DurabTok01
```
Output:
- outer_token: `Jt57HKW`
- file_id: `062d63d6-35d0-49f0-8d14-b8d30aee9ecb`
- first_download_status: `200`

## Phase 2 (after backend restart)
Command:
```powershell
python module_b/durability_restart_check.py --phase phase2 --base-url http://localhost:4000 --inner-token DurabTok01 --context "F:\SEM IV\lessons\DB\Project\evidence\module_b_durability_context.json"
```
Output:
- after_restart_download_status: `404`
- passed: `true`

## Conclusion
Durability across restart is validated for the one-time download behavior: once consumed, the same file remains unavailable after restart.

Artifacts:
- `evidence/module_b_durability_context.json`
- `evidence/module_b_durability_restart_result.json`
