# Evidence Folder Guide

This document explains every file in `Assignment3/evidence/`.
Use it during grading or demo to quickly locate proof for each claim.

## Folder Purpose
The `evidence/` folder stores run outputs and human-readable summaries for Module A and Module B validations.

Primary goals:
- Show reproducible test outcomes.
- Preserve request/response summaries for API-based stress and race scenarios.
- Provide markdown explanations aligned to corresponding JSON artifacts.

---

## Recommended Primary Evidence (Use These First)

1. `MODULE_A_ACID_RESULTS.md`
- Human-readable summary of Module A ACID checks.
- Maps directly to Module A test output.

2. `module_b_public_load_summary.json`
- Public endpoint concurrent load summary.
- Includes success/failure counts, status distribution, latency stats.

3. `module_b_auth_mixed_paced_summary.json`
- Authenticated load profile with pacing.
- Better balanced profile than overly aggressive auth bursts.

4. `race_condition_download_result.json`
- One-time download race proof.
- Includes `success_count`, status distribution, and pass criteria.

5. `failure_injection_batch_atomicity_result.json`
- Batch atomicity failure-injection result.
- Confirms no partial state when request fails.

6. `module_b_durability_restart_result.json`
- Restart durability outcome for Module B API path.
- Compares status before and after restart.

---

## File-by-File Explanation

### A) Module A Evidence

#### `MODULE_A_ACID_RESULTS.md`
- Type: Markdown summary
- What it proves: Module A ACID/recovery test outcomes on 7 domain tables.
- Use when: Instructor asks for concise ACID evidence.

### B) Module B Public Load

#### `module_b_public_load_summary.json`
- Type: JSON metrics
- Key fields: `total`, `success`, `failed`, `success_rate`, `latency_ms`, `by_status`, `by_operation`, `duration_sec`, `mode`
- What it proves: Public API behavior under concurrent load.

#### `MODULE_B_PUBLIC_LOAD_RESULT.md`
- Type: Markdown summary
- What it proves: Human-readable interpretation of public load JSON.

### C) Module B Authenticated Load Profiles

#### `module_b_auth_load_summary.json`
- Baseline authenticated load profile.
- Often stricter/429-heavy depending on rate-limit policy.

#### `module_b_auth_load_summary_soft.json`
- Softer auth profile variant.

#### `module_b_auth_load_summary_ultra_soft.json`
- Ultra-soft auth profile variant.

#### `module_b_auth_load_summary_ultra_soft_after_cooldown.json`
- Ultra-soft run after cooldown window.

#### `module_b_auth_access_only_summary.json`
- Auth run focused on access endpoint profile.

#### `module_b_auth_list_only_summary.json`
- Auth run focused on list endpoint profile.

#### `module_b_auth_mixed_paced_summary.json`
- Mixed/paced auth run (recommended primary auth evidence).
- Includes users/request pacing fields.

#### `MODULE_B_AUTH_LOAD_RESULT.md`
- Markdown summary for auth load outcomes.

#### `MODULE_B_AUTH_PROFILE_COMPARISON.md`
- Comparison narrative across auth profiles.
- Use when explaining why some profiles hit 429 more often.

### D) Race Condition Evidence

#### `race_condition_download_result.json`
- Type: JSON metrics/details
- Key fields: `concurrency`, `success_count`, `status_counts`, `attempts`, `pass_criteria`, `passed`
- What it proves: One-time-download race behavior under concurrent attempts.

#### `RACE_CONDITION_DOWNLOAD_RESULT.md`
- Markdown explanation of race test outcome.

### E) Failure Injection Evidence

#### `failure_injection_batch_atomicity_result.json`
- Type: JSON test result
- Key fields: `before_file_ids`, `after_file_ids`, `preserved_after_failure`, `passed`
- What it proves: Failed batch request does not partially consume/modify state.

#### `FAILURE_INJECTION_BATCH_ATOMICITY_RESULT.md`
- Markdown explanation for the same failure-injection result.

### F) Durability Restart Evidence

#### `module_b_durability_restart_result.json`
- Type: JSON restart-check result
- Key fields: `first_download_status`, `after_restart_download_status`, `passed`, `interpretation`
- What it proves: Post-restart behavior matches durability expectation.

#### `MODULE_B_DURABILITY_RESTART_CHECK.md`
- Markdown explanation of restart durability check.

---

## How to Present Evidence in Viva/Demo

Use this order:
1. `MODULE_A_ACID_RESULTS.md`
2. `module_b_public_load_summary.json`
3. `module_b_auth_mixed_paced_summary.json`
4. `race_condition_download_result.json`
5. `failure_injection_batch_atomicity_result.json`
6. `module_b_durability_restart_result.json`

This gives a clean narrative: ACID core -> concurrent load -> race safety -> failure atomicity -> restart durability.

---

## Notes on Multiple Auth Files
There are multiple auth summary files because different throttle profiles were tested.
For final grading, prefer the mixed paced profile and mention that stricter profiles intentionally trigger throttling.

---

## Maintenance Rule
When rerunning tests, update both:
- JSON output file(s)
- corresponding markdown summary file(s)

Keep timestamps and parameter fields consistent so evidence is audit-friendly.
