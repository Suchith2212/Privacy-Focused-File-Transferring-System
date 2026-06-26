# 🔧 Ghost Drop - Critical Issues - Code Fixes

## Issue #1: Environment Variable Validation

**File: `backend/src/config/validateEnv.js`** (NEW FILE)

```javascript
/**
 * Validates that all required environment variables are set
 * before the application starts.
 * 
 * Run this FIRST thing in app.js before anything else!
 */

function validateEnvironment() {
  const errors = [];
  
  // REQUIRED variables
  const required = {
    DB_HOST: 'Database host (e.g., localhost)',
    DB_PORT: 'Database port (e.g., 3306)',
    DB_USER: 'Database user',
    DB_PASSWORD: 'Database password',
    DB_NAME: 'Database name',
    SUB_TOKEN_SECRET_KEY: 'Secret key for SUB tokens (min 64 chars)',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: 'Path to Google service account JSON',
  };
  
  // Check required variables
  for (const [key, description] of Object.entries(required)) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      errors.push(`✗ ${key}: ${description}`);
    }
  }
  
  // Validate SUB_TOKEN_SECRET_KEY length
  if (process.env.SUB_TOKEN_SECRET_KEY && process.env.SUB_TOKEN_SECRET_KEY.length < 64) {
    errors.push(`✗ SUB_TOKEN_SECRET_KEY: Must be at least 64 characters (received ${process.env.SUB_TOKEN_SECRET_KEY.length})`);
  }
  
  // Validate numeric variables
  const numeric = {
    PORT: 'Server port',
    DB_PORT: 'Database port',
    MAX_FILE_SIZE_MB: 'Max file size (MB)',
    MAX_VAULT_SIZE_MB: 'Max vault size (MB)',
    PBKDF2_ITERATIONS: 'PBKDF2 iterations count',
  };
  
  for (const [key, description] of Object.entries(numeric)) {
    if (process.env[key]) {
      const num = Number(process.env[key]);
      if (!Number.isFinite(num) || num <= 0) {
        errors.push(`✗ ${key}: Must be a positive number (${description})`);
      }
    }
  }
  
  // OPTIONAL variables with defaults (just inform)
  console.log('\n📋 Environment Configuration:');
  console.log(`  • NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  • PORT: ${process.env.PORT || '4000'}`);
  console.log(`  • DB_HOST: ${process.env.DB_HOST || '127.0.0.1'}`);
  console.log(`  • SECURITY_STORE: ${process.env.SECURITY_STORE || 'memory'}`);
  console.log(`  • CAPTCHA_PROVIDER: ${process.env.CAPTCHA_PROVIDER || 'math'}`);
  
  if (errors.length > 0) {
    console.error('\n❌ Environment Validation Failed:\n');
    errors.forEach(err => console.error(`  ${err}`));
    console.error('\n⚠️  Application cannot start with missing/invalid environment variables.');
    console.error('   Please review your .env file or environment variables.\n');
    process.exit(1);
  }
  
  console.log('\n✅ All required environment variables validated!\n');
}

module.exports = { validateEnvironment };
```

Add at the VERY TOP:

```javascript
// Load environment variables first
require("dotenv").config();

// Then validate environment variables
const { validateEnvironment } = require("./config/validateEnv");
validateEnvironment();

// Then everything else...
const path = require("path");
const express = require("express");
// ... rest of imports
```

---

## Issue #2: Database SSL/TLS Configuration

**File: `backend/src/config/db.js`** (UPDATE)

```javascript
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

function cleanEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function getSslConfig() {
  if (process.env.NODE_ENV !== "production") {
    return false;  // No SSL in development
  }
  
  // In production, SSL is required
  const sslConfig = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
  };
  
  // Optional: Load CA certificate
  if (process.env.DB_SSL_CA_PATH) {
    try {
      sslConfig.ca = fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8');
    } catch (err) {
      console.warn('⚠️  Could not read DB_SSL_CA_PATH:', err.message);
    }
  }
  
  // Optional: Load client certificate
  if (process.env.DB_SSL_CERT_PATH && process.env.DB_SSL_KEY_PATH) {
    try {
      sslConfig.cert = fs.readFileSync(process.env.DB_SSL_CERT_PATH, 'utf8');
      sslConfig.key = fs.readFileSync(process.env.DB_SSL_KEY_PATH, 'utf8');
    } catch (err) {
      console.warn('⚠️  Could not read DB_SSL certificate files:', err.message);
    }
  }
  
  return sslConfig;
}

const pool = mysql.createPool({
  host: cleanEnv("DB_HOST", "127.0.0.1"),
  port: Number(cleanEnv("DB_PORT", "3306")),
  user: cleanEnv("DB_USER", "root"),
  password: cleanEnv("DB_PASSWORD", ""),
  database: cleanEnv("DB_NAME", "ghostdrop_proto"),
  
  // ✅ ADD: SSL/TLS support
  ssl: getSslConfig(),
  
  waitForConnections: true,
  connectionLimit: 20,  // ✅ Increased from 10
  queueLimit: 0,
  
  // ✅ ADD: Better error handling
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0
});

// ✅ ADD: Connection error handling
pool.on('error', (err) => {
  console.error('❌ Database pool error:', err.code, err.message);
});

// ✅ ADD: Connection acquired logging
let connectionCount = 0;
pool.on('acquire', () => {
  connectionCount++;
  if (connectionCount % 10 === 0) {
    console.log(`📊 Active DB connections: ${connectionCount}`);
  }
});

pool.on('release', () => {
  connectionCount = Math.max(0, connectionCount - 1);
});

async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error('💥 Query error:', err.message);
    throw err;
  }
}

async function getConnection() {
  return pool.getConnection();
}

module.exports = {
  pool,
  query,
  getConnection
};
```

**File: `.env.example`** (UPDATE)

```
# Database Configuration
DB_HOST=your-database.com
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=ghostdrop_proto

# ✅ ADD: Database SSL/TLS (optional, for production)
# DB_SSL_CA_PATH=/etc/ssl/certs/ca-bundle.crt
# DB_SSL_CERT_PATH=/etc/ssl/certs/client-cert.pem
# DB_SSL_KEY_PATH=/etc/ssl/private/client-key.pem
# DB_SSL_REJECT_UNAUTHORIZED=true

# Other configurations...
PORT=4000
NODE_ENV=production
```

---

## Issue #3: Graceful Shutdown Handling

**File: `backend/src/app.js`** (UPDATE - ADD AT END)

```javascript
// ✅ ADD: Graceful shutdown handling

let isShuttingDown = false;
const shutdownTimeout = 30000;  // 30 seconds

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('⏱️  Shutdown already in progress, ignoring', signal);
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
  
  // Stop accepting new requests
  if (server) {
    server.close(async () => {
      console.log('✅ HTTP server closed, no new requests accepted');
      await performShutdownCleanup();
    });
  } else {
    await performShutdownCleanup();
  }
  
  // Force exit if shutdown takes too long
  setTimeout(() => {
    console.error(`⏱️  Forced exit after ${shutdownTimeout / 1000}s timeout`);
    process.exit(1);
  }, shutdownTimeout);
}

async function performShutdownCleanup() {
  try {
    console.log('🧹 Cleaning up resources...');
    
    // 1. Close database connections
    try {
      console.log('  • Draining database connections...');
      await pool.end();
      console.log('  ✅ Database connections closed');
    } catch (err) {
      console.error('  ❌ Error closing database:', err.message);
    }
    
    // 2. Close Redis connections (if used)
    try {
      const redis = await require("./services/security").getRedisClient();
      if (redis) {
        console.log('  • Closing Redis connection...');
        await redis.quit();
        console.log('  ✅ Redis connection closed');
      }
    } catch (err) {
      console.warn('  ⚠️  Redis not available:', err.message);
    }
    
    // 3. Flush pending audit logs
    try {
      console.log('  • Flushing audit logs...');
      const { appendAuditLog } = require("./services/fileAuditLogger");
      await appendAuditLog({
        action: 'server.shutdown',
        severity: 'INFO',
        signal: process.env.NODE_ENV === 'production' ? 'unknown' : signal
      });
      console.log('  ✅ Audit logs flushed');
    } catch (err) {
      console.warn('  ⚠️  Could not flush audit logs:', err.message);
    }
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
}

// Start the server
const server = app.listen(port, () => {
  console.log(`\n🚀 GhostDrop server running on port ${port}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: ${cleanEnv("DB_HOST", "127.0.0.1")}\n`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});

// Helper function from db.js
function cleanEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  return value.trim();
}
```

---

## Issue #4: Structured Logging Setup

**File: `backend/src/config/logger.js`** (NEW FILE)

```javascript
const pino = require("pino");

const isDev = String(process.env.NODE_ENV || "development").toLowerCase() !== "production";

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: { pid: process.pid, service: "ghostdrop" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.innerToken",
        "*.tokenHash",
        "*.secret",
        "req.headers.authorization",
        "req.headers['x-session-token']"
      ],
      censor: "[REDACTED]"
    }
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname,service"
        }
      })
    : pino.destination({ sync: false })
);

module.exports = logger;
```

**File: `backend/package.json`** (UPDATE - ADD to dependencies)

```json
{
  "dependencies": {
    // ... existing dependencies
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3"
  }
}
```

**Install:**
```bash
npm install winston
```

**Usage in routes:**
```javascript
const logger = require("../config/logger");

router.post("/login", async (req, res) => {
  try {
    const { outerToken, innerToken } = req.body;
    
    if (!outerToken || !validateInnerToken(innerToken)) {
      logger.warn('Login attempt with invalid credentials', {
        ip: getClientIp(req),
        outerToken: outerToken?.substring(0, 4) + '***'
      });
      return res.status(400).json({ error: "Invalid credentials" });
    }
    
    const vault = await resolveVaultByOuterToken(outerToken);
    const tokenRow = await verifyTokenForVault(vault.vault_id, innerToken);
    
    logger.info('User login successful', {
      vaultId: vault.vault_id,
      tokenType: tokenRow.token_type,
      ip: getClientIp(req)
    });
    
    // ... rest of login logic
    
  } catch (err) {
    logger.error('Login failed with exception', {
      error: err.message,
      stack: err.stack,
      ip: getClientIp(req)
    });
    res.status(500).json({ error: 'Login failed' });
  }
});
```

---

## Issue #5: Redis Integration for Sessions

**File: `backend/src/services/authSession.js`** (UPDATE)

```javascript
const { v4: uuidv4 } = require("uuid");
const logger = require("../config/logger");
const { getRemainingSeconds } = require("./vaultAccess");
const { query } = require("../config/db");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;  // 12 hours

let redisClient = null;
let useRedis = false;

// Initialize Redis connection if available
async function initRedis() {
  try {
    if (process.env.SECURITY_STORE !== "redis") {
      logger.info('Redis disabled (SECURITY_STORE != redis)');
      return;
    }
    
    const redis = require("redis");
    const url = String(process.env.REDIS_URL || "").trim();
    
    if (!url) {
      logger.warn('Redis URL not configured, using memory storage');
      return;
    }
    
    redisClient = redis.createClient({ url });
    redisClient.on("error", (err) => {
      logger.error('Redis connection error:', { error: err.message });
    });
    
    await redisClient.connect();
    useRedis = true;
    logger.info('✅ Redis connected for session storage');
    
  } catch (err) {
    logger.warn('Redis not available, falling back to memory', { 
      error: err.message 
    });
    useRedis = false;
  }
}

// In-memory fallback
const sessionsMem = new Map();

function sessionRole(tokenType) {
  return tokenType === "MAIN" ? "admin" : "user";
}

function pruneExpiredSessions() {
  const now = Date.now();
  const expired = [];
  
  for (const [token, session] of sessionsMem.entries()) {
    if (session.expiresAtMs <= now || session.lastSeenAt + SESSION_TTL_MS <= now) {
      sessionsMem.delete(token);
      expired.push(token);
    }
  }
  
  if (expired.length > 0) {
    logger.debug(`Pruned ${expired.length} expired sessions`);
  }
}

function createSession({ vault, tokenRow, outerToken }) {
  if (!useRedis) {
    pruneExpiredSessions();
  }
  
  const sessionToken = uuidv4();
  const expiresAtMs = new Date(vault.expires_at).getTime();
  
  const sessionData = {
    sessionToken,
    vaultId: vault.vault_id,
    outerToken,
    innerTokenId: tokenRow.inner_token_id,
    tokenType: tokenRow.token_type,
    role: sessionRole(tokenRow.token_type),
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAtMs
  };
  
  // Store in Redis or memory
  if (useRedis && redisClient) {
    const ttl = Math.ceil((expiresAtMs - Date.now()) / 1000);
    redisClient.setEx(
      `session:${sessionToken}`,
      Math.max(ttl, 3600),
      JSON.stringify(sessionData)
    ).catch(err => logger.error('Redis setEx error:', { error: err.message }));
  } else {
    sessionsMem.set(sessionToken, sessionData);
  }
  
  return {
    sessionToken,
    vaultId: vault.vault_id,
    outerToken,
    tokenType: tokenRow.token_type,
    role: sessionRole(tokenRow.token_type),
    expiresAt: vault.expires_at,
    remainingSeconds: getRemainingSeconds(vault.expires_at)
  };
}

async function getSession(sessionToken) {
  if (!sessionToken) return null;
  
  try {
    if (useRedis && redisClient) {
      const data = await redisClient.get(`session:${sessionToken}`);
      if (data) {
        const session = JSON.parse(data);
        session.lastSeenAt = Date.now();
        
        // Update last seen in Redis
        const ttl = Math.ceil((session.expiresAtMs - Date.now()) / 1000);
        if (ttl > 0) {
          redisClient.setEx(
            `session:${sessionToken}`,
            Math.max(ttl, 3600),
            JSON.stringify(session)
          ).catch(err => logger.error('Redis setEx error:', { error: err.message }));
        }
        
        return session;
      }
      return null;
    } else {
      pruneExpiredSessions();
      const session = sessionsMem.get(sessionToken);
      
      if (!session) return null;
      if (session.expiresAtMs <= Date.now()) {
        sessionsMem.delete(sessionToken);
        return null;
      }
      
      session.lastSeenAt = Date.now();
      return session;
    }
  } catch (err) {
    logger.error('Error retrieving session:', { error: err.message });
    return null;
  }
}

function invalidateSession(sessionToken) {
  if (!sessionToken) return;
  
  if (useRedis && redisClient) {
    redisClient.del(`session:${sessionToken}`)
      .catch(err => logger.error('Redis del error:', { error: err.message }));
  } else {
    sessionsMem.delete(sessionToken);
  }
}

async function validateSessionAgainstDb(sessionToken) {
  const session = await getSession(sessionToken);
  if (!session) return null;
  
  // ... rest of validation logic (unchanged)
}

// Export initialization function
module.exports = {
  initRedis,
  createSession,
  getSession,
  invalidateSession,
  validateSessionAgainstDb
};
```

**File: `backend/src/app.js`** (UPDATE - ADD AFTER validateEnvironment)

```javascript
// After validateEnvironment() call:
const { initRedis } = require("./services/authSession");

// Initialize Redis before starting server
(async () => {
  await initRedis().catch(err => {
    logger.warn('Redis initialization failed:', { error: err.message });
  });
  
  // Start the server...
  const server = app.listen(port, () => {
    console.log(`🚀 GhostDrop server running on port ${port}`);
  });
})();
```

---

## Installation Instructions

```bash
# Install required packages
npm install winston

# Install Redis CLI (optional, for debugging)
npm install redis

# For production, set environment variables:
export NODE_ENV=production
export DB_HOST=your-host.com
export DB_USER=your_user
export DB_PASSWORD=your_password
export SECURITY_STORE=redis
export REDIS_URL=redis://your-redis-host:6379

# Start with validation
npm start
```

---

## Testing

```bash
# Test 1: Environment Validation
# Remove .env and try to start
npm start
# Expected: Error about missing environment variables

# Test 2: Graceful Shutdown
npm start
# Wait 5 seconds, press Ctrl+C
# Expected: "Graceful shutdown initiated" message

# Test 3: Database SSL (if configured)
# Set DB_SSL_CA_PATH and try to connect
# Expected: Successful connection with SSL

# Test 4: Redis Integration
export SECURITY_STORE=redis
npm start
# Create a session and restart server
# Expected: Session persists after restart
```

---

**Status:** These fixes address Issues #1-5 (Critical)  
**Effort:** ~8-10 hours of implementation  
**Next:** Move to Major Issues after completing these
