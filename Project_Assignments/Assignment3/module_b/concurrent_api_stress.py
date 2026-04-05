"""Concurrent API load script for Assignment 3 Module B.

Examples:
python concurrent_api_stress.py --mode public --base-url http://localhost:4000 --users 20 --requests-per-user 25
python concurrent_api_stress.py --mode auth --base-url http://localhost:4000 --outer-token OUTER123 --inner-token MainInner123 --users 20 --requests-per-user 25
python concurrent_api_stress.py --mode auth --auth-pattern access --base-url http://localhost:4000 --outer-token OUTER123 --inner-token MainInner123 --users 20 --requests-per-user 25
python concurrent_api_stress.py --mode auth --auth-pattern mixed --delay-ms 150 --base-url http://localhost:4000 --outer-token OUTER123 --inner-token MainInner123 --users 20 --requests-per-user 25
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass
class CallResult:
    ok: bool
    status: int
    latency_ms: float
    op: str
    error: str = ""


def http_json(method: str, url: str, payload: Dict | None = None, headers: Dict | None = None, timeout: int = 20):
    data = None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = Request(url=url, data=data, headers=hdrs, method=method)
    start = time.perf_counter()
    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            latency = (time.perf_counter() - start) * 1000
            return True, resp.status, latency, body
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        latency = (time.perf_counter() - start) * 1000
        return False, int(e.code), latency, body
    except URLError as e:
        latency = (time.perf_counter() - start) * 1000
        return False, 0, latency, str(e)
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return False, 0, latency, str(e)


def access_vault(base_url: str, outer_token: str, inner_token: str) -> CallResult:
    ok, status, latency, body = http_json(
        "POST",
        f"{base_url}/api/vaults/{outer_token}/access",
        payload={"innerToken": inner_token},
    )
    return CallResult(ok=ok, status=status, latency_ms=latency, op="vault_access", error="" if ok else body[:240])


def list_files(base_url: str, outer_token: str, inner_token: str) -> CallResult:
    url = f"{base_url}/api/files/{outer_token}/list->innerToken={inner_token}"
    ok, status, latency, body = http_json("GET", url)
    return CallResult(ok=ok, status=status, latency_ms=latency, op="files_list", error="" if ok else body[:240])


def check_health(base_url: str) -> CallResult:
    ok, status, latency, body = http_json("GET", f"{base_url}/api/health")
    return CallResult(ok=ok, status=status, latency_ms=latency, op="health", error="" if ok else body[:240])


def get_captcha(base_url: str) -> CallResult:
    ok, status, latency, body = http_json("GET", f"{base_url}/api/security/captcha")
    return CallResult(ok=ok, status=status, latency_ms=latency, op="captcha_get", error="" if ok else body[:240])


def maybe_sleep(delay_ms: int) -> None:
    if delay_ms > 0:
        time.sleep(delay_ms / 1000.0)


def worker_public(base_url: str, loops: int, out: List[CallResult], lock: threading.Lock, delay_ms: int):
    local: List[CallResult] = []
    for i in range(loops):
        if i % 2 == 0:
            local.append(check_health(base_url))
        else:
            local.append(get_captcha(base_url))
        maybe_sleep(delay_ms)
    with lock:
        out.extend(local)


def worker_auth(
    base_url: str,
    outer_token: str,
    inner_token: str,
    loops: int,
    auth_pattern: str,
    out: List[CallResult],
    lock: threading.Lock,
    delay_ms: int,
):
    local: List[CallResult] = []
    for i in range(loops):
        if auth_pattern == "access":
            local.append(access_vault(base_url, outer_token, inner_token))
        elif auth_pattern == "list":
            local.append(list_files(base_url, outer_token, inner_token))
        else:
            if i % 2 == 0:
                local.append(access_vault(base_url, outer_token, inner_token))
            else:
                local.append(list_files(base_url, outer_token, inner_token))
        maybe_sleep(delay_ms)
    with lock:
        out.extend(local)


def summarize(results: List[CallResult]) -> Dict:
    if not results:
        return {"total": 0}

    total = len(results)
    success = sum(1 for r in results if r.ok)
    failed = total - success
    latencies = [r.latency_ms for r in results]
    by_status: Dict[int, int] = {}
    by_op: Dict[str, int] = {}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_op[r.op] = by_op.get(r.op, 0) + 1

    latencies_sorted = sorted(latencies)

    def percentile(p: float) -> float:
        idx = min(len(latencies_sorted) - 1, int(round(p * (len(latencies_sorted) - 1))))
        return latencies_sorted[idx]

    return {
        "total": total,
        "success": success,
        "failed": failed,
        "success_rate": round((success / total) * 100, 2),
        "latency_ms": {
            "mean": round(mean(latencies), 2),
            "p50": round(percentile(0.50), 2),
            "p95": round(percentile(0.95), 2),
            "max": round(max(latencies), 2),
        },
        "by_status": by_status,
        "by_operation": by_op,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Concurrent API load runner for Assignment 3 Module B")
    parser.add_argument("--mode", choices=["public", "auth"], default="public")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--outer-token")
    parser.add_argument("--inner-token")
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--requests-per-user", type=int, default=20)
    parser.add_argument("--auth-pattern", choices=["mixed", "access", "list"], default="mixed")
    parser.add_argument("--delay-ms", type=int, default=0)
    parser.add_argument("--out", default="../evidence/load_run_summary.json")
    args = parser.parse_args()

    if args.mode == "auth" and (not args.outer_token or not args.inner_token):
        raise SystemExit("--outer-token and --inner-token are required for --mode auth")

    start = time.perf_counter()
    all_results: List[CallResult] = []
    lock = threading.Lock()
    threads = []
    for _ in range(args.users):
        if args.mode == "public":
            t = threading.Thread(
                target=worker_public,
                args=(args.base_url.rstrip("/"), args.requests_per_user, all_results, lock, args.delay_ms),
                daemon=True,
            )
        else:
            t = threading.Thread(
                target=worker_auth,
                args=(
                    args.base_url.rstrip("/"),
                    args.outer_token,
                    args.inner_token,
                    args.requests_per_user,
                    args.auth_pattern,
                    all_results,
                    lock,
                    args.delay_ms,
                ),
                daemon=True,
            )
        threads.append(t)

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    summary = summarize(all_results)
    summary["duration_sec"] = round(time.perf_counter() - start, 3)
    summary["mode"] = args.mode
    summary["users"] = args.users
    summary["requests_per_user"] = args.requests_per_user
    summary["delay_ms"] = args.delay_ms
    if args.mode == "auth":
        summary["auth_pattern"] = args.auth_pattern

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("[OK] Load run finished")
    print(json.dumps(summary, indent=2))
    print(f"[OK] Summary written to {out_path.resolve()}")


if __name__ == "__main__":
    main()
