const { v4: uuidv4 } = require("uuid");

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
  authAttemptsMinute: new Map(),
  authAttemptsDay: new Map(),
  principalAttemptsMinute: new Map(),
  principalAttemptsDay: new Map(),
  failedMinute: new Map(),
  failedWeighted: new Map(),
  blockedUntil: new Map(),
  blockHistory: new Map(),
  lastFailureReason: new Map(),
  captchaById: new Map(),
  captchaSolvedUntilByIp: new Map()
};

function now() {
  return Date.now();
}

function cleanQueue(queue, windowMs) {
  const cutoff = now() - windowMs;
  while (queue.length && queue[0] < cutoff) queue.shift();
}

function getQueue(map, key) {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
}

function weightedFailureScore(ip, windowMs = TEN_MINUTES) {
  const events = getQueue(state.failedWeighted, ip);
  const cutoff = now() - windowMs;
  while (events.length && events[0].at < cutoff) events.shift();
  return events.reduce((sum, event) => sum + event.weight, 0);
}

function queueResetSeconds(queue, windowMs) {
  if (!queue.length) return 0;
  return Math.max(1, Math.ceil((queue[0] + windowMs - now()) / 1000));
}

function checkRateLimit(ip) {
  const minuteQ = getQueue(state.authAttemptsMinute, ip);
  const dayQ = getQueue(state.authAttemptsDay, ip);
  cleanQueue(minuteQ, MINUTE);
  cleanQueue(dayQ, DAY);

  return {
    minuteCount: minuteQ.length,
    dayCount: dayQ.length,
    minuteLimit: RATE_LIMIT_MINUTE,
    dayLimit: RATE_LIMIT_DAY,
    resetMinuteSeconds: queueResetSeconds(minuteQ, MINUTE),
    resetDaySeconds: queueResetSeconds(dayQ, DAY),
    overMinute: minuteQ.length >= RATE_LIMIT_MINUTE,
    overDay: dayQ.length >= RATE_LIMIT_DAY
  };
}

function checkPrincipalRateLimit(principalKey) {
  const minuteQ = getQueue(state.principalAttemptsMinute, principalKey);
  const dayQ = getQueue(state.principalAttemptsDay, principalKey);
  cleanQueue(minuteQ, MINUTE);
  cleanQueue(dayQ, DAY);

  return {
    minuteCount: minuteQ.length,
    dayCount: dayQ.length,
    minuteLimit: PRINCIPAL_RATE_LIMIT_MINUTE,
    dayLimit: PRINCIPAL_RATE_LIMIT_DAY,
    resetMinuteSeconds: queueResetSeconds(minuteQ, MINUTE),
    resetDaySeconds: queueResetSeconds(dayQ, DAY),
    overMinute: minuteQ.length >= PRINCIPAL_RATE_LIMIT_MINUTE,
    overDay: dayQ.length >= PRINCIPAL_RATE_LIMIT_DAY
  };
}

function recordAttempt(ip) {
  const t = now();
  getQueue(state.authAttemptsMinute, ip).push(t);
  getQueue(state.authAttemptsDay, ip).push(t);
}

function recordPrincipalAttempt(principalKey) {
  const t = now();
  getQueue(state.principalAttemptsMinute, principalKey).push(t);
  getQueue(state.principalAttemptsDay, principalKey).push(t);
}

function imposeAdaptiveBlock(ip) {
  const strikes = getQueue(state.blockHistory, ip);
  cleanQueue(strikes, BLOCK_STRIKE_WINDOW_MS);
  strikes.push(now());

  const strikeCount = strikes.length;
  const blockMs = Math.min(
    TEMP_BLOCK_MAX_MS,
    TEMP_BLOCK_BASE_MS * Math.pow(2, Math.max(0, strikeCount - 1))
  );

  const current = state.blockedUntil.get(ip) || 0;
  state.blockedUntil.set(ip, Math.max(current, now() + blockMs));

  return {
    strikeCount,
    blockSeconds: Math.ceil(blockMs / 1000)
  };
}

function recordFailure(ip, options = {}) {
  const {
    weight = 1,
    reason = "GENERIC_FAILURE"
  } = options;

  const q = getQueue(state.failedMinute, ip);
  q.push(now());
  cleanQueue(q, MINUTE);
  state.lastFailureReason.set(ip, reason);

  const weightedQ = getQueue(state.failedWeighted, ip);
  weightedQ.push({ at: now(), weight: Math.max(1, Number(weight) || 1) });
  const score10m = weightedFailureScore(ip, TEN_MINUTES);

  if (q.length >= BLOCK_FAILED_MINUTE || score10m >= BLOCK_WEIGHT_10M) {
    return {
      blocked: true,
      ...imposeAdaptiveBlock(ip)
    };
  }

  return {
    blocked: false,
    strikeCount: getQueue(state.blockHistory, ip).length,
    blockSeconds: 0
  };
}

function clearFailure(ip) {
  state.failedMinute.delete(ip);
  state.failedWeighted.delete(ip);
  state.lastFailureReason.delete(ip);
}

function isBlocked(ip) {
  const until = state.blockedUntil.get(ip) || 0;
  if (until <= now()) {
    state.blockedUntil.delete(ip);
    return false;
  }
  return true;
}

function blockedRemainingSeconds(ip) {
  const until = state.blockedUntil.get(ip) || 0;
  return Math.max(0, Math.floor((until - now()) / 1000));
}

function isCaptchaSolved(ip) {
  const until = state.captchaSolvedUntilByIp.get(ip) || 0;
  if (until <= now()) {
    state.captchaSolvedUntilByIp.delete(ip);
    return false;
  }
  return true;
}

function shouldRequireCaptcha(ip) {
  const q = getQueue(state.failedMinute, ip);
  cleanQueue(q, MINUTE);
  const weighted10m = weightedFailureScore(ip, TEN_MINUTES);
  return q.length >= CAPTCHA_REQUIRED_FAILED_MINUTE || weighted10m >= CAPTCHA_REQUIRED_WEIGHT_10M;
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

function createCaptcha(ip) {
  const challengeId = uuidv4();
  const challenge = createHumanChallenge();

  state.captchaById.set(challengeId, {
    ip,
    answer: challenge.answer,
    attempts: 0,
    maxAttempts: CAPTCHA_MAX_ATTEMPTS,
    expiresAt: now() + CAPTCHA_CHALLENGE_TTL_MS
  });

  return {
    challengeId,
    question: challenge.question,
    expiresInSeconds: Math.floor(CAPTCHA_CHALLENGE_TTL_MS / 1000),
    maxAttempts: CAPTCHA_MAX_ATTEMPTS
  };
}

function verifyCaptcha({ ip, challengeId, answer }) {
  const record = state.captchaById.get(challengeId);
  if (!record) return { ok: false, reason: "Invalid challenge." };
  if (record.ip !== ip) return { ok: false, reason: "Challenge-IP mismatch." };

  if (record.expiresAt < now()) {
    state.captchaById.delete(challengeId);
    return { ok: false, reason: "Challenge expired." };
  }

  record.attempts += 1;
  if (record.answer !== String(answer || "").trim()) {
    const remaining = Math.max(0, record.maxAttempts - record.attempts);

    if (remaining <= 0) {
      state.captchaById.delete(challengeId);
      recordFailure(ip, { weight: 4, reason: "CAPTCHA_MAX_ATTEMPTS" });
      return {
        ok: false,
        reason: "Too many captcha attempts. Request a new challenge.",
        retryAfterSeconds: 2
      };
    }

    recordFailure(ip, { weight: 2, reason: "CAPTCHA_INVALID" });
    return {
      ok: false,
      reason: `Wrong captcha answer. ${remaining} attempts left.`
    };
  }

  state.captchaById.delete(challengeId);
  state.captchaSolvedUntilByIp.set(ip, now() + CAPTCHA_SOLVE_TTL_MS);
  clearFailure(ip);
  return { ok: true };
}

function getSecurityStatus(ip) {
  const rate = checkRateLimit(ip);
  const failedMinuteQ = getQueue(state.failedMinute, ip);
  cleanQueue(failedMinuteQ, MINUTE);
  const failureWeight10m = weightedFailureScore(ip, TEN_MINUTES);

  const blocked = isBlocked(ip);
  const captchaSolved = isCaptchaSolved(ip);
  const captchaRequired = shouldRequireCaptcha(ip) && !captchaSolved;

  return {
    blocked,
    blockedSeconds: blocked ? blockedRemainingSeconds(ip) : 0,
    captchaRequired,
    captchaSolved,
    failureCountMinute: failedMinuteQ.length,
    failureWeight10m,
    lastFailureReason: state.lastFailureReason.get(ip) || null,
    rate
  };
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
  recordAttempt,
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
  getSecurityStatus
};
