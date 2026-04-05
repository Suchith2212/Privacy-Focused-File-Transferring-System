function asPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function mergePolicy(defaults, overrideRaw) {
  if (!overrideRaw) return defaults;
  try {
    const parsed = JSON.parse(String(overrideRaw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const merged = { ...defaults };
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      merged[key] = { ...(defaults[key] || {}), ...value };
    }
    return merged;
  } catch {
    return defaults;
  }
}

const BASE_RATE_LIMITS = {
  "vault.public-info": { minute: 25, day: 400 },
  "vault.access": { minute: 18, day: 240 },
  "vault.subtoken-create": { minute: 8, day: 80 },
  "files.new-vault-upload": { minute: 6, day: 50 },
  "files.upload": { minute: 10, day: 120 },
  "files.download": { minute: 20, day: 250 },
  "files.download-batch": { minute: 8, day: 160 },
  "files.subtoken-create": { minute: 8, day: 100 },
  "files.subtoken-update": { minute: 15, day: 180 },
  "default": { minute: 30, day: 500 }
};

const BASE_RISK_POLICY = {
  "vault.public-info": { captchaThreshold: 50, blockThreshold: 95 },
  "vault.access": { captchaThreshold: 35, blockThreshold: 90 },
  "vault.subtoken-create": { captchaThreshold: 30, blockThreshold: 85 },
  "files.new-vault-upload": { captchaThreshold: 35, blockThreshold: 85 },
  "files.upload": { captchaThreshold: 35, blockThreshold: 85 },
  "files.download": { captchaThreshold: 35, blockThreshold: 85 },
  "files.download-batch": { captchaThreshold: 40, blockThreshold: 90 },
  "default": { captchaThreshold: 50, blockThreshold: 95 }
};

const ROUTE_RATE_LIMITS = mergePolicy(BASE_RATE_LIMITS, process.env.ROUTE_RATE_LIMITS_JSON);
const ROUTE_RISK_POLICY = mergePolicy(BASE_RISK_POLICY, process.env.ROUTE_RISK_POLICY_JSON);

for (const [k, v] of Object.entries(ROUTE_RATE_LIMITS)) {
  const minute = asPositiveInt(v.minute, BASE_RATE_LIMITS.default.minute);
  const day = asPositiveInt(v.day, BASE_RATE_LIMITS.default.day);
  ROUTE_RATE_LIMITS[k] = { minute, day };
}

for (const [k, v] of Object.entries(ROUTE_RISK_POLICY)) {
  const captchaThreshold = Math.max(0, Math.min(100, asPositiveInt(v.captchaThreshold, BASE_RISK_POLICY.default.captchaThreshold)));
  const blockThreshold = Math.max(captchaThreshold, Math.min(100, asPositiveInt(v.blockThreshold, BASE_RISK_POLICY.default.blockThreshold)));
  ROUTE_RISK_POLICY[k] = { captchaThreshold, blockThreshold };
}

module.exports = {
  ROUTE_RATE_LIMITS,
  ROUTE_RISK_POLICY
};
