# Security Policy

## Supported Versions

This project is currently developed and maintained as an academic research prototype.
Security fixes are applied to the `main` branch only.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Older branches | ❌ |

---

## Reporting a Vulnerability

GhostDrop handles cryptographic key material, token secrets, and encrypted file data.
If you discover a security vulnerability — especially one relating to:

- Cryptographic weaknesses (AES-256-GCM, PBKDF2, key wrapping)
- Token enumeration or timing oracle attacks
- Authentication or session bypass
- Information leakage through error responses
- Insecure direct object reference on vault/file endpoints
- Privilege escalation between MAIN and SUB token roles
- SQL injection or database integrity bypass

**Please do not open a public GitHub issue.**

### How to Report

1. Email the repository owner directly via the contact listed on the GitHub profile, **or**
2. Open a [GitHub Security Advisory](https://github.com/Suchith2212/Privacy-Focused-File-Transferring-System/security/advisories/new) (private disclosure, visible only to maintainers).

### What to Include

- A clear description of the vulnerability
- Steps to reproduce (proof-of-concept, if possible)
- The potential impact
- Any suggested mitigations (optional but appreciated)

### Response Timeline

| Stage | Target |
|---|---|
| Acknowledgement | Within 72 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days (critical issues prioritised) |

### Scope

The following are **in scope**:

- `Ghost_Drop/backend/` — Express API server, all routes and services
- `Ghost_Drop/frontend/` — client-side token handling and QR scanning
- `Ghost_Drop/backend/sql/init_schema.sql` — schema design and trigger logic
- Docker Compose configuration and Dockerfile

The following are **out of scope**:

- Google Drive API itself (report to Google)
- Third-party CAPTCHA providers (hCaptcha / reCAPTCHA)
- Academic assignment materials in `Project_Assignments/`

---

## Security Design Summary

For context on the threat model and cryptographic design, see:

- [`Ghost_Drop/docs/ENCRYPTION_REFERENCE.md`](Ghost_Drop/docs/ENCRYPTION_REFERENCE.md) — key hierarchy, envelope encryption, AES-GCM details
- [`Ghost_Drop/docs/SECURITY_LIMITS_REFERENCE.md`](Ghost_Drop/docs/SECURITY_LIMITS_REFERENCE.md) — rate limiting, adaptive blocking, IP risk scoring
- [`Ghost_Drop/README.md`](Ghost_Drop/README.md) — full security architecture section

---

## Known Limitations

- The security store defaults to **in-memory** in development. This means rate-limit state is not shared across processes and resets on server restart. Always use `SECURITY_STORE=redis` in production.
- Client-side encryption is not yet implemented. Files are decrypted server-side before streaming to the client. An HTTPS transport layer is mandatory in any deployment.
- The built-in math CAPTCHA (`CAPTCHA_PROVIDER=math`) is suitable for development only. Use hCaptcha or reCAPTCHA in production.
