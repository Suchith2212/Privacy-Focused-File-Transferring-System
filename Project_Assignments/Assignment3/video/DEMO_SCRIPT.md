# Assignment 3 Final Demo Script (Video Ready)

## Target Duration
8 to 10 minutes

## Goal of Demo
Show that Assignment 3 is complete end-to-end:
- Module A transaction engine (BEGIN/COMMIT/ROLLBACK)
- WAL-based crash recovery (commit replay, incomplete discard)
- ACID validation across 7 project-domain tables
- Module B concurrency, race-condition safety, failure injection, and 1000-op stress

---

## Pre-Demo Setup (Do This Before Recording)
1. Open terminal in:
```powershell
cd "F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment3"
```
2. Ensure Python is available:
```powershell
python --version
```
3. Optional (graphs):
```powershell
pip install matplotlib
```

---

## Segment 1: Introduction (00:00 - 00:45)
Say:
- Team name: Dragons
- Course: CS432 Database Systems
- Assignment: Track 1, Assignment 3
- Submission scope: Module A + Module B with ACID, recovery, concurrency, stress tests

Show files quickly:
```powershell
Get-ChildItem -Name
```
Mention key folders:
- `module_a/`
- `module_b_stress_testing/`
- `experiments/`
- `integration/`
- `results/`
- `logs/`
- `report/`

---

## Segment 2: Module A Architecture (00:45 - 02:15)
Open and explain:
- `module_a/engine/transactional_db.py`
- `module_a/engine/wal.py`

Talking points:
- `begin()` acquires lock and logs `BEGIN`
- operations log `OP`
- `commit()` validates, logs `PREPARE`, applies atomically, logs `COMMIT`
- failure path logs `ROLLBACK`
- `_recover_from_wal()` replays committed tx, ignores incomplete tx

Also mention 7 domain tables:
- `vaults`, `inner_tokens`, `files`, `sessions`, `download_logs`, `expiry_jobs`, `portfolio_entries`

---

## Segment 3: Module A Proof via Tests (02:15 - 04:15)
Run:
```powershell
python module_a\tests\test_acid.py
```
What to say while output appears:
- 16 checks now included
- covers atomicity, consistency, isolation, durability, recovery, and negative bypass path

Then show detailed saved results:
```powershell
Get-Content results\acid_test_results_detailed.json -TotalCount 60
```

Run additional smoke checks:
```powershell
python module_a\transaction_smoke_test.py
python module_a\smoke_test.py
```

---

## Segment 4: ACID Experiments (04:15 - 05:15)
Run all experiments:
```powershell
python experiments\run_all_experiments.py
```
Then show summary JSON:
```powershell
Get-Content results\all_experiments_summary.json -TotalCount 80
```

Say:
- Experiment 1: Atomicity
- Experiment 2: Consistency
- Experiment 3: Isolation
- Experiment 4: Durability

---

## Segment 5: Module B Concurrency + Race + Failure (05:15 - 07:15)
Run concurrent vault test:
```powershell
python module_b_stress_testing\concurrent_vault_test.py --users 20
```

Run one-time download race test:
```powershell
python module_b_stress_testing\race_condition_download_test.py --concurrency 50
```
Expected explanation:
- one success, remaining rejected
- demonstrates race safety for one-time download rule

Run failure injection test:
```powershell
python module_b_stress_testing\failure_injection_test.py
```
Expected explanation:
- failed transactions do not leave partial state

---

## Segment 6: Stress + ACID Verification Suite (07:15 - 08:45)
Run 1000-op stress:
```powershell
python module_b_stress_testing\stress_test_runner.py --ops 1000 --threads 1
```
Show metrics:
```powershell
Get-Content results\stress_test_metrics.json -TotalCount 120
```
Mention:
- workload model: `multi_relation_transaction_mix`
- op distribution (attempted/success/failed)
- throughput + latency metrics

Run ACID verification suite:
```powershell
python module_b_stress_testing\acid_verification_suite.py
```

---

## Segment 7: Final End-to-End Demo Runner (Optional but Strong) (08:45 - 09:30)
Run:
```powershell
python run_demo.py --quick
```
Say:
- This executes the integrated grading flow and writes `results/demo_summary.json`

---

## Segment 8: Close (09:30 - 10:00)
Show report files:
- `report/Dragons_Assignment3_Report.md`
- `report/Dragons_Assignment3_Report.pdf`

Say final summary:
- Module A ACID + recovery validated
- Module B concurrency/race/failure/stress validated
- Results and logs are reproducible and stored in `results/` and `logs/`

---

## Recording Quality Checklist
- Keep terminal font readable (zoom in if needed)
- Narrate every command briefly before running it
- Wait for command completion and highlight key output lines
- Avoid long silence between segments
- Keep total video under 10 minutes if possible

---

## Quick Backup Plan (If Time Is Short)
Run only:
```powershell
python module_a\tests\test_acid.py
python module_b_stress_testing\race_condition_download_test.py --concurrency 50
python module_b_stress_testing\stress_test_runner.py --ops 1000 --threads 1
python run_demo.py --quick
```
This still shows core grading evidence.
