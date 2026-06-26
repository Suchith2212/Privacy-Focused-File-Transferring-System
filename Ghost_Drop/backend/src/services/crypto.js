const crypto = require("crypto");
const { promisify } = require("util");

const pbkdf2Async = promisify(crypto.pbkdf2);

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DEFAULT_TOKEN_LOOKUP_SECRET = "ghostdrop-token-lookup-dev-secret";

function randomBase62(length) {
  const bytes = crypto.randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += BASE62[bytes[i] % BASE62.length];
  }
  return token;
}

function generateOuterToken() {
  return randomBase62(7);
}

function generateInnerToken(length = 12) {
  return randomBase62(length);
}

/**
 * Hash an inner token using PBKDF2 (async — does NOT block the event loop).
 * Returns { tokenHash, salt, iterations }.
 */
async function hashInnerToken(innerToken) {
  const iterations = Number(process.env.PBKDF2_ITERATIONS || 250000);
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await pbkdf2Async(innerToken, salt, iterations, 32, "sha256");
  return {
    tokenHash: derivedKey.toString("hex"),
    salt,
    iterations
  };
}

function getTokenLookupSecret() {
  const secret = String(process.env.TOKEN_LOOKUP_SECRET || "").trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (!secret) {
    if (env === "production") {
      throw new Error("TOKEN_LOOKUP_SECRET must be explicitly set in production.");
    }
    return DEFAULT_TOKEN_LOOKUP_SECRET;
  }
  return secret;
}

function assertTokenLookupSecretSafe() {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (env === "production" && !String(process.env.TOKEN_LOOKUP_SECRET || "").trim()) {
    throw new Error("TOKEN_LOOKUP_SECRET must be explicitly set in production.");
  }
}

function computeTokenLookupHash(innerToken) {
  return crypto
    .createHmac("sha256", getTokenLookupSecret())
    .update(String(innerToken))
    .digest("hex");
}

/**
 * Verify an inner token against its stored PBKDF2 hash (async).
 * Uses timing-safe comparison to prevent timing attacks.
 */
async function verifyInnerToken(innerToken, tokenHash, salt, iterations) {
  const derivedKey = await pbkdf2Async(innerToken, salt, Number(iterations), 32, "sha256");
  const computed = derivedKey.toString("hex");
  // Both strings are hex so same byte length — timingSafeEqual is safe
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(tokenHash));
}

function isBase62(input) {
  return /^[0-9A-Za-z]+$/.test(input);
}

module.exports = {
  generateOuterToken,
  generateInnerToken,
  hashInnerToken,
  computeTokenLookupHash,
  assertTokenLookupSecretSafe,
  verifyInnerToken,
  isBase62
};

