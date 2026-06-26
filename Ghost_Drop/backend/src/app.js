require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { query } = require("./config/db");
const logger = require("./config/logger");
const { validateEnvironment } = require("./config/validateEnv");
const { appendAuditLog } = require("./services/fileAuditLogger");
const { assertSecurityStoreSafe, getSecurityStoreHealth } = require("./services/security");
const { assertTokenLookupSecretSafe } = require("./services/crypto");
const { assertIntegritySecretSafe, findAllTamperedEntries } = require("./services/portfolioIntegrity");
const { ensurePerformanceIndexes } = require("./services/schemaOptimization");
const { startCleanupTimer } = require("./services/vaultCleanup");
const vaultRoutes = require("./routes/vaults");
const fileRoutes = require("./routes/files");
const securityRoutes = require("./routes/security");
const authRoutes = require("./routes/auth");
const moduleBRoutes = require("./routes/moduleB");
const portfolioRoutes = require("./routes/portfolio");

// ─── Startup validation ────────────────────────────────────────────────────────
validateEnvironment();
assertIntegritySecretSafe();
assertTokenLookupSecretSafe();

const app = express();
const port = Number(process.env.PORT || 4000);
const integrityScanIntervalMs = Number(process.env.PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS || 0);
let integrityScanTimer = null;
let cleanupTimer = null;
let server = null;

const allowedCorsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// ─── Security headers (Helmet) ────────────────────────────────────────────────
// Applied before all routes
const captchaProvider = String(process.env.CAPTCHA_PROVIDER || "math").trim().toLowerCase();
const captchaScriptSrc = [];
const captchaFrameSrc = ["'none'"];
if (captchaProvider === "hcaptcha") {
  captchaScriptSrc.push("https://js.hcaptcha.com", "https://newassets.hcaptcha.com");
  captchaFrameSrc.length = 0;
  captchaFrameSrc.push("https://newassets.hcaptcha.com");
} else if (captchaProvider === "recaptcha") {
  captchaScriptSrc.push("https://www.google.com", "https://www.gstatic.com");
  captchaFrameSrc.length = 0;
  captchaFrameSrc.push("https://www.google.com");
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://unpkg.com",
          ...captchaScriptSrc
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        frameSrc: captchaFrameSrc,
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    // Bug Gap 1: Only enable HSTS in production to prevent browser-caching dev as HTTPS
    hsts: process.env.NODE_ENV === "production" ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" }
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
if (allowedCorsOrigins.length > 0) {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedCorsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Session-Token", "X-Request-ID"],
      exposedHeaders: ["Retry-After", "X-Request-ID"]
    })
  );
}

// ─── Body parsing (with size limits to prevent JSON DoS) ─────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// ─── Proxy trust ──────────────────────────────────────────────────────────────
app.set("trust proxy", process.env.TRUST_PROXY === "true");

// ─── Request tracing ─────────────────────────────────────────────────────────
// Attaches a unique X-Request-ID to every request for log correlation
app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || uuidv4();
  req.requestId = requestId;
  res.set("X-Request-ID", requestId);
  next();
});

// ─── Request logging ─────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug(
    { requestId: req.requestId, method: req.method, url: req.url },
    "Incoming request"
  );
  next();
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/module-b", moduleBRoutes);
app.use("/api/vaults", vaultRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/security", securityRoutes);

// ─── Health & readiness ───────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    return res.json({ status: "ok", requestId: req.requestId });
  } catch (err) {
    const exposeDetails = String(process.env.NODE_ENV || "development") !== "production";
    logger.error({ requestId: req.requestId, err }, "Health check failed");
    return res.status(500).json({
      status: "error",
      error: "Database health check failed.",
      requestId: req.requestId,
      ...(exposeDetails && err.message ? { detail: err.message } : {})
    });
  }
});

app.get("/api/ready", async (req, res) => {
  try {
    await query("SELECT 1");
    const securityStore = await getSecurityStoreHealth();
    const ready = securityStore.mode !== "redis" || securityStore.redisConnected;
    if (!ready) {
      return res.status(503).json({
        status: "not_ready",
        database: "ok",
        securityStore,
        requestId: req.requestId
      });
    }
    return res.json({
      status: "ready",
      database: "ok",
      securityStore,
      requestId: req.requestId
    });
  } catch (err) {
    logger.error({ requestId: req.requestId, err }, "Readiness check failed");
    return res.status(503).json({
      status: "not_ready",
      error: "Readiness check failed.",
      requestId: req.requestId,
      ...(err.message ? { detail: err.message } : {})
    });
  }
});

// ─── Static frontend ──────────────────────────────────────────────────────────
const frontendPath = path.resolve(__dirname, "../../frontend");
app.use(
  express.static(frontendPath, {
    // 1 hour cache for JS/CSS, 1 day for fonts/images
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if ([".js", ".css"].includes(ext)) {
        res.set("Cache-Control", "public, max-age=3600");
      } else if ([".woff", ".woff2", ".ttf", ".png", ".jpg", ".svg"].includes(ext)) {
        res.set("Cache-Control", "public, max-age=86400");
      }
    }
  })
);

// SPA fallback — serve index.html for all unmatched routes
app.get("*", (req, res) => {
  return res.sendFile(path.join(frontendPath, "index.html"));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "File too large. Reduce file size and try again.",
        code: err.code,
        requestId: req.requestId
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(413).json({
        error: "Too many files in one upload.",
        code: err.code,
        requestId: req.requestId
      });
    }
    return res.status(400).json({ error: err.message, code: err.code, requestId: req.requestId });
  }

  if (err) {
    const exposeDetails = String(process.env.NODE_ENV || "development") !== "production";
    logger.error({ requestId: req.requestId, err }, "Unhandled server error");
    return res.status(500).json({
      error: "Unexpected server error.",
      requestId: req.requestId,
      ...(exposeDetails && err.message ? { detail: err.message } : {})
    });
  }
  return next();
});

// ─── Background integrity scan ────────────────────────────────────────────────
async function runIntegrityBackgroundScan() {
  const tamperedEntries = await findAllTamperedEntries();
  if (tamperedEntries.length === 0) return;

  logger.warn({ count: tamperedEntries.length }, "Tampered portfolio entries detected");
  for (const entry of tamperedEntries) {
    await appendAuditLog({
      severity: "CRITICAL",
      action: "portfolio.background_scan.tampered",
      vaultId: entry.vaultId,
      entryId: entry.entryId,
      ownerTokenId: entry.ownerTokenId
    }).catch(() => {});
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info({ signal }, "Graceful shutdown initiated");

  if (integrityScanTimer) {
    clearInterval(integrityScanTimer);
    integrityScanTimer = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  if (!server) {
    process.exit(0);
    return;
  }

  await new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 10_000).unref?.();
  }).catch(() => {});

  logger.info("Server closed — exiting");
  process.exit(0);
}

// ─── Server startup ───────────────────────────────────────────────────────────
async function startServer() {
  await assertSecurityStoreSafe();
  await ensurePerformanceIndexes().catch(() => {});

  server = app.listen(port, () => {
    logger.info({ port, env: process.env.NODE_ENV || "development" }, `GhostDrop server running`);
    if (integrityScanIntervalMs > 0) {
      integrityScanTimer = setInterval(() => {
        runIntegrityBackgroundScan().catch(() => {});
      }, integrityScanIntervalMs);
    }
    // Start background vault cleanup service
    cleanupTimer = startCleanupTimer();
  });

  // Handle server-level errors (e.g. EADDRINUSE)
  server.on("error", (err) => {
    logger.error({ err }, "Server error");
    process.exit(1);
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

// Catch unhandled promise rejections — log and exit in production
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  if (String(process.env.NODE_ENV || "development") === "production") {
    process.exit(1);
  }
});
