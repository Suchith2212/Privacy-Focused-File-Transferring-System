const { v4: uuidv4 } = require("uuid");
const { ROUTE_RATE_LIMITS, ROUTE_RISK_POLICY } = require("../config/securityPolicies");

const MINUTE = 60 * 1000;
const TEN_MINUTES = 10 * MINUTE;
const HOUR = 60 * MINUTE;
const DAY = 24 * 60 * 60 * 1000;

const RATE_LIMIT_MINUTE = 10;
const RATE_LIMIT_DAY = 100;
const PRINCIPAL_RATE_LIMIT_MINUTE = 60;
const PRINCIPAL_RATE_LIMIT_DAY = 600;
const CAPTCHA_REQUIRED_FAILED_MINUTE = 8;
const CAPTCHA_REQUIRED_WEIGHT_10M = 10;
const BLOCK_FAILED_MINUTE = 20;
const BLOCK_WEIGHT_10M = 22;
const CAPTCHA_SOLVE_TTL_MS = 10 * MINUTE;
const CAPTCHA_CHALLENGE_TTL_MS = 5 * MINUTE;
const CAPTCHA_MAX_ATTEMPTS = 5;
const TEMP_BLOCK_BASE_MS = 15 * MINUTE;
const TEMP_BLOCK_MAX_MS = 24 * HOUR;
const BLOCK_STRIKE_WINDOW_MS = DAY;

const state = {
  windowCounters: new Map(),
  blockedUntil: new Map(),
  blockHistoryCount: new Map(),
  lastFailureReason: new Map(),
  captchaById: new Map(),
  captchaSolvedUntilByIp: new Map(),
  redisConnectFailed: false,
  redisClientPromise: null
};

function now() {
  return Date.now();
}

function mapCsvSet(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

const RISK_BAD_IPS = mapCsvSet(process.env.RISK_BAD_IPS);
const RISK_TOR_IPS = mapCsvSet(process.env.RISK_TOR_IPS);
const RISK_VPN_IPS = mapCsvSet(process.env.RISK_VPN_IPS);

function getCaptchaProvider() {
  const provider = String(process.env.CAPTCHA_PROVIDER || "math").trim().toLowerCase();
  if (provider === "hcaptcha" || provider === "recaptcha") return provider;
  return "math";
}

function shouldUseRedis() {
  return String(process.env.SECURITY_STORE || "memory").trim().toLowerCase() === "redis";
}

async function getRedisClient() {
  if (!shouldUseRedis() || state.redisConnectFailed) return null;
  if (!state.redisClientPromise) {
    state.redisClientPromise = (async () => {
      try {
        const redis = require("redis");
        const url = String(process.env.REDIS_URL || "").trim();
        if (!url) {
          state.redisConnectFailed = true;
          return null;
        }
        const client = redis.createClient({ url });
        client.on("error", () => {});
        await client.connect();
        return client;
      } catch (_err) {
        state.redisConnectFailed = true;
        return null;
      }
    })();
  }
  return state.redisClientPromise;
}

function counterKey(scope, key, windowMs) {
  return `${scope}:${key}:${Math.floor(now() / windowMs)}`;
}

function resetSecondsForWindow(windowMs) {
  const end = Math.floor(now() / windowMs) * windowMs + windowMs;
  return Math.max(1, Math.ceil((end - now()) / 1000));
}

async function getWindowCount(scope, key, windowMs) {
  const redis = await getRedisClient();
  const cKey = counterKey(scope, key, windowMs);
  if (redis) {
    const v = await redis.get(cKey);
    return Number(v || 0);
  }
  return Number(state.windowCounters.get(cKey) || 0);
}

async function incrWindow(scope, key, windowMs, amount = 1) {
  const redis = await getRedisClient();
  const cKey = counterKey(scope, key, windowMs);
  if (redis) {
    const n = await redis.incrBy(cKey, amount);
    await redis.expire(cKey, Math.ceil(windowMs / 1000) + 5, "NX").catch(() => {});
    return Number(n);
  }
  const next = Number(state.windowCounters.get(cKey) || 0) + amount;
  state.windowCounters.set(cKey, next);
  return next;
}

async function getValue(scope, key) {
  const redis = await getRedisClient();
  if (redis) {
    return redis.get(`${scope}:${key}`);
  }
  return state[scope]?.get ? state[scope].get(key) : null;
}

async function setValue(scope, key, value, ttlMs = 0) {
  const redis = await getRedisClient();
  if (redis) {
    const full = `${scope}:${key}`;
    if (ttlMs > 0) {
      await redis.set(full, String(value), { PX: Math.max(1, ttlMs) });
    } else {
      await redis.set(full, String(value));
    }
    return;
  }

  if (!state[scope] || !state[scope].set) return;
  state[scope].set(key, value);
  if (ttlMs > 0) {
    setTimeout(() => {
      state[scope].delete(key);
    }, Math.max(1, ttlMs)).unref?.();
  }
}

async function delValue(scope, key) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(`${scope}:${key}`);
    return;
  }
  if (state[scope] && state[scope].delete) {
    state[scope].delete(key);
  }
}

function parseJsonSafe(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function getCaptchaRecord(challengeId) {
  const redis = await getRedisClient();
  if (redis) {
    const raw = await redis.get(`captchaById:${challengeId}`);
    return parseJsonSafe(raw, null);
  }
  return state.captchaById.get(challengeId) || null;
}

async function setCaptchaRecord(challengeId, record, ttlMs) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.set(`captchaById:${challengeId}`, JSON.stringify(record), { PX: Math.max(1, ttlMs) });
    return;
  }
  state.captchaById.set(challengeId, record);
  setTimeout(() => {
    state.captchaById.delete(challengeId);
  }, Math.max(1, ttlMs)).unref?.();
}

async function deleteCaptchaRecord(challengeId) {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(`captchaById:${challengeId}`);
    return;
  }
  state.captchaById.delete(challengeId);
}

function queueResetSeconds(windowMs) {
  return resetSecondsForWindow(windowMs);
}

async function checkRateLimit(ip) {
  const minuteCount = await getWindowCount("authAttemptsMinute", ip, MINUTE);
  const dayCount = await getWindowCount("authAttemptsDay", ip, DAY);

  return {
    minuteCount,
    dayCount,
    minuteLimit: RATE_LIMIT_MINUTE,
    dayLimit: RATE_LIMIT_DAY,
    resetMinuteSeconds: queueResetSeconds(MINUTE),
    resetDaySeconds: queueResetSeconds(DAY),
    overMinute: minuteCount >= RATE_LIMIT_MINUTE,
    overDay: dayCount >= RATE_LIMIT_DAY
  };
}

async function checkPrincipalRateLimit(principalKey) {
  const minuteCount = await getWindowCount("principalAttemptsMinute", principalKey, MINUTE);
  const dayCount = await getWindowCount("principalAttemptsDay", principalKey, DAY);

  return {
    minuteCount,
    dayCount,
    minuteLimit: PRINCIPAL_RATE_LIMIT_MINUTE,
    dayLimit: PRINCIPAL_RATE_LIMIT_DAY,
    resetMinuteSeconds: queueResetSeconds(MINUTE),
    resetDaySeconds: queueResetSeconds(DAY),
    overMinute: minuteCount >= PRINCIPAL_RATE_LIMIT_MINUTE,
    overDay: dayCount >= PRINCIPAL_RATE_LIMIT_DAY
  };
}

function getRouteLimit(routeKey) {
  return ROUTE_RATE_LIMITS[routeKey] || ROUTE_RATE_LIMITS.default;
}

async function checkRouteRateLimit(routeKey, ip) {
  const limit = getRouteLimit(routeKey);
  const key = `${routeKey}:${ip}`;
  const minuteCount = await getWindowCount("routeAttemptsMinute", key, MINUTE);
  const dayCount = await getWindowCount("routeAttemptsDay", key, DAY);

  return {
    routeKey,
    minuteCount,
    dayCount,
    minuteLimit: limit.minute,
    dayLimit: limit.day,
    resetMinuteSeconds: queueResetSeconds(MINUTE),
    resetDaySeconds: queueResetSeconds(DAY),
    overMinute: minuteCount >= limit.minute,
    overDay: dayCount >= limit.day
  };
}

async function recordAttempt(ip) {
  await incrWindow("authAttemptsMinute", ip, MINUTE, 1);
  await incrWindow("authAttemptsDay", ip, DAY, 1);
}

async function recordPrincipalAttempt(principalKey) {
  await incrWindow("principalAttemptsMinute", principalKey, MINUTE, 1);
  await incrWindow("principalAttemptsDay", principalKey, DAY, 1);
}

async function recordRouteAttempt(routeKey, ip) {
  const key = `${routeKey}:${ip}`;
  await incrWindow("routeAttemptsMinute", key, MINUTE, 1);
  await incrWindow("routeAttemptsDay", key, DAY, 1);
}

async function imposeAdaptiveBlock(ip) {
  const strikes = await incrWindow("blockHistory", ip, BLOCK_STRIKE_WINDOW_MS, 1);
  const strikeCount = Math.max(1, Number(strikes));
  const blockMs = Math.min(
    TEMP_BLOCK_MAX_MS,
    TEMP_BLOCK_BASE_MS * Math.pow(2, Math.max(0, strikeCount - 1))
  );

  const existing = Number((await getValue("blockedUntil", ip)) || 0);
  const until = Math.max(existing, now() + blockMs);
  await setValue("blockedUntil", ip, until, blockMs + HOUR);

  return {
    strikeCount,
    blockSeconds: Math.ceil(blockMs / 1000)
  };
}

async function failureWeight10m(ip) {
  return getWindowCount("failedWeighted", ip, TEN_MINUTES);
}

async function recordFailure(ip, options = {}) {
  const {
    weight = 1,
    reason = "GENERIC_FAILURE"
  } = options;

  const minuteFailures = await incrWindow("failedMinute", ip, MINUTE, 1);
  await incrWindow("failedWeighted", ip, TEN_MINUTES, Math.max(1, Number(weight) || 1));
  const weighted = await failureWeight10m(ip);

  await setValue("lastFailureReason", ip, reason, DAY);

  if (minuteFailures >= BLOCK_FAILED_MINUTE || weighted >= BLOCK_WEIGHT_10M) {
    return {
      blocked: true,
      ...(await imposeAdaptiveBlock(ip))
    };
  }

  return {
    blocked: false,
    strikeCount: Number((await getWindowCount("blockHistory", ip, BLOCK_STRIKE_WINDOW_MS)) || 0),
    blockSeconds: 0
  };
}

async function clearFailure(ip) {
  // Current-window counters are enough to clear active pressure; older windows expire naturally.
  await delValue("lastFailureReason", ip);
}

async function isBlocked(ip) {
  const until = Number((await getValue("blockedUntil", ip)) || 0);
  if (until <= now()) {
    await delValue("blockedUntil", ip);
    return false;
  }
  return true;
}

async function blockedRemainingSeconds(ip) {
  const until = Number((await getValue("blockedUntil", ip)) || 0);
  return Math.max(0, Math.floor((until - now()) / 1000));
}

async function isCaptchaSolved(ip) {
  const until = Number((await getValue("captchaSolvedUntilByIp", ip)) || 0);
  if (until <= now()) {
    await delValue("captchaSolvedUntilByIp", ip);
    return false;
  }
  return true;
}

async function shouldRequireCaptcha(ip) {
  const minuteFailures = await getWindowCount("failedMinute", ip, MINUTE);
  const weighted10m = await failureWeight10m(ip);
  return minuteFailures >= CAPTCHA_REQUIRED_FAILED_MINUTE || weighted10m >= CAPTCHA_REQUIRED_WEIGHT_10M;
}

function createHumanChallenge() {
  const operationPick = Math.random();
  const a = Math.floor(Math.random() * 12) + 1;
  const b = Math.floor(Math.random() * 12) + 1;

  if (operationPick < 0.45) {
    return { question: `${a} + ${b} = ?`, answer: String(a + b) };
  }

  if (operationPick < 0.9) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return { question: `${max} - ${min} = ?`, answer: String(max - min) };
  }

  return { question: `${a} * ${b} = ?`, answer: String(a * b) };
}

function getCaptchaPublicConfig() {
  const provider = getCaptchaProvider();
  if (provider === "hcaptcha") {
    return {
      provider,
      siteKey: String(process.env.HCAPTCHA_SITE_KEY || "").trim()
    };
  }
  if (provider === "recaptcha") {
    return {
      provider,
      siteKey: String(process.env.RECAPTCHA_SITE_KEY || "").trim()
    };
  }
  return {
    provider: "math",
    siteKey: ""
  };
}

async function createCaptcha(ip) {
  const providerConfig = getCaptchaPublicConfig();
  if (providerConfig.provider !== "math" && providerConfig.siteKey) {
    return {
      captchaProvider: providerConfig.provider,
      siteKey: providerConfig.siteKey,
      expiresInSeconds: Math.floor(CAPTCHA_CHALLENGE_TTL_MS / 1000)
    };
  }

  const challengeId = uuidv4();
  const challenge = createHumanChallenge();

  await setCaptchaRecord(
    challengeId,
    {
      ip,
      answer: challenge.answer,
      attempts: 0,
      maxAttempts: CAPTCHA_MAX_ATTEMPTS,
      expiresAt: now() + CAPTCHA_CHALLENGE_TTL_MS
    },
    CAPTCHA_CHALLENGE_TTL_MS
  );

  return {
    captchaProvider: "math",
    challengeId,
    question: challenge.question,
    expiresInSeconds: Math.floor(CAPTCHA_CHALLENGE_TTL_MS / 1000),
    maxAttempts: CAPTCHA_MAX_ATTEMPTS
  };
}

async function verifyCaptchaProviderToken(provider, providerToken, ip) {
  if (!providerToken) return { ok: false, reason: "Captcha token missing." };

  if (provider === "hcaptcha") {
    const secret = String(process.env.HCAPTCHA_SECRET_KEY || "").trim();
    if (!secret) return { ok: false, reason: "Captcha server secret is not configured." };

    const body = new URLSearchParams({
      secret,
      response: String(providerToken),
      remoteip: String(ip || "")
    });

    const res = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }).catch(() => null);

    if (!res) return { ok: false, reason: "Captcha verification service unreachable." };
    const data = await res.json().catch(() => ({}));
    if (data.success) return { ok: true };
    return { ok: false, reason: "Captcha verification failed." };
  }

  if (provider === "recaptcha") {
    const secret = String(process.env.RECAPTCHA_SECRET_KEY || "").trim();
    if (!secret) return { ok: false, reason: "Captcha server secret is not configured." };

    const body = new URLSearchParams({
      secret,
      response: String(providerToken),
      remoteip: String(ip || "")
    });

    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }).catch(() => null);

    if (!res) return { ok: false, reason: "Captcha verification service unreachable." };
    const data = await res.json().catch(() => ({}));
    if (data.success) return { ok: true };
    return { ok: false, reason: "Captcha verification failed." };
  }

  return { ok: false, reason: "Unsupported captcha provider." };
}

async function verifyCaptcha({ ip, challengeId, answer, providerToken }) {
  const provider = getCaptchaProvider();
  const allowMathFallback = String(process.env.CAPTCHA_ALLOW_MATH_FALLBACK || "true").toLowerCase() !== "false";

  if ((provider === "hcaptcha" || provider === "recaptcha") && providerToken) {
    const out = await verifyCaptchaProviderToken(provider, providerToken, ip);
    if (!out.ok) {
      await recordFailure(ip, { weight: 2, reason: "CAPTCHA_PROVIDER_INVALID" });
      return out;
    }

    await setValue("captchaSolvedUntilByIp", ip, now() + CAPTCHA_SOLVE_TTL_MS, CAPTCHA_SOLVE_TTL_MS);
    await clearFailure(ip);
    return { ok: true };
  }

  if ((provider === "hcaptcha" || provider === "recaptcha") && !allowMathFallback) {
    return { ok: false, reason: "Captcha provider token is required." };
  }

  const record = await getCaptchaRecord(challengeId);
  if (!record) return { ok: false, reason: "Invalid challenge." };
  if (record.ip !== ip) return { ok: false, reason: "Challenge-IP mismatch." };

  if (record.expiresAt < now()) {
    await deleteCaptchaRecord(challengeId);
    return { ok: false, reason: "Challenge expired." };
  }

  record.attempts += 1;
  if (record.answer !== String(answer || "").trim()) {
    const remaining = Math.max(0, record.maxAttempts - record.attempts);

    if (remaining <= 0) {
      await deleteCaptchaRecord(challengeId);
      await recordFailure(ip, { weight: 4, reason: "CAPTCHA_MAX_ATTEMPTS" });
      return {
        ok: false,
        reason: "Too many captcha attempts. Request a new challenge.",
        retryAfterSeconds: 2
      };
    }

    await setCaptchaRecord(challengeId, record, Math.max(500, record.expiresAt - now()));
    await recordFailure(ip, { weight: 2, reason: "CAPTCHA_INVALID" });
    return {
      ok: false,
      reason: `Wrong captcha answer. ${remaining} attempts left.`
    };
  }

  await deleteCaptchaRecord(challengeId);
  await setValue("captchaSolvedUntilByIp", ip, now() + CAPTCHA_SOLVE_TTL_MS, CAPTCHA_SOLVE_TTL_MS);
  await clearFailure(ip);
  return { ok: true };
}

function getRouteRiskPolicy(routeKey) {
  return ROUTE_RISK_POLICY[routeKey] || ROUTE_RISK_POLICY.default;
}

function getIpRiskScore(ip) {
  let score = 0;
  const reasons = [];

  if (RISK_BAD_IPS.has(ip)) {
    score += 95;
    reasons.push("KNOWN_BAD_IP");
  }
  if (RISK_TOR_IPS.has(ip)) {
    score += 60;
    reasons.push("TOR_EXIT");
  }
  if (RISK_VPN_IPS.has(ip)) {
    score += 40;
    reasons.push("VPN_OR_DATACENTER");
  }

  return {
    score: Math.min(100, score),
    reasons
  };
}

async function evaluateIpRisk({ routeKey = "default", ip, captchaSolved = false }) {
  const risk = getIpRiskScore(ip);
  const policy = getRouteRiskPolicy(routeKey);

  if (risk.score >= policy.blockThreshold) {
    return {
      blocked: true,
      requireCaptcha: true,
      risk
    };
  }

  if (risk.score >= policy.captchaThreshold && !captchaSolved) {
    return {
      blocked: false,
      requireCaptcha: true,
      risk
    };
  }

  return {
    blocked: false,
    requireCaptcha: false,
    risk
  };
}

async function getSecurityStatus(ip) {
  const rate = await checkRateLimit(ip);
  const failureCountMinute = await getWindowCount("failedMinute", ip, MINUTE);
  const failureWeight10m = await failureWeight10m(ip);

  const blocked = await isBlocked(ip);
  const captchaSolved = await isCaptchaSolved(ip);
  const captchaRequired = (await shouldRequireCaptcha(ip)) && !captchaSolved;

  return {
    blocked,
    blockedSeconds: blocked ? await blockedRemainingSeconds(ip) : 0,
    captchaRequired,
    captchaSolved,
    failureCountMinute,
    failureWeight10m,
    lastFailureReason: (await getValue("lastFailureReason", ip)) || null,
    rate,
    captchaProvider: getCaptchaPublicConfig().provider,
    risk: getIpRiskScore(ip)
  };
}

async function inspectSecurityCounters({
  ip = "",
  routeKey = "default",
  principalKey = "",
  includePolicies = true
} = {}) {
  const redis = await getRedisClient();

  const diagnostics = {
    timestamp: new Date().toISOString(),
    store: {
      mode: shouldUseRedis() ? "redis" : "memory",
      redisConnected: Boolean(redis)
    },
    captchaProvider: getCaptchaPublicConfig().provider,
    routeKey,
    hasIp: Boolean(ip),
    hasPrincipalKey: Boolean(principalKey),
    memorySummary: {
      windowCounters: state.windowCounters.size,
      blockedUntil: state.blockedUntil.size,
      captchaById: state.captchaById.size,
      captchaSolvedUntilByIp: state.captchaSolvedUntilByIp.size
    }
  };

  if (includePolicies) {
    diagnostics.policies = {
      routeRateLimits: ROUTE_RATE_LIMITS,
      routeRiskPolicy: ROUTE_RISK_POLICY
    };
  }

  if (ip) {
    diagnostics.ip = {
      ip,
      status: await getSecurityStatus(ip),
      routeRate: await checkRouteRateLimit(routeKey, ip)
    };
  }

  if (principalKey) {
    diagnostics.principal = {
      principalKey,
      rate: await checkPrincipalRateLimit(principalKey)
    };
  }

  if (redis) {
    const patterns = [
      "authAttemptsMinute:*",
      "authAttemptsDay:*",
      "routeAttemptsMinute:*",
      "routeAttemptsDay:*",
      "principalAttemptsMinute:*",
      "principalAttemptsDay:*",
      "failedMinute:*",
      "failedWeighted:*",
      "blockedUntil:*",
      "captchaById:*"
    ];

    const counts = {};
    for (const pattern of patterns) {
      let total = 0;
      let cursor = "0";
      do {
        // eslint-disable-next-line no-await-in-loop
        const out = await redis.scan(cursor, { MATCH: pattern, COUNT: 200 });
        cursor = String(out.cursor || "0");
        total += Array.isArray(out.keys) ? out.keys.length : 0;
      } while (cursor !== "0");
      counts[pattern] = total;
    }
    diagnostics.redisKeyCounts = counts;
  }

  return diagnostics;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  const trustProxy = typeof req.app?.get === "function" ? req.app.get("trust proxy") : false;
  if (trustProxy && typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

module.exports = {
  checkRateLimit,
  checkPrincipalRateLimit,
  checkRouteRateLimit,
  recordAttempt,
  recordRouteAttempt,
  recordPrincipalAttempt,
  recordFailure,
  clearFailure,
  isBlocked,
  blockedRemainingSeconds,
  shouldRequireCaptcha,
  createCaptcha,
  verifyCaptcha,
  isCaptchaSolved,
  getClientIp,
  getSecurityStatus,
  getCaptchaPublicConfig,
  getIpRiskScore,
  evaluateIpRisk,
  inspectSecurityCounters
};
