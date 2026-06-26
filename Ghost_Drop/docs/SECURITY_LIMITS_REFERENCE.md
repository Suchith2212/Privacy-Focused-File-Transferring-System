# GhostDrop — Security Architecture Reference

> Rate limiting, IP risk control, adaptive blocking, and CAPTCHA system.  
> For the encryption design see [`ENCRYPTION_REFERENCE.md`](ENCRYPTION_REFERENCE.md). For the full architecture see [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Table of Contents

- [Security Layers Overview](#security-layers-overview)
- [Security Gate Pipeline](#security-gate-pipeline)
- [IP-Based Rate Limiting](#ip-based-rate-limiting)
- [Principal-Based Rate Limiting](#principal-based-rate-limiting)
- [Per-Route Rate Limiting](#per-route-rate-limiting)
- [Failure Tracking and Weighted Scoring](#failure-tracking-and-weighted-scoring)
- [CAPTCHA System](#captcha-system)
- [Adaptive Temporary Blocking](#adaptive-temporary-blocking)
- [IP Risk Scoring](#ip-risk-scoring)
- [Security Store (Memory vs Redis)](#security-store-memory-vs-redis)
- [Configuration Reference](#configuration-reference)
- [Error Response Codes](#error-response-codes)

---

## Security Layers Overview

The system applies **seven independent security layers** before any route handler executes.

```
Layer 1 → Temporary IP block check
Layer 2 → IP risk evaluation (TOR / VPN / bad-IP scoring)
Layer 3 → CAPTCHA gate (triggered by failure accumulation or high risk)
Layer 4 → Global IP rate limiting (per-minute + per-day sliding windows)
Layer 5 → Per-route rate limiting (separate counters per endpoint)
Layer 6 → Adaptive block escalation (strike-based, capped at 24 h)
Layer 7 → Principal rate limiting (per authenticated vault:token pair)
```

Layers 1–6 are enforced by `middleware/securityGate.js` on every public request.  
Layer 7 is enforced separately in `routes/portfolio.js` for authenticated API calls.

---

## Security Gate Pipeline

```
Request
│
▼ ① Temporary block check
   isBlocked(ip)?
   └─ yes → 429 { code: "TEMP_BLOCK", blockedSeconds, Retry-After header }

▼ ② IP risk evaluation
   evaluateIpRisk(routeKey, ip, captchaSolved)
   ├─ score threshold exceeded → 403 { code: "RISK_BLOCK" }
   └─ moderate risk → captcha required flag set

▼ ③ CAPTCHA gate (if required and not already solved)
   ├─ no challenge in request → 403 { code: "CAPTCHA_REQUIRED" }
   └─ challenge present → verifyCaptcha(...)
        ├─ fail → 403 { code: "CAPTCHA_INVALID" }
        └─ pass → captchaSolved = true

▼ ④ Record attempt counters
   recordAttempt(ip)
   recordRouteAttempt(routeKey, ip)

▼ ⑤ Global IP rate limit check
   checkRateLimit(ip)
   └─ over limit AND not captchaSolved → 429 { code: "RATE_LIMIT", Retry-After }

▼ ⑥ Per-route rate limit check
   checkRouteRateLimit(routeKey, ip)
   └─ over limit AND not captchaSolved → 429 { code: "ROUTE_RATE_LIMIT", Retry-After }

▼ Attach req.securityContext = { ok: true, ip, risk, captchaSolved }
   call next()
```

A solved CAPTCHA exempts the request from rate limit enforcement for the current action, but does **not** reset failure counters or remove blocks.

---

## IP-Based Rate Limiting

Sliding window counters per IP address:

| Window | Default Limit | Env Variable |
|---|---|---|
| Per minute | 10 requests | `ROUTE_RATE_LIMITS_JSON` |
| Per day | 100 requests | `ROUTE_RATE_LIMITS_JSON` |

Counters are stored in the security store (in-memory Map in dev; Redis in production).

When either limit is exceeded without a solved CAPTCHA, the response is:

```json
{
  "error": "Rate limit exceeded.",
  "code": "RATE_LIMIT",
  "minuteCount": 11,
  "minuteLimit": 10,
  "dayCount": 45,
  "dayLimit": 100,
  "retryAfterSeconds": 42,
  "captchaRequired": true
}
```

The `Retry-After` header is also set.

---

## Principal-Based Rate Limiting

Applied after authentication for portfolio API calls, keyed on `portfolio:{vaultId}:{innerTokenId}`:

| Window | Default Limit |
|---|---|
| Per minute | 60 requests |
| Per day | 600 requests |

When exceeded:

```json
{
  "error": "Portfolio rate limit exceeded for this authenticated token.",
  "code": "PORTFOLIO_TOKEN_RATE_LIMIT",
  "retryAfterSeconds": 38,
  "securityAlert": true
}
```

---

## Per-Route Rate Limiting

Each endpoint group has its own counters, configured via `config/securityPolicies.js` and overridable via `ROUTE_RATE_LIMITS_JSON`.

Route keys used internally:

| Route Key | Endpoint |
|---|---|
| `vault.access` | `POST /api/vaults/:outerToken/access` |
| `vault.public-info` | `GET /api/vaults/:outerToken/public-info` |
| `vault.subtoken-create` | `POST /api/vaults/:outerToken/sub-tokens` |
| `files.new-vault-upload` | `POST /api/files/new-vault-upload` |
| `files.upload` | `POST /api/files/:outerToken/upload` |
| `files.download` | `GET /api/files/:outerToken/download/:fileId` |
| `files.download-batch` | `POST /api/files/:outerToken/download-batch` |
| `default` | All other routes |

Override example (in `.env`):

```env
ROUTE_RATE_LIMITS_JSON={"files.download":{"minute":15,"day":200},"default":{"minute":20,"day":300}}
```

---

## Failure Tracking and Weighted Scoring

Not all failures are equal. Each failure type contributes a **weight** to a sliding-window score:

| Failure Reason | Weight | Examples |
|---|---|---|
| Default | 1 | General auth failure |
| `VAULT_NOT_FOUND` | 2 | Token enumeration attempt |
| `INVALID_INNER_TOKEN` | 2 | Brute-force attempt |
| `INVALID_MAIN_TOKEN` | 2 | Privilege escalation attempt |
| `VAULT_EXPIRED` | 1 | Minor — accessing expired vault |

The system maintains two windows:
- **1-minute window**: raw failure count
- **10-minute window**: weighted score sum

Thresholds (all configurable via `ROUTE_RISK_POLICY_JSON`):

| Threshold | Default | Effect |
|---|---|---|
| Failures/min before CAPTCHA | 8 | CAPTCHA gate triggers |
| Weighted score/10 min before CAPTCHA | 10 | CAPTCHA gate triggers |
| Failures/min before temp block | 20 | IP temporarily blocked |
| Weighted score/10 min before block | 22 | IP temporarily blocked |

---

## CAPTCHA System

### Providers

| Provider | Value | Notes |
|---|---|---|
| Built-in math | `math` | Default; suitable for development only |
| hCaptcha | `hcaptcha` | Requires `HCAPTCHA_SITE_KEY` + `HCAPTCHA_SECRET_KEY` |
| reCAPTCHA | `recaptcha` | Requires `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` |

Set via `CAPTCHA_PROVIDER`. `CAPTCHA_ALLOW_MATH_FALLBACK=true` allows fallback to math if a third-party provider is misconfigured.

### Challenge Lifecycle

```
1. Client calls GET /api/security/captcha
   → { captchaRequired, challengeId, question }  (math provider)
   → { captchaRequired, siteKey }                (hCaptcha / reCAPTCHA)

2. Client presents CAPTCHA to user; user solves it

3. Client includes in next request body:
   Math:      { captchaChallengeId, captchaAnswer }
   Provider:  { providerToken }   (hCaptcha h-captcha-response / reCAPTCHA token)

4. securityGate calls verifyCaptcha(...)
   → marks IP as solved for CAPTCHA_SOLVE_TTL_MS (default: 10 minutes)
   → pending action proceeds without re-prompting
```

### Timing Parameters

| Parameter | Default | Description |
|---|---|---|
| `CAPTCHA_SOLVE_TTL_MS` | 600 000 (10 min) | How long a solved CAPTCHA exempts the IP |
| `CAPTCHA_CHALLENGE_TTL_MS` | 300 000 (5 min) | Math challenge expiry |
| `CAPTCHA_MAX_ATTEMPTS` | 5 | Max wrong attempts before challenge is invalidated |

### CAPTCHA API Endpoints

```http
GET  /api/security/captcha              Generate a new challenge
POST /api/security/captcha/verify       Verify a challenge/answer pair
GET  /api/security/captcha/required     Check whether CAPTCHA is currently required for this IP
GET  /api/security/status               Current rate-limit and block state for this IP
```

---

## Adaptive Temporary Blocking

When failure thresholds are exceeded, the IP is blocked for an escalating duration:

```
Strike 1: 15 minutes
Strike 2: 30 minutes
Strike 3: 60 minutes
...
Cap:      24 hours
```

Block duration = `min(TEMP_BLOCK_BASE_MS × 2^(strikes - 1), TEMP_BLOCK_MAX_MS)`

Strike history is tracked within a 24-hour window (`BLOCK_STRIKE_WINDOW_MS`). Strikes outside this window are not counted.

While blocked, requests receive:

```json
{
  "error": "Temporarily blocked due to repeated failures.",
  "code": "TEMP_BLOCK",
  "blockedSeconds": 900,
  "captchaRequired": true
}
```

`Retry-After` is set to `blockedSeconds`.

---

## IP Risk Scoring

Each request is scored based on IP intelligence signals. The score and resulting action depend on the route's risk policy.

### Signal Weights

| Signal | Score Added | Source |
|---|---|---|
| IP on `RISK_BAD_IPS` list | 80 | `RISK_BAD_IPS` env var (comma-separated) |
| IP on `RISK_TOR_IPS` list | 60 | `RISK_TOR_IPS` env var |
| IP on `RISK_VPN_IPS` list | 40 | `RISK_VPN_IPS` env var |
| Accumulated failures in window | variable | From failure tracker |

### Risk Policy Actions (by score)

| Score Range | Action |
|---|---|
| 0–44 | Allow |
| 45–89 | Require CAPTCHA |
| 90+ | Block (403 RISK_BLOCK) |

Override thresholds per route via `ROUTE_RISK_POLICY_JSON`:

```env
ROUTE_RISK_POLICY_JSON={"vault.access":{"captchaThreshold":30,"blockThreshold":85},"default":{"captchaThreshold":45,"blockThreshold":90}}
```

### Populating IP Lists

Set comma-separated IP addresses in `.env`:

```env
RISK_BAD_IPS=1.2.3.4,5.6.7.8
RISK_TOR_IPS=9.10.11.12
RISK_VPN_IPS=13.14.15.16
```

---

## Security Store (Memory vs Redis)

| Mode | When Used | Characteristics |
|---|---|---|
| `memory` | Development (`NODE_ENV != production`) | In-process Map; resets on restart; not shared across instances |
| `redis` | Production (enforced) | Persistent across restarts; shared across scaled instances; requires `REDIS_URL` |

The server **refuses to start** in production with `SECURITY_STORE=memory`:

```
Error: SECURITY_STORE=redis is required in production.
```

Configure Redis connection:

```env
SECURITY_STORE=redis
REDIS_URL=redis://:your_redis_password@127.0.0.1:6379
```

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SECURITY_STORE` | `memory` | `memory` or `redis` |
| `REDIS_URL` | — | Redis connection URL (required in prod) |
| `CAPTCHA_PROVIDER` | `math` | `math`, `hcaptcha`, `recaptcha` |
| `CAPTCHA_ALLOW_MATH_FALLBACK` | `true` | Fall back to math if provider is unavailable |
| `HCAPTCHA_SITE_KEY` | — | Required when `CAPTCHA_PROVIDER=hcaptcha` |
| `HCAPTCHA_SECRET_KEY` | — | Required when `CAPTCHA_PROVIDER=hcaptcha` |
| `RECAPTCHA_SITE_KEY` | — | Required when `CAPTCHA_PROVIDER=recaptcha` |
| `RECAPTCHA_SECRET_KEY` | — | Required when `CAPTCHA_PROVIDER=recaptcha` |
| `RISK_BAD_IPS` | — | Comma-separated IP list; score += 80 |
| `RISK_TOR_IPS` | — | Comma-separated IP list; score += 60 |
| `RISK_VPN_IPS` | — | Comma-separated IP list; score += 40 |
| `ROUTE_RATE_LIMITS_JSON` | — | Per-route rate limit overrides (JSON) |
| `ROUTE_RISK_POLICY_JSON` | — | Per-route risk policy overrides (JSON) |
| `TRUST_PROXY` | `false` | Set `true` to trust `x-forwarded-for` |

---

## Error Response Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `TEMP_BLOCK` | 429 | IP is in a temporary block period |
| `RISK_BLOCK` | 403 | IP risk score exceeded block threshold |
| `CAPTCHA_REQUIRED` | 403 | CAPTCHA challenge must be solved before proceeding |
| `CAPTCHA_INVALID` | 403 | CAPTCHA answer or token was rejected |
| `RATE_LIMIT` | 429 | Global IP rate limit exceeded |
| `ROUTE_RATE_LIMIT` | 429 | Per-route rate limit exceeded |
| `PORTFOLIO_TOKEN_RATE_LIMIT` | 429 | Principal (authenticated token) rate limit exceeded |
