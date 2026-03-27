const crypto = require("crypto");

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

function hashInnerToken(innerToken) {
  const iterations = Number(process.env.PBKDF2_ITERATIONS || 250000);
  const salt = crypto.randomBytes(16).toString("hex");
  const tokenHash = crypto
    .pbkdf2Sync(innerToken, salt, iterations, 32, "sha256")
    .toString("hex");

  return {
    tokenHash,
    salt,
    iterations
  };
}

function getTokenLookupSecret() {
  return process.env.TOKEN_LOOKUP_SECRET || DEFAULT_TOKEN_LOOKUP_SECRET;
}

function computeTokenLookupHash(innerToken) {
  return crypto
    .createHmac("sha256", getTokenLookupSecret())
    .update(String(innerToken))
    .digest("hex");
}

function verifyInnerToken(innerToken, tokenHash, salt, iterations) {
  const computed = crypto
    .pbkdf2Sync(innerToken, salt, Number(iterations), 32, "sha256")
    .toString("hex");
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
  verifyInnerToken,
  isBase62
};
