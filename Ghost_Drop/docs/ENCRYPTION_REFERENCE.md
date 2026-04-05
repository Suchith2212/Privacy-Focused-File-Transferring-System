# 🔐 Ghost Drop Encryption Architecture (Pro-Level Detailed Explanation)

---

# 1. 🧭 System Overview

This system is designed to securely store and share files while ensuring:

* 🔒 **Confidentiality** → Unauthorized users cannot read files
* 🛡 **Integrity** → Any modification is detected
* 🔑 **Access Control** → Only valid tokens can decrypt files
* 🔄 **Scalability** → Supports multiple users without re-encryption

---

## 🔥 Core Design Philosophy

```text
Never store data together with the key required to decrypt it.
```

This principle drives the entire architecture.

---

# 2. 🧠 Foundational Concepts (Must Understand)

## 2.1 Encryption vs Hashing

| Concept    | Meaning           | Reversible | Use Case          |
| ---------- | ----------------- | ---------- | ----------------- |
| Encryption | Hide data         | ✅ Yes      | Files, secrets    |
| Hashing    | One-way transform | ❌ No       | Tokens, passwords |

---

## 2.2 Key Hierarchy (VERY IMPORTANT)

```text
User Token
   ↓ (PBKDF2)
Derived Key
   ↓ (decrypt)
File Key
   ↓ (decrypt)
File Data
```

👉 This layered structure is the **core security model**.

---

# 3. 🔐 Cryptographic Primitives

| Primitive          | Purpose        | Why Used                    |
| ------------------ | -------------- | --------------------------- |
| PBKDF2-HMAC-SHA256 | Key derivation | Slow → resists brute force  |
| HMAC-SHA256        | Lookup hashing | Fast filtering              |
| AES-256-GCM        | Encryption     | Confidentiality + integrity |
| SHA-256            | Hashing        | Tamper detection            |

---

# 4. 🔑 Token Security Layer

## 4.1 Why Tokens Are Hashed (Not Encrypted)

```text
token → PBKDF2 → hash → store
```

### Reason:

* We NEVER need to recover token
* Only need to verify it

---

## 4.2 Why PBKDF2?

### Problem:

Fast hashes (like SHA-256) are insecure for passwords.

### Solution:

PBKDF2:

* Adds salt
* Uses many iterations (e.g., 250k)
* Slows attackers drastically

---

## 4.3 Lookup Optimization

### Problem:

PBKDF2 is slow → querying becomes expensive

### Solution:

```text
HMAC(token, secret) → lookup hash
```

### Flow:

1. Fast DB filter
2. Slow PBKDF2 verification

---

# 5. 📁 File Encryption Layer

## 5.1 Why Not Use Token Directly?

### ❌ Bad Design:

```text
file → encrypt(token)
```

Problems:

* Token changes → must re-encrypt file
* Multiple users → complex sharing
* Poor scalability

---

## 5.2 Correct Design (Envelope Encryption)

```text
file → encrypted using fileKey
fileKey → encrypted using token-derived key
```

---

## 5.3 File Encryption Process

### Step 1: Generate File Key

```text
fileKey = random 32 bytes
```

👉 Each file has a **unique key**

---

### Step 2: Encrypt File

```text
ciphertext = AES-256-GCM(fileKey, file)
```

Outputs:

* ciphertext
* IV
* authTag

---

## 🧠 Why Random File Keys?

| Benefit     | Explanation                  |
| ----------- | ---------------------------- |
| Isolation   | One file compromise ≠ others |
| Performance | No repeated re-encryption    |
| Flexibility | Supports multi-user access   |

---

# 6. 🔄 AES-256-GCM Deep Explanation

AES-GCM is an **AEAD cipher**:

```text
Authenticated Encryption with Associated Data
```

---

## 6.1 IV (Initialization Vector)

### Purpose:

Adds randomness to encryption

### Without IV:

```text
same input → same output ❌
```

### With IV:

```text
same input → different output ✔
```

---

### Rules:

* Must be unique per encryption
* Not secret
* Must be stored

---

## 6.2 Authentication Tag

### Purpose:

Ensures integrity

During decryption:

* recomputed and compared
* mismatch → FAIL

---

### Protects Against:

* data tampering
* wrong key usage
* IV manipulation

---

# 7. 🔁 Key Wrapping (Core Security Mechanism)

## 7.1 Problem

```text
Store fileKey directly → attacker decrypts everything ❌
```

---

## 7.2 Solution

```text
fileKey → encrypted using derivedKey → wrappedFileKey
```

---

## 7.3 Full Flow

```text
innerToken
   ↓ PBKDF2
derivedKey
   ↓ encrypt
fileKey
   ↓
wrappedFileKey (stored)
```

---

## 🧠 Key Insight

```text
File is locked by fileKey
fileKey is locked by token
```

---

# 8. 📤 Upload Flow (Detailed)

```text
1. User sends file + token
2. Verify token (PBKDF2)
3. Generate fileKey
4. Encrypt file (AES-GCM)
5. Upload ciphertext to storage
6. Derive key from token
7. Wrap fileKey
8. Store metadata in DB
```

---

# 9. 📥 Download Flow (Detailed)

```text
1. User provides token
2. Verify token
3. Fetch wrappedFileKey
4. Derive key
5. Unwrap fileKey
6. Download ciphertext
7. Decrypt file
8. Verify integrity (authTag + SHA-256)
9. Return plaintext
```

---

# 10. 🧾 Integrity Layer

## 10.1 AES-GCM Auth Tag

* detects tampering during decryption

## 10.2 SHA-256 Hash

```text
hash = SHA256(plaintext)
```

### Why both?

* GCM → cryptographic integrity
* SHA → additional verification layer

---

# 11. 🔐 Sub-Token Secret Encryption (Deep Dive)

## 11.1 Why Encryption Here?

| Case             | Method  |
| ---------------- | ------- |
| Login token      | Hash    |
| SUB token secret | Encrypt |

👉 Because SUB token must be **recoverable**

---

## 11.2 Storage Model

Stored in `sub_token_secrets`:

| Field      | Purpose         |
| ---------- | --------------- |
| ciphertext | encrypted token |
| IV         | randomness      |
| authTag    | integrity       |
| version    | future upgrades |

---

## 11.3 Encryption Flow

```text
subToken
   ↓
AES-256-GCM(masterKey, iv)
   ↓
ciphertext + authTag
```

---

## 11.4 Decryption Flow

```text
ciphertext
   ↓
AES-256-GCM(masterKey, iv)
   ↓
subToken
```

---

## 11.5 Security Guarantee

If DB leaks:

* attacker sees encrypted data
* cannot decrypt without key

---

# 12. 🔑 Key Management (CRITICAL)

## 12.1 Master Key

```text
SUB_TOKEN_SECRET_KEY
```

---

## Requirements:

* 256-bit random
* stored in environment or KMS
* never in database

---

## 🔥 Security Rule

```text
If attacker gets DB but not key → data is safe
```

---

## 12.2 Key Rotation

* supported via versioning
* requires re-encryption

---

## 12.3 Production Best Practice

Use:

* AWS KMS
* GCP KMS

---

# 13. 🧩 Multi-User Access

```text
Same file
   ├── wrapped for MAIN
   └── wrapped for SUB
```

---

### Advantage:

* no file re-encryption
* efficient sharing

---

# 14. 🛡 Threat Model

## Cloud Compromise

* attacker gets ciphertext
* cannot decrypt

---

## Database Compromise

* attacker gets wrapped keys
* cannot decrypt without token/key

---

## Full Compromise

* attacker gets keys → system compromised

---

# 15. 🚨 Risks & Mitigations

| Risk           | Mitigation            |
| -------------- | --------------------- |
| Weak tokens    | enforce strong tokens |
| Low iterations | use high PBKDF2       |
| Key leakage    | secure env/KMS        |
| IV reuse       | always random IV      |

---

# 16. 🧠 Mental Model

```text
Token → Key → File Key → File
```

---

# 17. 🔐 Security Guarantees

* Data always encrypted
* Keys never stored in plaintext
* Integrity always verified
* Access strictly controlled

---

# 18. 📦 Storage Separation

## Cloud

* ciphertext only

## Database

* wrapped keys
* IVs
* tags
* hashes

---

# 19. ⚙️ Operational Notes

* Apply schema before running
* Set `SUB_TOKEN_SECRET_KEY`
* rotate keys carefully
* never log secrets

---

# 20. 🔥 Final Insight

```text
Breaking storage does not break security — breaking keys does.
```

---
