require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { query } = require("./config/db");
const { appendAuditLog } = require("./services/fileAuditLogger");
const {
  assertIntegritySecretSafe,
  findAllTamperedEntries
} = require("./services/portfolioIntegrity");
const { ensurePerformanceIndexes } = require("./services/schemaOptimization");
const vaultRoutes = require("./routes/vaults");
const fileRoutes = require("./routes/files");
const securityRoutes = require("./routes/security");
const authRoutes = require("./routes/auth");
const moduleBRoutes = require("./routes/moduleB");
const portfolioRoutes = require("./routes/portfolio");

const app = express();
const port = Number(process.env.PORT || 4000);
const integrityScanIntervalMs = Number(process.env.PORTFOLIO_INTEGRITY_SCAN_INTERVAL_MS || 0);

assertIntegritySecretSafe();
ensurePerformanceIndexes().catch(() => {});

app.use(cors());  // Enable Cross-Origin Resource Sharing for all routes 
app.use(express.json());

app.set("trust proxy", process.env.TRUST_PROXY === "true");

app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/module-b", moduleBRoutes);
app.use("/api/vaults", vaultRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/security", securityRoutes);

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    return res.json({ status: "ok" });
  } catch (err) {
    const exposeDetails = String(process.env.NODE_ENV || "development") !== "production";
    return res.status(500).json({
      status: "error",
      error: "Database health check failed.",
      ...(exposeDetails && err.message ? { detail: err.message } : {})
    });
  }
});

const frontendPath = path.resolve(__dirname, "../../frontend");
app.use(express.static(frontendPath));

app.get("*", (req, res) => {
  return res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "File too large. Reduce file size and try again.",
        code: err.code
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(413).json({
        error: "Too many files in one upload.",
        code: err.code
      });
    }
    return res.status(400).json({ error: err.message, code: err.code });
  }

  if (err) {
    const exposeDetails = String(process.env.NODE_ENV || "development") !== "production";
    return res.status(500).json({
      error: "Unexpected server error.",
      ...(exposeDetails && err.message ? { detail: err.message } : {})
    });
  }
  return next();
});

async function runIntegrityBackgroundScan() {
  const tamperedEntries = await findAllTamperedEntries();
  if (tamperedEntries.length === 0) return;

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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`GhostDrop prototype server running at http://localhost:${port}`);
  if (integrityScanIntervalMs > 0) {
    setInterval(() => {
      runIntegrityBackgroundScan().catch(() => {});
    }, integrityScanIntervalMs);
  }
});
