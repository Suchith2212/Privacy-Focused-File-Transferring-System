const express = require("express");
const {
  createCaptcha,
  verifyCaptcha,
  getClientIp,
  shouldRequireCaptcha,
  getSecurityStatus
} = require("../services/security");
const { upsertCaptchaTracking } = require("../services/auditService");
const { requireAdmin } = require("../middleware/authSession");
const { ensurePortfolioSchema, findTamperedEntries } = require("../services/portfolioIntegrity");
const { appendAuditLog } = require("../services/fileAuditLogger");

const router = express.Router();

router.get("/captcha", (req, res) => {
  const ip = getClientIp(req);
  const challenge = createCaptcha(ip);
  upsertCaptchaTracking({ req, required: true, incrementAttempts: false }).catch(() => {});
  return res.json({
    captchaRequired: true,
    ...challenge
  });
});

router.post("/captcha/verify", (req, res) => {
  const ip = getClientIp(req);
  const { challengeId, answer } = req.body || {};
  const out = verifyCaptcha({ ip, challengeId, answer });
  if (!out.ok) {
    if (out.retryAfterSeconds) {
      res.set("Retry-After", String(out.retryAfterSeconds));
    }
    upsertCaptchaTracking({ req, required: true, incrementAttempts: true }).catch(() => {});
    return res.status(400).json({
      error: out.reason,
      retryAfterSeconds: out.retryAfterSeconds || 0
    });
  }
  upsertCaptchaTracking({ req, required: false, incrementAttempts: false }).catch(() => {});
  return res.json({ message: "Captcha verified." });
});

router.get("/captcha/required", (req, res) => {
  const ip = getClientIp(req);
  const required = shouldRequireCaptcha(ip);
  upsertCaptchaTracking({ req, required, incrementAttempts: false }).catch(() => {});
  return res.json({ captchaRequired: required });
});

router.get("/status", (req, res) => {
  const ip = getClientIp(req);
  const status = getSecurityStatus(ip);
  if (status.blocked && status.blockedSeconds > 0) {
    res.set("Retry-After", String(status.blockedSeconds));
  }
  return res.json(status);
});

router.get("/unauthorized-check", requireAdmin, async (req, res) => {
  try {
    await ensurePortfolioSchema();
    const tamperedEntries = await findTamperedEntries(req.authSession.vaultId);
    await appendAuditLog({
      req,
      action: "security.unauthorized-check",
      vaultId: req.authSession.vaultId,
      actorTokenId: req.authSession.innerTokenId,
      tamperedCount: tamperedEntries.length,
      severity: tamperedEntries.length > 0 ? "CRITICAL" : "INFO"
    }).catch(() => {});
    return res.json({
      ok: tamperedEntries.length === 0,
      tamperedCount: tamperedEntries.length,
      tamperedEntries
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unauthorized modification check failed." });
  }
});

module.exports = router;
