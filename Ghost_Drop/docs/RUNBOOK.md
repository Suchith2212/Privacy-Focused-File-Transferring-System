# GhostDrop — Operational Runbook

This document is the operational playbook for system administrators and DevOps engineers running GhostDrop in production. It contains procedures for day-to-day operations, disaster recovery, security incident response, and performance tuning.

---

## Table of Contents

- [System Architecture Quick Reference](#system-architecture-quick-reference)
- [1. Database Backup & Restore](#1-database-backup--restore)
- [2. Vault Cleanup & Garbage Collection](#2-vault-cleanup--garbage-collection)
- [3. Cryptographic Key Rotation](#3-cryptographic-key-rotation)
- [4. Redis Failover & Cache Operations](#4-redis-failover--cache-operations)
- [5. Audit Log Analysis & Rotation](#5-audit-log-analysis--rotation)
- [6. Troubleshooting & Diagnostics](#6-troubleshooting--diagnostics)

---

## System Architecture Quick Reference

GhostDrop relies on three stateful components:
1. **MySQL Database**: Stores vault metadata, session states, audit configurations, and wrapped file key records.
2. **Google Drive Storage**: Holds the actual encrypted files (AES-256-GCM ciphertexts).
3. **Redis (Production)**: Manages rate-limiting state, IP risk scores, and CAPTCHA solutions.

For a detailed breakdown, see the [Architecture Reference](ARCHITECTURE.md).

---

## 1. Database Backup & Restore

Because GhostDrop uses envelope encryption with keys stored in the database and ciphertexts stored on Google Drive, **the database backup and Google Drive metadata MUST be kept in sync**. If the DB is restored to a state older than Google Drive, you will have orphaned ciphertexts on Drive. If the DB is newer, you will have DB records pointing to missing files.

### 1.1 Automated Backup Script

Run the following cron-capable script to perform a consistent database dump:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Variables
BACKUP_DIR="/var/backups/ghostdrop"
TIMESTAMP=$(date +%F_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/ghostdrop_db_${TIMESTAMP}.sql.gz"
LOG_FILE="/var/log/ghostdrop/backup.log"

mkdir -p "${BACKUP_DIR}"

echo "[${TIMESTAMP}] Starting database backup..." >> "${LOG_FILE}"

# Perform a single-transaction dump to avoid blocking reads/writes
mysqldump \
  --user="${DB_USER}" \
  --password="${DB_PASSWORD}" \
  --host="${DB_HOST}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  "${DB_NAME}" | gzip > "${BACKUP_FILE}"

echo "[${TIMESTAMP}] Backup completed: ${BACKUP_FILE}" >> "${LOG_FILE}"
```

### 1.2 Restoring from Backup

> [!CAUTION]
> Restoring a database backup will overwrite the current database state. Ensure you pause the application process to prevent concurrent writes during the restore process.

1. **Stop the application server**:
   ```bash
   docker-compose stop app
   ```
2. **Restore the SQL schema and data**:
   ```bash
   gunzip -c /var/backups/ghostdrop/ghostdrop_db_YYYY-MM-DD_HH-MM-SS.sql.gz | \
     mysql --user="${DB_USER}" --password="${DB_PASSWORD}" --host="${DB_HOST}" "${DB_NAME}"
   ```
3. **Verify Google Drive integrity**:
   Run the portfolio integrity scan (or look up logs) to identify if any DB records reference Google Drive file IDs that were deleted.

---

## 2. Vault Cleanup & Garbage Collection

Expired vaults are automatically purged by the background timer. However, if the cleanup service experiences a prolonged outage or a large burst of expirations occurs, you may need to run or tune cleanup manually.

### 2.1 Tuning Cleanup Parameters

Adjust these variables in `.env` to manage cleanup throughput:

```ini
# Frequency of cleanup scans (default is 10 minutes)
VAULT_CLEANUP_INTERVAL_MS=600000

# Buffer period after expiration before data is purged (default is 1 hour)
VAULT_CLEANUP_GRACE_HOURS=1

# Max number of vaults deleted per cycle to prevent rate-limiting on Google Drive API
VAULT_CLEANUP_BATCH_SIZE=20
```

### 2.2 Manual Trigger of Vault Cleanup

If you need to force-run a cleanup cycle immediately without waiting for the background timer, you can trigger it via the admin CLI or by invoking the cleanup service directly if exposed through an administrative route.

Otherwise, you can execute the cleanup script directly in the container context:

```bash
docker-compose exec app node -e "
const { runCleanupCycle } = require('./src/services/vaultCleanup');
runCleanupCycle().then(() => {
  console.log('Cleanup cycle finished successfully');
  process.exit(0);
}).catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
"
```

---

## 3. Cryptographic Key Rotation

GhostDrop uses two master secret keys:
1. `TOKEN_LOOKUP_SECRET`: Used to compute the fast HMAC lookup hash.
2. `SUB_TOKEN_SECRET_KEY`: Used as the AES-256-GCM key to wrap/unwrap SUB token secrets.

> [!WARNING]
> Changing either of these keys in production without running a migration script will break access to all existing vaults and files. Follow the rotation procedures below.

### 3.1 Rotating `TOKEN_LOOKUP_SECRET` (Zero-Downtime)

To rotate the lookup secret, the application must temporarily support both the old and new secrets for lookup, and re-hash records on access.

1. **Generate a new 32-byte secret**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Phase 1: Dual-key lookup (Read-Old, Write-New)**:
   Add `TOKEN_LOOKUP_SECRET_NEW` to your `.env` file. Modify `src/services/crypto.js` to generate lookup hashes using the new secret, but fallback to verifying with the old secret if not found.
3. **Phase 2: Migrate existing DB records**:
   Run a script to update all lookup hashes in the `inner_tokens` database table:
   ```bash
   # Execute migration script (to be written based on specific rotation needs)
   ```
4. **Phase 3: Cleanup**:
   Replace `TOKEN_LOOKUP_SECRET` with the new value and remove the dual-key code.

### 3.2 Rotating `SUB_TOKEN_SECRET_KEY`

If the sub-token secret key is compromised, you must re-encrypt all `sub_token_secrets` rows.

1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Execute the re-encryption utility script:
   ```bash
   docker-compose exec app node scripts/rotateSubTokenKey.js --oldKey="<old_hex>" --newKey="<new_hex>"
   ```
   *Note: This script decrypts each row using the old key and immediately encrypts it using the new key inside a database transaction.*

---

## 4. Redis Failover & Cache Operations

In production, Redis handles active rate limits and CAPTCHA sessions. If Redis goes offline, the application will fallback to in-memory tracking or fail safe depending on configurations.

### 4.1 Redis Recovery Commands

If Redis experiences memory exhaustion or becomes unresponsive:

*   **Check connection and latency**:
    ```bash
    docker-compose exec redis redis-cli -a "${REDIS_PASSWORD}" ping
    ```
*   **Monitor incoming commands**:
    ```bash
    docker-compose exec redis redis-cli -a "${REDIS_PASSWORD}" monitor
    ```
*   **Clear all rate limits (Emergency release)**:
    ```bash
    docker-compose exec redis redis-cli -a "${REDIS_PASSWORD}" FLUSHALL
    ```

### 4.2 Handling Redis Outages

If Redis crashes and cannot be restarted immediately:
1. Set `SECURITY_STORE=memory` in `.env`.
2. Restart the Express application:
   ```bash
   docker-compose restart app
   ```
   *Note: Rate limits will reset and will be tracked in-memory per container instance. If running multiple replicas, rate limit tracking will not be synchronized.*

---

## 5. Audit Log Analysis & Rotation

The audit log is written to `Ghost_Drop/backend/logs/audit.log`. It uses a JSON-per-line format suitable for log forwarders (e.g., Filebeat, Logstash).

### 5.1 Structure of an Audit Log Entry

```json
{
  "ts": "2026-06-23T17:21:43.123Z",
  "severity": "WARNING",
  "sessionId": "sess_89f0a23b...",
  "ipAddress": "192.168.1.50",
  "userAgent": "Mozilla/5.0 ...",
  "event": "VAL_EXPIRED",
  "vaultId": "vlt_7820a1bc...",
  "details": {
    "reason": "Attempted access to expired vault"
  }
}
```

### 5.2 Log Rotation Configuration

Use standard `logrotate` to prevent the log file from consuming all available disk space. Add the following config to `/etc/logrotate.d/ghostdrop`:

```
/var/log/ghostdrop/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ghostdrop ghostdrop
    sharedscripts
    postrotate
        # Signal Express application to reopen log file descriptors
        docker-compose kill -s SIGUSR2 app
    endscript
}
```

---

## 6. Troubleshooting & Diagnostics

### 6.1 High Latency on Route Requests
If users complain about slow file downloads or slow logins:
1. **Check PBKDF2 iterations**: Ensure `PBKDF2_ITERATIONS` (default 250,000) or `FILE_KEY_WRAP_ITERATIONS` (default 200,000) are not configured to excessively high numbers.
2. **Monitor Database CPU**: Ensure the composite indexes are correctly applied. Run `EXPLAIN` on slow queries reported in the database slow query log.
3. **Verify CPU usage**: High PBKDF2 runs are CPU-bound. If Node.js CPU usage is 100%, consider scaling up the container resources or using multiple replicas.

### 6.2 CAPTCHA Loop Issues
If users are locked in a CAPTCHA loop (solving CAPTCHA but still prompted):
1. Ensure the client sends the correct `x-captcha-response` headers or JSON parameters.
2. Verify Redis clock synchronization; if Redis time drifts, CAPTCHA solutions might expire instantly.
3. Check the client IP resolution; if the load balancer is not forwarding the client IP correctly via `X-Forwarded-For`, all users will share the same IP state. Ensure `TRUST_PROXY=true` is set.
