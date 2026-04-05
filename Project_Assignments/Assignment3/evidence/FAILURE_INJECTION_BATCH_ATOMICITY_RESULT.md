# Failure Injection Test: Batch Atomicity

## Test Objective
Validate that a failing batch download request does not partially consume valid files.

## Configuration
- base URL: http://localhost:4000
- outer_token (generated test vault): 9J0fQwh
- request status: 404
- injected invalid file id: non-existent-file-id

## Result
- pass: True
- preserved_after_failure: True
- before_file_ids: ["4e6d01e7-524c-4d92-bb49-bc4d87678123","9658f209-3a93-4cbb-b139-c4d185b3ee67"]
- after_file_ids: ["4e6d01e7-524c-4d92-bb49-bc4d87678123","9658f209-3a93-4cbb-b139-c4d185b3ee67"]

## Interpretation
- The mixed valid/invalid batch request failed as expected.
- Files available before the request remained available after the failure.
- This demonstrates atomic failure behavior for the tested batch path (no partial deletion/consumption).

