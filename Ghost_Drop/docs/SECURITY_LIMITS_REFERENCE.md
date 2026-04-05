# 🛡 Ghost Drop Security Architecture

## Rate Limiting, Risk Control & Adaptive Abuse Prevention

---

# 1. 🧭 Overview

This document defines the **multi-layer security system** used to protect the backend from:

* Unauthorized access attempts
* Automated abuse (bots/scripts)
* Data scraping and bulk extraction
* Resource exhaustion attacks
* Token compromise impact

---

## 🔥 Core Security Philosophy

```text
Authentication verifies identity.
Security controls regulate behavior.
```

---

## 🧠 Design Principles

### 1. Defense in Depth

Multiple independent layers protect the system.

### 2. Separation of Concerns

* IP limits → infrastructure protection
* Principal limits → identity protection

### 3. Damage Containment

Even if a token is compromised, damage is limited.

---

# 2. 🧠 Security Layers (High-Level)

```text
Layer 1 → IP-based rate limiting
Layer 2 → Principal (innerToken) rate limiting
Layer 3 → Per-route rate limiting
Layer 4 → Failure tracking + weighted scoring
Layer 5 → CAPTCHA challenge system
Layer 6 → Adaptive temporary blocking
Layer 7 → Risk scoring (IP intelligence)
```

---

# 3. 🌐 IP-Based Rate Limiting

## Purpose

Protects system from **network-level abuse**.

---

## Limits

* 10 requests / minute
* 100 requests / day

---

## What it protects

* Bot traffic
* Burst traffic spikes
* Infrastructure overload

---

## Limitation

```text
IP addresses can be rotated (VPNs, botnets)
```

---

# 4. 👤 Principal (innerToken) Rate Limiting

## Definition

```text
Principal = authenticated identity (innerToken)
```

---

## Limits

* 60 requests / minute
* 600 requests / day

---

## Purpose

Controls **how a single identity behaves**, independent of IP.

---

## Why this is critical

### Without principal limits:

```text
Same token used across 100 IPs → bypass IP limits ❌
```

---

### With principal limits:

```text
Total usage per token is capped ✔
```

---

## 🔥 Key Insight

```text
IP = where request comes from  
Token = who is making the request  
```

---

# 5. 🔐 Post-Authentication Protection

Even after login, the system must protect:

---

## 5.1 Data Protection

```text
Prevent bulk file downloads (data scraping)
```

---

## 5.2 Infrastructure Protection

```text
Prevent a single user from exhausting resources
```

---

## 5.3 Damage Containment

```text
Limit impact if token is compromised
```

---

## 5.4 API Abuse Prevention

```text
Prevent excessive usage of sensitive endpoints
```

---

## 🎯 Core Insight

```text
Rate limiting after login = damage control
```

---

# 6. 📊 Per-Route Rate Limiting

Each route has tailored limits based on sensitivity.

---

## Examples

| Route             | Purpose         | Strictness  |
| ----------------- | --------------- | ----------- |
| `vault.access`    | authentication  | strict      |
| `files.upload`    | heavy operation | medium      |
| `files.download`  | frequent usage  | moderate    |
| `subtoken-create` | sensitive       | very strict |

---

## Why per-route?

Different endpoints have:

* different cost
* different risk
* different abuse patterns

---

# 7. ⚠️ Failure Tracking & Weighted Risk

## Purpose

Detect **malicious behavior patterns**

---

## Thresholds

* ≥ 20 failures/min → block
* ≥ 22 weighted score (10 min) → block

---

## Weighted Model

| Event           | Weight |
| --------------- | ------ |
| Normal failure  | 1      |
| CAPTCHA failure | 2      |
| Max attempts    | 4      |

---

## Why weighted?

```text
Not all failures are equal
```

Detects:

* brute force attacks
* intelligent slow attacks

---

# 8. 🤖 CAPTCHA System

## Trigger Conditions

* ≥ 8 failures/min
* OR weighted score ≥ 10

---

## Purpose

```text
Differentiate human users from automated systems
```

---

## Modes

* Math (fallback)
* hCaptcha
* reCAPTCHA

---

## Behavior

* Valid for 10 minutes after solving
* Max 5 attempts
* Failure increases risk score

---

# 9. 🚫 Adaptive Blocking

## Trigger

* excessive failures
* high weighted risk

---

## Block Duration

```text
Base: 15 minutes
Escalation: exponential per strike
Max: 24 hours
```

---

## Example

| Strike | Block Time |
| ------ | ---------- |
| 1      | 15 min     |
| 2      | 30 min     |
| 3      | 1 hour     |
| 4      | 2 hours    |

---

## Purpose

```text
Punish repeated attackers while allowing recovery
```

---

# 10. 📊 IP Risk Scoring

## Inputs

* Known bad IPs
* TOR exit nodes
* VPN/datacenter IPs

---

## Scoring

| Source | Score |
| ------ | ----- |
| Bad IP | +95   |
| TOR    | +60   |
| VPN    | +40   |

---

## Decision

* ≥ block threshold → block
* ≥ captcha threshold → require CAPTCHA

---

# 11. 🔄 Security Pipeline (Request Flow)

```text
Incoming Request
   ↓
Resolve IP
   ↓
Check temporary block
   ↓
Evaluate IP risk score
   ↓
Check failure thresholds
   ↓
Require CAPTCHA if needed
   ↓
Verify CAPTCHA
   ↓
Apply IP + route rate limits
   ↓
Apply principal rate limits
   ↓
Allow request
```

---

# 12. ⚖️ Combined Protection Model

```text
Request allowed ONLY if:
✔ IP limit passes
✔ Principal limit passes
✔ Risk checks pass
✔ CAPTCHA (if required) is solved
```

---

# 13. ⚠️ Real Attack Scenarios

---

## Scenario 1: Token Theft

```text
Attacker obtains innerToken
→ acts as valid user
```

Protection:

* principal rate limit
* adaptive blocking

---

## Scenario 2: Bot Scraping

```text
Automated script downloads all files
```

Protection:

* route limits
* principal limits
* CAPTCHA escalation

---

## Scenario 3: Distributed Attack

```text
Same token across multiple IPs
```

Protection:

* principal limit aggregates usage

---

# 14. 🧰 Storage Model

## Modes

* `memory` → simple, non-persistent
* `redis` → distributed, production-ready

---

## Recommendation

```text
Use Redis for production deployments
```

---

# 15. ⚙️ Operational Notes

* Use Redis for scaling
* Use real CAPTCHA provider
* Tune limits per route
* Monitor false positives

---

# 16. 🔐 Security Guarantees

This system ensures:

* Controlled API usage
* Resistance to brute-force attacks
* Protection against distributed abuse
* Limited impact of compromised tokens
* Fair resource usage across users

---

# 17. 🔥 Final Insight

```text
Login grants access.
Security limits control how that access is used.
```

---

# 18. 🧪 One-Line Summary

```text
A multi-layer adaptive security system that prevents abuse before and after authentication.
```

---
