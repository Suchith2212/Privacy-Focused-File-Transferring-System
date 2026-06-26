/**
 * Shared security gate middleware — extracted from routes/files.js and routes/vaults.js.
 * Centralises IP blocking, risk evaluation, CAPTCHA handling, and rate limiting.
 *
 * Usage:
 *   const securityGate = require("../middleware/securityGate");
 *   router.post("/some-route", securityGate("vault.access"), async (req, res) => { ... });
 */
const {
  checkRateLimit,
  checkRouteRateLimit,
  recordAttempt,
  recordFailure,
  recordRouteAttempt,
  clearFailure,
  isBlocked,
  blockedRemainingSeconds,
  shouldRequireCaptcha,
  verifyCaptcha,
  isCaptchaSolved,
  getClientIp,
  evaluateIpRisk
} = require("../services/security");

function securityErrorPayload(message, extra = {}) {
  return { error: message, ...extra };
}

/**
 * Returns an Express middleware function that performs the full security gate
 * check for a given routeKey.
 *
 * Attaches `req.securityContext = { ok: true, ip, risk }` on success.
 * Sends the appropriate 4xx/429 response and terminates the chain on failure.
 *
 * @param {string} routeKey — e.g. "vault.access", "files.new-vault-upload"
 */
function securityGate(routeKey = "default") {
  return async function securityGateMiddleware(req, res, next) {
    const ip = getClientIp(req);
    let captchaSolved = await isCaptchaSolved(ip);

    // 1. Temporary block check
    if (await isBlocked(ip)) {
      const blockedSeconds = await blockedRemainingSeconds(ip);
      if (blockedSeconds > 0) res.set("Retry-After", String(blockedSeconds));
      return res.status(429).json(
        securityErrorPayload("Temporarily blocked due to repeated failures.", {
          code: "TEMP_BLOCK",
          blockedSeconds,
          captchaRequired: true
        })
      );
    }

    // 2. IP risk evaluation
    const risk = await evaluateIpRisk({ routeKey, ip, captchaSolved });
    if (risk.blocked) {
      return res.status(403).json(
        securityErrorPayload("Request blocked by risk policy.", {
          code: "RISK_BLOCK",
          captchaRequired: true,
          riskScore: risk.risk.score,
          riskSignals: risk.risk.reasons
        })
      );
    }

    // 3. CAPTCHA gate
    const captchaNeededByFailures = await shouldRequireCaptcha(ip);
    if ((captchaNeededByFailures || risk.requireCaptcha) && !captchaSolved) {
      const challengeId = req.body?.captchaChallengeId || req.query?.captchaChallengeId;
      const captchaAnswer = req.body?.captchaAnswer || req.query?.captchaAnswer;
      const providerToken = req.body?.providerToken || req.body?.captchaToken || req.query?.captchaToken;

      if ((!challengeId || !captchaAnswer) && !providerToken) {
        return res.status(403).json(
          securityErrorPayload("Captcha required.", {
            code: "CAPTCHA_REQUIRED",
            captchaRequired: true,
            riskScore: risk.risk.score,
            riskSignals: risk.risk.reasons
          })
        );
      }

      const out = await verifyCaptcha({ ip, challengeId, answer: captchaAnswer, providerToken });
      if (!out.ok) {
        return res.status(403).json(
          securityErrorPayload(out.reason, {
            code: "CAPTCHA_INVALID",
            captchaRequired: true,
            retryAfterSeconds: out.retryAfterSeconds || 0
          })
        );
      }
      captchaSolved = true;
    }

    // 4. Rate limiting
    await recordAttempt(ip);
    await recordRouteAttempt(routeKey, ip);
    const rate = await checkRateLimit(ip);
    const routeRate = await checkRouteRateLimit(routeKey, ip);

    if ((rate.overMinute || rate.overDay || routeRate.overMinute || routeRate.overDay) && !captchaSolved) {
      const retryAfter = Math.max(
        rate.resetMinuteSeconds,
        rate.resetDaySeconds,
        routeRate.resetMinuteSeconds,
        routeRate.resetDaySeconds,
        1
      );
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json(
        securityErrorPayload("Rate limit exceeded.", {
          code: routeRate.overMinute || routeRate.overDay ? "ROUTE_RATE_LIMIT" : "RATE_LIMIT",
          minuteCount: rate.minuteCount,
          dayCount: rate.dayCount,
          minuteLimit: rate.minuteLimit,
          dayLimit: rate.dayLimit,
          routeMinuteCount: routeRate.minuteCount,
          routeDayCount: routeRate.dayCount,
          routeMinuteLimit: routeRate.minuteLimit,
          routeDayLimit: routeRate.dayLimit,
          retryAfterSeconds: retryAfter,
          captchaRequired: true
        })
      );
    }

    // Attach context for route handlers
    req.securityContext = { ok: true, ip, risk, captchaSolved };
    return next();
  };
}

// Expose helpers for route handlers that need them after the gate passes
securityGate.recordFailure = recordFailure;
securityGate.clearFailure = clearFailure;
securityGate.shouldRequireCaptcha = shouldRequireCaptcha;
securityGate.isCaptchaSolved = isCaptchaSolved;

module.exports = securityGate;
