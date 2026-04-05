"""Race-condition test for one-time download semantics.

This script creates an isolated test vault with one file, then launches
concurrent download attempts for the same file_id.

Expected behavior (pass):
- Exactly one HTTP 200 response
- Remaining responses are non-success (typically 404/410)
- No HTTP 500
"""

from __future__ import annotations

import argparse
import io
import json
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

import requests


@dataclass
class DownloadAttempt:
    index: int
    status: int
    latency_ms: float
    ok: bool
    error: str = ""


def create_test_vault(base_url: str, inner_token: str, expiry_days: int = 1):
    files = {
        "files": ("race_test.txt", io.BytesIO(b"assignment3-race-condition-test"), "text/plain"),
    }
    data = {
        "innerToken": inner_token,
        "expiryDays": str(expiry_days),
    }
    r = requests.post(f"{base_url}/api/files/new-vault-upload", data=data, files=files, timeout=30)
    r.raise_for_status()
    return r.json()


def access_vault(base_url: str, outer_token: str, inner_token: str):
    r = requests.post(
        f"{base_url}/api/vaults/{outer_token}/access",
        json={"innerToken": inner_token},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def attempt_download(base_url: str, file_id: str, outer_token: str, inner_token: str, idx: int, out: List[DownloadAttempt], lock: threading.Lock):
    start = time.perf_counter()
    try:
        r = requests.post(
            f"{base_url}/api/files/{file_id}/download",
            json={"outerToken": outer_token, "innerToken": inner_token},
            timeout=30,
        )
        latency = (time.perf_counter() - start) * 1000
        ok = r.status_code == 200
        err = ""
        if not ok:
            try:
                err = json.dumps(r.json())[:240]
            except Exception:
                err = r.text[:240]
        item = DownloadAttempt(index=idx, status=r.status_code, latency_ms=latency, ok=ok, error=err)
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        item = DownloadAttempt(index=idx, status=0, latency_ms=latency, ok=False, error=str(e)[:240])

    with lock:
        out.append(item)


def run_test(base_url: str, inner_token: str, concurrency: int):
    created = create_test_vault(base_url, inner_token)
    outer_token = created.get("outerToken")
    if not outer_token:
        raise RuntimeError("Failed to create test vault: missing outerToken")

    access = access_vault(base_url, outer_token, inner_token)
    files = access.get("files") or []
    if not files:
        raise RuntimeError("No files returned after access; cannot run race test")
    file_id = files[0]["file_id"]

    attempts: List[DownloadAttempt] = []
    lock = threading.Lock()
    threads = [
        threading.Thread(
            target=attempt_download,
            args=(base_url, file_id, outer_token, inner_token, i + 1, attempts, lock),
            daemon=True,
        )
        for i in range(concurrency)
    ]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    attempts.sort(key=lambda a: a.index)
    status_counts = Counter(a.status for a in attempts)
    success_count = sum(1 for a in attempts if a.ok)
    has_server_error = any(a.status >= 500 for a in attempts)

    passed = success_count == 1 and not has_server_error

    return {
        "test": "one_file_concurrent_download",
        "base_url": base_url,
        "outer_token": outer_token,
        "file_id": file_id,
        "concurrency": concurrency,
        "success_count": success_count,
        "status_counts": dict(status_counts),
        "passed": passed,
        "attempts": [a.__dict__ for a in attempts],
        "pass_criteria": {
            "exactly_one_http_200": True,
            "no_http_500": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Race-condition test for one-time download")
    parser.add_argument("--base-url", default="http://localhost:4000")
    parser.add_argument("--inner-token", default="RaceTokn11")
    parser.add_argument("--concurrency", type=int, default=15)
    parser.add_argument("--out", default="../evidence/race_condition_download_result.json")
    args = parser.parse_args()

    result = run_test(args.base_url.rstrip("/"), args.inner_token, args.concurrency)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(json.dumps({
        "passed": result["passed"],
        "success_count": result["success_count"],
        "status_counts": result["status_counts"],
        "out": str(out_path.resolve()),
    }, indent=2))


if __name__ == "__main__":
    main()
