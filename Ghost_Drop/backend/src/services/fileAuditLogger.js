const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureSession } = require("./auditService");
const { getClientIp } = require("./security");

const logDir = path.resolve(__dirname, "../../logs");
const logFile = path.join(logDir, "audit.log");
const MAX_ACTIVE_LOG_ENTRIES = Number(process.env.AUDIT_LOG_BLOCK_SIZE || 1000);

let cachedLastEntryHash = null;
let cachedActiveEntryCount = null;
let appendChain = Promise.resolve();

function hashLogPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function readLastEntryHash() {
  if (cachedLastEntryHash !== null) return cachedLastEntryHash;

  try {
    const text = await fs.promises.readFile(logFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    cachedActiveEntryCount = lines.length;
    if (lines.length === 0) {
      cachedLastEntryHash = "GENESIS";
      return cachedLastEntryHash;
    }
    const last = JSON.parse(lines[lines.length - 1]);
    cachedLastEntryHash = last.entryHash || "GENESIS";
    return cachedLastEntryHash;
  } catch (err) {
    if (err.code === "ENOENT") {
      cachedLastEntryHash = "GENESIS";
      cachedActiveEntryCount = 0;
      return cachedLastEntryHash;
    }
    throw err;
  }
}

async function readActiveEntryCount() {
  if (cachedActiveEntryCount !== null) return cachedActiveEntryCount;
  await readLastEntryHash();
  return cachedActiveEntryCount || 0;
}

async function nextSealedBlockPath() {
  const entries = await fs.promises.readdir(logDir, { withFileTypes: true }).catch((err) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const existingNumbers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(/^audit_block_(\d+)\.log\.sealed$/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return path.join(logDir, `audit_block_${nextNumber}.log.sealed`);
}

async function rotateAuditLogIfNeeded() {
  const activeEntryCount = await readActiveEntryCount();
  if (activeEntryCount < MAX_ACTIVE_LOG_ENTRIES) return;

  const currentFinalHash = await readLastEntryHash();
  const sealedPath = await nextSealedBlockPath();
  await fs.promises.rename(logFile, sealedPath);
  cachedLastEntryHash = currentFinalHash;
  cachedActiveEntryCount = 0;
}

async function buildAuditPayload(entry) {
  const out = { ...entry };
  const req = out.req;
  delete out.req;

  const sessionId =
    out.sessionId ||
    (req ? await ensureSession(req).catch(() => null) : null);

  const payload = {
    ts: new Date().toISOString(),
    severity: out.severity || "INFO",
    sessionId,
    ipAddress: out.ipAddress || (req ? getClientIp(req) : null),
    userAgent: out.userAgent || (req ? String(req.headers["user-agent"] || "unknown") : null),
    ...out
  };

  delete payload.severity;
  payload.severity = out.severity || "INFO";
  return payload;
}

async function appendAuditLog(entry) {
  appendChain = appendChain.then(async () => {
    await fs.promises.mkdir(logDir, { recursive: true });
    await rotateAuditLogIfNeeded();
    const payload = await buildAuditPayload(entry);
    const previousHash = await readLastEntryHash();
    payload.previousHash = previousHash;
    payload.entryHash = hashLogPayload(payload);
    cachedLastEntryHash = payload.entryHash;
    cachedActiveEntryCount = (cachedActiveEntryCount || 0) + 1;
    await fs.promises.appendFile(logFile, `${JSON.stringify(payload)}\n`, "utf8");
  });
  return appendChain;
}

async function getAuditSummary() {
  try {
    const text = await fs.promises.readFile(logFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    let previousHash = "GENESIS";
    let hashChainValid = true;

    for (const line of lines) {
      const parsed = JSON.parse(line);
      if ((parsed.previousHash || "GENESIS") !== previousHash) {
        hashChainValid = false;
        break;
      }
      previousHash = parsed.entryHash || previousHash;
    }

    return {
      totalEvents: lines.length,
      hashChainValid
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        totalEvents: 0,
        hashChainValid: true
      };
    }
    throw err;
  }
}

module.exports = {
  appendAuditLog,
  auditLogPath: logFile,
  getAuditSummary
};
