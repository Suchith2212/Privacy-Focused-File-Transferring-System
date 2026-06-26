# GhostDrop — Encryption Architecture Reference

> Deep-dive reference for the cryptographic design of GhostDrop.  
> For the architecture overview see [`ARCHITECTURE.md`](ARCHITECTURE.md). For the API see [`JSON_API_REQUESTS_PRO_GUIDE.md`](JSON_API_REQUESTS_PRO_GUIDE.md).

---

## Table of Contents

- [Design Philosophy](#design-philosophy)
- [Cryptographic Primitives](#cryptographic-primitives)
- [Token Security Layer](#token-security-layer)
- [File Encryption Layer](#file-encryption-layer)
- [Key Wrapping](#key-wrapping)
- [Sub-Token Secret Storage](#sub-token-secret-storage)
- [Portfolio Integrity Hashing](#portfolio-integrity-hashing)
- [Upload Flow](#upload-flow)
- [Download Flow](#download-flow)
- [Multi-User Access](#multi-user-access)
- [Threat Model](#threat-model)
- [Key Management](#key-management)
- [Risks and Mitigations](#risks-and-mitigations)

---

## Design Philosophy

> **Never store data together with the key required to decrypt it.**

This principle drives every design choice in the system:

- Files are encrypted before upload. Only AES-256-GCM ciphertext reaches Google Drive — no plaintext, no keys, no metadata.
- Inner tokens are hashed with PBKDF2, never stored in plaintext. Without the correct token, the file key cannot be recovered.
- File keys are wrapped (re-encrypted) with a key derived from the user's token. The file key itself is never stored in plaintext anywhere.

---

## Cryptographic Primitives

| Primitive | Where Used | Why Chosen |
|---|---|---|
| **PBKDF2-HMAC-SHA256** | Inner token hashing; file key wrapping derivation | Computationally expensive by design — resists brute force at 250 000 iterations |
| **HMAC-SHA256** | Token lookup pre-filter; portfolio integrity hash | Fast, keyed — deterministic given the secret; not brute-force resistant alone, but used only for pre-filtering |
| **AES-256-GCM** | File encryption; file key wrapping; SUB token secret storage | AEAD cipher — provides confidentiality and integrity in a single pass; 256-bit key, 96-bit IV |
| **SHA-256** | Plain-file integrity hash (`file_plain_hash`); portfolio row hash | Secondary verification layer; fast, collision-resistant |
| **`crypto.randomBytes`** | All IVs, salts, file keys, tokens | Cryptographically secure pseudorandom number generator (CSPRNG) from the OS |
| **`crypto.timingSafeEqual`** | All token and hash comparisons | Prevents timing-oracle attacks by ensuring constant execution time regardless of where comparison fails |

---

## Token Security Layer

### Why Tokens Are Hashed, Not Encrypted

Tokens serve as authentication credentials. The system only ever needs to **verify** a token — it never needs to recover it in plaintext. Therefore, a one-way function (PBKDF2) is correct. Encrypting would imply decryptability, which is unnecessary and introduces a key management burden.

### PBKDF2 Token Hashing

```
token  ──►  PBKDF2-HMAC-SHA256(token, salt, iterations, 32 bytes)  ──►  token_hash
```

Stored in `inner_tokens`:

| Column | Value |
|---|---|
| `token_hash` | 64-char hex PBKDF2 output |
| `salt` | 32-char hex (16 random bytes) |
| `key_iterations` | 250 000 (configurable via `PBKDF2_ITERATIONS`) |

Verification re-derives the hash from the provided token and uses `crypto.timingSafeEqual` for the comparison.

### Lookup Pre-Filter (HMAC)

PBKDF2 at 250 000 iterations takes ~100 ms per verification. Running it against every token row in a vault would be slow. The lookup hash solves this:

```
token  ──►  HMAC-SHA256(token, TOKEN_LOOKUP_SECRET)  ──►  token_lookup_hash
```

This hash is fast to compute and indexed on `(token_lookup_hash, vault_id, status)`. The DB query narrows to matching candidates; PBKDF2 verification only runs against those.

**Important:** the HMAC is keyed by `TOKEN_LOOKUP_SECRET` — a server-side secret. This prevents an attacker with read access to the database from pre-computing lookup hashes for brute-forced tokens.

### Token Format Constraints

Inner tokens must be:
- 10–20 characters
- Base62 alphabet only (`0-9`, `A-Z`, `a-z`)
- Validated with `isBase62()` before any DB operation

---

## File Encryption Layer

### Why Not Encrypt Files Directly with the Token

If files were encrypted directly with the inner token:
- Revoking a token requires re-encrypting every file it touched.
- Multiple users sharing a file would require separate copies of the file, each encrypted with a different token.
- Token rotation is infeasible at scale.

### Envelope Encryption

```
fileKey = randomBytes(32)          ← unique per file, never stored in plaintext
ciphertext = AES-256-GCM(fileKey, plaintext)
wrappedKey = AES-256-GCM(PBKDF2(innerToken), fileKey)
```

Storage separation:
- `ciphertext + authTag + IV` → Google Drive
- `wrappedKey + wrapIV + wrapTag + wrapSalt` → MySQL `file_key_access`

### AES-256-GCM Properties

AES-GCM is an Authenticated Encryption with Associated Data (AEAD) cipher. Each encryption produces:

| Output | Size | Purpose |
|---|---|---|
| Ciphertext | same as plaintext | Encrypted data |
| IV (nonce) | 12 bytes (24-char hex) | Randomises each encryption; must be unique per key; not secret |
| Auth tag | 16 bytes (32-char hex) | Cryptographic integrity proof; decryption fails if tampered |

The auth tag means that **any modification to the ciphertext is detected at decryption time** — the decryption call throws before returning any plaintext.

A secondary SHA-256 hash of the original plaintext (`file_plain_hash`) is stored in the `files` table and verified after decryption as an additional integrity layer.

---

## Key Wrapping

File keys are never stored directly. They are wrapped (encrypted) using a key derived from the inner token:

### Wrap Process

```
1. wrapSalt = randomBytes(16)
2. wrapIV   = randomBytes(12)
3. wrappingKey = PBKDF2-HMAC-SHA256(innerToken, wrapSalt, wrapIterations, 32 bytes)  [async]
4. { wrappedKey, wrapTag } = AES-256-GCM(wrappingKey, fileKey)
```

Stored in `file_key_access`:

| Column | Content |
|---|---|
| `encrypted_file_key` | 64-char hex wrapped key |
| `key_wrap_iv` | 24-char hex IV |
| `key_wrap_tag` | 32-char hex auth tag |
| `key_wrap_salt` | 32-char hex salt |
| `key_wrap_iterations` | 200 000 (default) |
| `key_wrap_version` | Version number for future rotation |

### Unwrap Process

```
1. wrappingKey = PBKDF2-HMAC-SHA256(innerToken, wrapSalt, wrapIterations, 32 bytes)
2. fileKey = AES-256-GCM-decrypt(wrappingKey, wrappedKey, wrapIV, wrapTag)
```

Decryption fails (throws) if:
- The inner token is wrong (wrappingKey derived from wrong input)
- The wrapped key or tag was tampered with

---

## Sub-Token Secret Storage

SUB token values must be **recoverable** by the MAIN holder — so they cannot be hashed. They are encrypted at rest.

```
ciphertext = AES-256-GCM(SUB_TOKEN_SECRET_KEY, rawSubToken)
```

Stored in `sub_token_secrets`:

| Column | Content |
|---|---|
| `secret_ciphertext` | AES-256-GCM encrypted raw SUB token |
| `secret_iv` | 24-char hex IV |
| `secret_auth_tag` | 32-char hex auth tag |
| `secret_version` | Schema version for key rotation |

`SUB_TOKEN_SECRET_KEY` is a server-side master key set via environment variable — never stored in the database. Retrieving a SUB token requires this key; a DB-only breach cannot recover plaintext SUB tokens.

The `secret_version` field supports future key rotation: new writes use the current version; old records retain their version so the correct key can be selected during decryption.

---

## Portfolio Integrity Hashing

Each `portfolio_entries` row carries an application-level integrity hash:

```
integrity_hash = SHA-256(vaultId | ownerTokenId | title | content | status | PORTFOLIO_INTEGRITY_SECRET)
```

On every read, update, and delete the hash is recomputed and compared to the stored value. A mismatch means the row was modified outside the application (direct SQL, DB tool, etc.) and returns `409 PORTFOLIO_TAMPER_DETECTED`.

`PORTFOLIO_INTEGRITY_SECRET` is a server-side secret. Without it, an attacker who edits the database directly cannot compute the correct hash to cover their tracks.

A MySQL trigger (`before_portfolio_update_guard`) additionally blocks modification of `created_at` and `created_by_token_id` at the database layer, independent of the application.

---

## Upload Flow

```
Client → POST /api/files/:outerToken/upload  (multipart/form-data)
│
├─ Security gate (rate limit, CAPTCHA)
├─ Resolve vault (outer_token → vault_id)
├─ HMAC lookup hash → DB pre-filter
├─ PBKDF2 verify MAIN inner token
│
└─ For each file:
    ├─ validateUploadFile() — MIME + extension allowlist
    ├─ fileKey = randomBytes(32)
    ├─ plainHash = SHA-256(plaintext)
    ├─ { ciphertext, ivHex, authTagHex } = AES-256-GCM(fileKey, plaintext)
    ├─ Upload ciphertext to Google Drive → driveFileId
    ├─ { wrappedKey, wrapIV, wrapTag, wrapSalt } = wrapFileKeyForToken(fileKey, innerToken)
    ├─ INSERT files (driveFileId, ivHex, authTagHex, plainHash, ...)
    ├─ INSERT file_metadata (originalFilename, relativePath, ...)
    └─ INSERT file_key_access (fileId, innerTokenId, wrappedKey, wrapIV, ...)
```

---

## Download Flow

```
Client → GET /api/files/:outerToken/download/:fileId
│
├─ Security gate
├─ Resolve vault
├─ HMAC lookup hash → DB pre-filter → PBKDF2 verify inner token
├─ SELECT file_key_access WHERE file_id = ? AND inner_token_id = ?
├─ wrappingKey = PBKDF2(innerToken, wrapSalt, wrapIterations)
├─ fileKey = AES-256-GCM-decrypt(wrappingKey, wrappedKey, wrapIV, wrapTag)
├─ Download ciphertext from Google Drive
├─ plaintext = AES-256-GCM-decrypt(fileKey, ciphertext, ivHex, authTagHex)
├─ Verify: SHA-256(plaintext) === file_plain_hash
├─ UPDATE files SET status = 'DELETED', deleted_at = NOW()
├─ INSERT download_logs (fileId, innerTokenId, sessionId)
└─ Stream plaintext to client
```

---

## Multi-User Access

When a SUB token is created, the MAIN token holder's `file_key_access` rows are copied and re-wrapped for the SUB token:

```
For each selected fileId:
  1. Fetch fileKey using MAIN inner token (unwrap from MAIN's file_key_access row)
  2. wrapFileKeyForToken(fileKey, subInnerToken) → new wrappedKey, wrapIV, etc.
  3. INSERT file_key_access (fileId, subTokenId, newWrappedKey, ...)
```

The file ciphertext on Drive is never touched. Each token holds an independently wrapped copy of the same file key. Revoking a SUB token means deleting its `file_key_access` rows — no re-encryption needed.

---

## Threat Model

| Threat Scenario | Impact | Mitigation |
|---|---|---|
| **Google Drive breach** — attacker reads all stored files | Zero: attacker sees only AES-256-GCM ciphertext; no keys, no IVs, no auth tags | Keys and metadata are in MySQL, not Drive |
| **Database breach** — attacker reads all DB tables | Low: attacker sees wrapped keys and PBKDF2 hashes; cannot decrypt without the raw inner token | Wrapped keys require PBKDF2 derivation using the token to unwrap |
| **Full server breach** — attacker has DB + env vars | High: `TOKEN_LOOKUP_SECRET` and `SUB_TOKEN_SECRET_KEY` are exposed; active sessions are visible | Rotate all secrets immediately; existing ciphertexts remain protected while Drive is intact |
| **Token brute force** | Mitigated: PBKDF2 at 250k iterations makes each guess ~100 ms on typical hardware | Also: adaptive rate limiting + temp blocks + CAPTCHA escalation |
| **Timing oracle** | Mitigated: `crypto.timingSafeEqual` for all hash comparisons; HMAC lookup normalises the fast-path | PBKDF2 derivation time itself is constant for a given iteration count |
| **DB tampering (portfolio rows)** | Detected: integrity hash mismatch → 409 response; MySQL trigger blocks timestamp/creator mutation | `PORTFOLIO_INTEGRITY_SECRET` prevents hash forgery without the server-side key |

---

## Key Management

### `TOKEN_LOOKUP_SECRET`

- Purpose: HMAC key for the fast token pre-filter hash
- Type: any high-entropy string (≥ 48 random bytes recommended)
- Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- Rotation: requires recomputing `token_lookup_hash` for all `inner_tokens` rows

### `SUB_TOKEN_SECRET_KEY`

- Purpose: master AES-256 key for SUB token secret storage
- Type: any high-entropy string (≥ 48 random bytes recommended)
- Generate: same command as above
- Rotation: requires re-encrypting all `sub_token_secrets` rows; the `secret_version` column supports versioned migration

### `PORTFOLIO_INTEGRITY_SECRET`

- Purpose: HMAC key for portfolio row integrity hashing
- Default: `ghostdrop-portfolio-dev-secret` (safe in dev; blocked in production)
- Rotation: requires recomputing `integrity_hash` for all `portfolio_entries` rows

### `PBKDF2_ITERATIONS` / `FILE_KEY_WRAP_ITERATIONS`

- `PBKDF2_ITERATIONS` (default `250000`) controls token hashing strength
- `FILE_KEY_WRAP_ITERATIONS` (default `200000`) controls file key wrapping strength
- Both are tunable independently — increasing either raises the CPU cost per operation proportionally
- Both use async PBKDF2 (`util.promisify(crypto.pbkdf2)`) — they do **not** block the Node.js event loop

### Production Recommendations

- Store all secrets in a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault).
- Never log secrets — Pino is configured to exclude env vars from log output.
- Rotate secrets on any suspected compromise; existing encrypted data remains protected as long as the underlying plaintext has not been exposed.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Weak or short inner tokens | High | 10–20 char minimum; base62 alphabet (62^10 ≈ 8.4 × 10^17 combinations minimum) |
| Low PBKDF2 iterations | High | Configurable via `PBKDF2_ITERATIONS`; default 250 000; do not reduce below 100 000 |
| Server secret leakage | Critical | Store in env / secrets manager; never in code or logs; never in the database |
| IV reuse | Critical | All IVs are generated with `crypto.randomBytes` per encryption; never reused |
| Missing HTTPS | High | The server does not enforce HTTPS (responsibility of the reverse proxy); HSTS enabled in production mode |
| Math CAPTCHA in production | Medium | Default `CAPTCHA_PROVIDER=math` is easily defeated by automation; use hCaptcha or reCAPTCHA in production |
