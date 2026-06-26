# Contributing to GhostDrop

Thank you for your interest in contributing. This document explains the process, conventions, and non-negotiable rules — especially around credential safety.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Naming](#branch-naming)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Checklist](#pull-request-checklist)
- [Credential Safety](#credential-safety-non-negotiable)
- [Schema Changes](#schema-changes)
- [Security-Sensitive Changes](#security-sensitive-changes)
- [Reporting Bugs](#reporting-bugs)

---

## Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<your-username>/Privacy-Focused-File-Transferring-System.git
cd Privacy-Focused-File-Transferring-System

# 2. Initialise the database
mysql -u root -p < Ghost_Drop/backend/sql/init_schema.sql

# 3. Configure environment
cp Ghost_Drop/backend/.env.example Ghost_Drop/backend/.env
# Fill in: DB credentials, GOOGLE_DRIVE_FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
#           TOKEN_LOOKUP_SECRET, SUB_TOKEN_SECRET_KEY

# 4. Install dependencies
cd Ghost_Drop/backend
npm install

# 5. Start development server
npm run dev
```

The app runs at `http://localhost:4000`. The health endpoint is `http://localhost:4000/api/health`.

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feature/<short-description>` | `feature/client-side-encryption` |
| Bug fix | `fix/<short-description>` | `fix/rate-limit-redis-reconnect` |
| Documentation | `docs/<short-description>` | `docs/architecture-diagram` |
| Schema change | `schema/<short-description>` | `schema/add-audit-event-type` |
| Refactor | `refactor/<short-description>` | `refactor/vault-cleanup-service` |

All branches should be cut from `main`.

---

## Development Workflow

1. Create your branch from `main`.
2. Make focused, incremental commits (one logical change per commit).
3. Test your changes against a local MySQL 8 instance with the full schema applied.
4. If you changed any environment variable handling, update `.env.example` with the new variable, its default, and a comment.
5. Open a pull request against `main`.

---

## Code Style

- **JavaScript**: follow the existing style — `const`/`let`, async/await, no var, explicit error handling.
- **SQL**: uppercase keywords (`SELECT`, `WHERE`, `INSERT`), lowercase identifiers, one clause per line.
- **Naming**: snake_case for database columns and files; camelCase for JavaScript variables and functions.
- **Error handling**: always propagate errors via `logger.error(...)` before returning a 5xx response. Never swallow errors silently in route handlers.
- **Secrets in code**: never hardcode tokens, passwords, or secrets. Use environment variables. The `validateEnv.js` startup check will catch missing required vars.

Run the linter before opening a PR:

```bash
cd Ghost_Drop/backend
npm run lint
```

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short summary>

[optional body — explain WHY, not WHAT]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `security`

**Examples:**

```
feat(vault): add per-vault download count cap
fix(security): prevent CAPTCHA double-counting on rate-limit precheck
docs(encryption): rewrite key wrapping section with envelope diagram
security(auth): use timingSafeEqual for all token comparisons
schema(portfolio): add idx_portfolio_integrity_hash covering index
```

---

## Pull Request Checklist

Before requesting review, confirm each item:

- [ ] `npm run lint` passes with no errors
- [ ] The schema still initialises cleanly: `mysql -u root -p < Ghost_Drop/backend/sql/init_schema.sql`
- [ ] If you added an env variable, it is documented in `.env.example` with a comment
- [ ] If you changed database schema, the change is reflected in `init_schema.sql` **and** in `services/schemaOptimization.js` if it is an index
- [ ] No credential files are staged: run `git status` and confirm `.env`, `service_account.json`, `oauth_credentials.json`, `*.key`, `*.pem` are absent
- [ ] Existing functionality was tested manually (vault create → upload → access → download flow)
- [ ] If the change is security-sensitive, it is described clearly in the PR body (see below)

---

## Credential Safety — Non-Negotiable

**Never commit any of the following:**

| File | Why it is dangerous |
|---|---|
| `Ghost_Drop/backend/.env` | Contains DB password, Google Drive folder ID, secret keys |
| `Ghost_Drop/backend/service_account.json` | Full Google Cloud service account private key |
| `Ghost_Drop/backend/oauth_credentials.json` | Google OAuth client credentials |
| Any `*.key`, `*.pem`, `*.p12` file | Cryptographic key material |
| Any file containing a real `TOKEN_LOOKUP_SECRET` or `SUB_TOKEN_SECRET_KEY` value | Master encryption keys |

The `.gitignore` files at the root and in `Ghost_Drop/backend/` cover all of the above.
Run `git status` before every commit. If you see any of these files staged, unstage them immediately with `git reset HEAD <file>`.

If you accidentally commit credentials, **immediately rotate them** (regenerate the service account key, change the DB password, generate new secret values) — do not rely on a history rewrite to protect them.

---

## Schema Changes

If your change modifies the database schema:

1. Update `Ghost_Drop/backend/sql/init_schema.sql` — this is the single authoritative schema source.
2. If you are adding an index that should be applied to existing databases without a full re-init, also add it to `Ghost_Drop/backend/src/services/schemaOptimization.js` so the startup reconciler applies it automatically.
3. If you are adding a new table, document it in the **Database Schema** section of [`Ghost_Drop/README.md`](Ghost_Drop/README.md).
4. If you are changing column types or dropping columns, provide a migration SQL snippet in the PR description.

---

## Security-Sensitive Changes

Changes to any of the following areas require extra care and a detailed PR description:

- `Ghost_Drop/backend/src/services/crypto.js` — token hashing and verification
- `Ghost_Drop/backend/src/services/fileSecurityMetadata.js` — file encryption and key wrapping
- `Ghost_Drop/backend/src/services/security.js` — rate limiting, IP risk, CAPTCHA
- `Ghost_Drop/backend/src/middleware/securityGate.js` — security gate pipeline
- `Ghost_Drop/backend/src/services/portfolioIntegrity.js` — tamper detection
- `Ghost_Drop/backend/sql/init_schema.sql` — trigger guards

For security vulnerabilities, do **not** open a public PR. Follow the process in [SECURITY.md](SECURITY.md) instead.

---

## Reporting Bugs

Open a [GitHub Issue](https://github.com/Suchith2212/Privacy-Focused-File-Transferring-System/issues) with:

- **Environment**: OS, Node.js version, MySQL version
- **Steps to reproduce**
- **Expected behaviour**
- **Actual behaviour**
- **Relevant logs** (from `backend/logs/audit.log` or the server console — redact any tokens or credentials before pasting)

For security-related bugs, see [SECURITY.md](SECURITY.md).
