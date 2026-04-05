"""Module B durability check across backend restart.

Phase 1:
  - create vault with one file
  - download file once (consumes it)
  - persist context JSON

Phase 2 (run after backend restart):
  - reuse outer/file ids from context
  - verify file remains unavailable (410/404)

Usage:
  python durability_restart_check.py --phase phase1 --base-url http://localhost:4000 --inner-token DurabTok01
  # restart backend
  python durability_restart_check.py --phase phase2 --base-url http://localhost:4000 --inner-token DurabTok01
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import requests


ASSIGNMENT3_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTEXT = ASSIGNMENT3_ROOT / "evidence" / "module_b_durability_context.json"
DEFAULT_RESULT = ASSIGNMENT3_ROOT / "evidence" / "module_b_durability_restart_result.json"


def create_single_file_vault(base_url: str, inner_token: str):
    files = [("files", ("durability.txt", io.BytesIO(b"durability-check"), "text/plain"))]
    data = {"innerToken": inner_token, "expiryDays": "1"}
    r = requests.post(f"{base_url}/api/files/new-vault-upload", data=data, files=files, timeout=30)
    r.raise_for_status()
    payload = r.json()
    return payload["outerToken"]


def access_files(base_url: str, outer_token: str, inner_token: str):
    r = requests.post(
        f"{base_url}/api/vaults/{outer_token}/access",
        json={"innerToken": inner_token},
        timeout=20,
    )
    r.raise_for_status()
    return (r.json().get("files") or [])


def download_once(base_url: str, outer_token: str, inner_token: str, file_id: str):
    r = requests.post(
        f"{base_url}/api/files/{file_id}/download",
        json={"outerToken": outer_token, "innerToken": inner_token},
        timeout=30,
    )
    return r


def resolve_context_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    cwd_resolved = candidate.resolve()
    if cwd_resolved.exists():
        return cwd_resolved

    # Backward-compatibility fallback from old script runs.
    legacy = ASSIGNMENT3_ROOT.parent.parent / "evidence" / candidate.name
    if legacy.exists():
        return legacy

    return (ASSIGNMENT3_ROOT / candidate).resolve()


def resolve_output_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (ASSIGNMENT3_ROOT / candidate).resolve()


def run_phase1(base_url: str, inner_token: str, context_path: Path):
    outer = create_single_file_vault(base_url, inner_token)
    files = access_files(base_url, outer, inner_token)
    if not files:
        raise RuntimeError("No file found in created vault.")

    file_id = files[0]["file_id"]
    first = download_once(base_url, outer, inner_token, file_id)

    ctx = {
        "base_url": base_url,
        "outer_token": outer,
        "inner_token": inner_token,
        "file_id": file_id,
        "first_download_status": first.status_code,
        "phase": "phase1_complete"
    }
    context_path.parent.mkdir(parents=True, exist_ok=True)
    context_path.write_text(json.dumps(ctx, indent=2), encoding="utf-8")
    print(json.dumps(ctx, indent=2))


def run_phase2(base_url: str, context_path: Path, result_path: Path):
    if not context_path.exists():
        raise RuntimeError(f"Context file not found: {context_path}")

    ctx = json.loads(context_path.read_text(encoding="utf-8"))
    outer = ctx["outer_token"]
    inner = ctx["inner_token"]
    file_id = ctx["file_id"]

    second = download_once(base_url, outer, inner, file_id)
    passed = ctx.get("first_download_status") == 200 and second.status_code in (404, 410)

    result = {
        "test": "module_b_durability_restart",
        "base_url": base_url,
        "outer_token": outer,
        "file_id": file_id,
        "first_download_status": ctx.get("first_download_status"),
        "after_restart_download_status": second.status_code,
        "passed": passed,
        "interpretation": "State remained durable across restart if second status is 404/410.",
        "response_preview": second.text[:240],
    }

    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Module B durability across restart check")
    parser.add_argument("--phase", choices=["phase1", "phase2"], required=True)
    parser.add_argument("--base-url", default="http://localhost:4000")
    parser.add_argument("--inner-token", default="DurabTok01")
    parser.add_argument("--context", default=str(DEFAULT_CONTEXT))
    parser.add_argument("--out", default=str(DEFAULT_RESULT))
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    context_path = resolve_context_path(args.context)
    result_path = resolve_output_path(args.out)

    if args.phase == "phase1":
        run_phase1(base, args.inner_token, context_path)
    else:
        run_phase2(base, context_path, result_path)


if __name__ == "__main__":
    main()
