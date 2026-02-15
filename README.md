# 🔐 Privacy-Focused File Transferring Portal

A secure, anonymous, temporary file transfer system designed for safe usage on public or shared computers — without requiring user login.

---

## 🚩 Problem

Transferring files from public systems (libraries, labs, cybercafes, shared workstations) exposes users to:

- Credential theft (Google Drive, WhatsApp Web, etc.)
- Session hijacking or forgotten logouts
- Persistent cloud storage risks
- USB malware propagation
- Trace retention in browser history and cache

There is a need for a **temporary, privacy-preserving, cryptographically secure file transfer system** that:

- ❌ Does not require user accounts  
- ❌ Does not permanently store user data  
- ✅ Enforces strong encryption  
- ✅ Supports selective sharing  
- ✅ Automatically deletes data after expiry  

---

## 🏗 Proposed Solution

The Privacy-Focused File Transfer Portal introduces a **dual-token vault architecture**:

- **Outer Token (System Generated)**  
  - 7 characters  
  - Base62 (0–9, A–Z, a–z)  
  - Used to identify a vault  

- **Inner Token (User Defined)**  
  - 10–20 characters  
  - Base62  
  - Used for authentication and key derivation  

Each vault:
- Is valid for **1 week + 1 hour buffer**
- Contains exactly one MAIN token
- May contain multiple SUB tokens
- Automatically expires and deletes data

---

## 🔄 System Workflow

### 📤 Upload Process

1. System generates an Outer Token.
2. User defines a MAIN Inner Token.
3. Files are uploaded.
4. Each file:
   - Gets a unique 256-bit file key.
   - Encrypted using AES-256-GCM.
   - File key is wrapped using a key derived from Inner Token (PBKDF2).
5. Vault expiry time is set.

---

### 📥 Download Process

1. User enters Outer Token.
2. System validates vault and expiry.
3. User enters Inner Token.
4. Token is verified using hash + salt.
5. Authorized files are shown.
6. Upon download:
   - File is decrypted.
   - File is soft-deleted.
   - Wrapped keys are removed.

**Download Model:** One-time download only.

---

## 🔐 Security Architecture

- PBKDF2 (≥ 200,000 iterations)
- Unique salt per token
- AES-256-GCM per file
- Unique encryption key per file
- No plaintext token storage
- Session-based brute-force protection
- CAPTCHA enforcement
- Temporary session blocking
- Strict vault expiry enforcement

---

## 🗂 Database Design

Main entities:

- VAULTS
- INNER TOKENS (MAIN / SUB)
- FILES
- FILE METADATA
- FILE KEY ACCESS
- SESSIONS
- AUTH ATTEMPTS
- DOWNLOAD LOGS
- CAPTCHA TRACKING
- EXPIRY JOBS

### Key Constraints

- Exactly one MAIN token per vault
- At most one SUB token per file
- File state transition: ACTIVE → DELETED (irreversible)
- Vault access denied after expiry
- Cross-vault access prevented

---

## 🔐 Threat Resistance

### 1️⃣ Unauthorized Online Access
- Outer Token entropy: ~42 bits
- Inner Token entropy: ≥ 60 bits
- Rate limiting + CAPTCHA + session blocking

### 2️⃣ Database Compromise
- No plaintext tokens stored
- Unique salt per token
- High-cost PBKDF2
- Wrapped file keys only

### 3️⃣ Cloud Storage Compromise
- Files encrypted with AES-256-GCM
- Unique file key per file
- File keys wrapped via derived key

### 4️⃣ One-Time Download Protection
- File marked DELETED after download
- Wrapped keys removed
- No re-download possible

---

## 🧠 Design Philosophy

- Privacy-first
- Zero mandatory login
- Minimal metadata exposure
- Cryptographic enforcement instead of trust-based deletion
- Secure by architecture, not policy

---

## 📅 Vault Lifecycle

- Creation → ACTIVE
- Expiry reached → EXPIRED
- Immediate access denial
- Background job permanently removes cloud objects

---

## 📌 Security Guarantees

- Per-file encryption
- Strong KDF-based protection
- Immediate logical revocation
- Selective file sharing via SUB tokens
- Automatic deletion after fixed duration
- Protection against brute-force and enumeration attacks

---

## 🎯 Ideal Use Cases

- Transferring files from public labs
- Temporary confidential sharing
- Anonymous file exchange
- Secure one-time delivery
- Avoiding credential exposure

---

## 🏁 Conclusion

This system provides a cryptographically enforced, temporary, anonymous file transfer mechanism designed specifically for high-risk environments such as public or shared systems.

Compromise of any single layer does not expose plaintext data. Multiple security boundaries must be broken simultaneously — making practical exploitation highly improbable.

---


