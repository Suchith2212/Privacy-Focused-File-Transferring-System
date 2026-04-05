"""Failure-injection test: batch download with mixed valid/invalid IDs.

Goal: verify no partial deletion/update occurs when batch request fails.
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import requests


def create_vault_with_two_files(base_url: str, inner_token: str):
    files = [
        ("files", ("fi_test_a.txt", io.BytesIO(b"file-a"), "text/plain")),
        ("files", ("fi_test_b.txt", io.BytesIO(b"file-b"), "text/plain")),
    ]
    data = {"innerToken": inner_token, "expiryDays": "1"}
    r = requests.post(f"{base_url}/api/files/new-vault-upload", data=data, files=files, timeout=30)
    r.raise_for_status()
    return r.json()["outerToken"]


def access_files(base_url: str, outer_token: str, inner_token: str):
    r = requests.post(
        f"{base_url}/api/vaults/{outer_token}/access",
        json={"innerToken": inner_token},
        timeout=20,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("files") or []


def main():
    parser = argparse.ArgumentParser(description="Failure-injection batch atomicity test")
    parser.add_argument("--base-url", default="http://localhost:4000")
    parser.add_argument("--inner-token", default="FailInj11")
    parser.add_argument("--out", default="../evidence/failure_injection_batch_atomicity_result.json")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    outer = create_vault_with_two_files(base, args.inner_token)

    before = access_files(base, outer, args.inner_token)
    before_ids = [f["file_id"] for f in before]

    bad_batch = {
        "outerToken": outer,
        "innerToken": args.inner_token,
        "fileIds": [before_ids[0], "non-existent-file-id"],
    }
    resp = requests.post(f"{base}/api/files/download-batch", json=bad_batch, timeout=30)

    after = access_files(base, outer, args.inner_token)
    after_ids = [f["file_id"] for f in after]

    # Atomicity expectation: failed batch must not partially consume valid file.
    preserved = set(before_ids).issubset(set(after_ids))
    passed = (resp.status_code in (400, 404, 410)) and preserved

    result = {
        "test": "failure_injection_batch_atomicity",
        "base_url": base,
        "outer_token": outer,
        "request_status": resp.status_code,
        "request_body": bad_batch,
        "before_file_ids": before_ids,
        "after_file_ids": after_ids,
        "preserved_after_failure": preserved,
        "passed": passed,
        "response_preview": resp.text[:240],
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(json.dumps({
        "passed": passed,
        "request_status": resp.status_code,
        "preserved_after_failure": preserved,
        "out": str(out.resolve()),
    }, indent=2))


if __name__ == "__main__":
    main()
