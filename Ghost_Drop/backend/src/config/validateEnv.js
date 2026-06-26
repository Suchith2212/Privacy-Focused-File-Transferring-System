/**
 * Startup environment validation.
 * Runs before the server starts — fails fast with a clear message
 * if required environment variables are missing or obviously weak.
 */
const logger = require("./logger");

const ALWAYS_REQUIRED = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "GOOGLE_DRIVE_FOLDER_ID"
];

const PRODUCTION_REQUIRED = [
  ...ALWAYS_REQUIRED,
  "SUB_TOKEN_SECRET_KEY",
  "TOKEN_LOOKUP_SECRET",
  "REDIS_URL"
];

const WEAK_DEFAULTS = new Set([
  "ghostdrop-token-lookup-dev-secret",
  "ghostdrop-sub-token-dev-secret",
  "replace_with_a_high_entropy_secret",
  "replace_with_64_hex_or_high_entropy_secret",
  "your_mysql_password",
  "your_drive_folder_id"
]);

function validateEnvironment() {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const isProduction = env === "production";

  const required = isProduction ? PRODUCTION_REQUIRED : ALWAYS_REQUIRED;
  const missing = required.filter((key) => !String(process.env[key] || "").trim());

  if (missing.length > 0) {
    logger.error({ missing }, `❌ Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Warn about weak/placeholder values
  const weak = [];
  for (const key of ["SUB_TOKEN_SECRET_KEY", "TOKEN_LOOKUP_SECRET"]) {
    const val = String(process.env[key] || "").trim();
    if (val && WEAK_DEFAULTS.has(val)) {
      weak.push(key);
    }
  }

  if (weak.length > 0 && isProduction) {
    logger.error({ weak }, `❌ Production secrets are using placeholder values: ${weak.join(", ")}`);
    process.exit(1);
  } else if (weak.length > 0) {
    logger.warn({ weak }, `⚠️  Placeholder secrets detected — do NOT use in production: ${weak.join(", ")}`);
  }

  // Validate SUB_TOKEN_SECRET_KEY length in production
  if (isProduction) {
    const subKey = String(process.env.SUB_TOKEN_SECRET_KEY || "").trim();
    if (subKey.length < 32) {
      logger.error("❌ SUB_TOKEN_SECRET_KEY must be at least 32 characters in production");
      process.exit(1);
    }

    const lookupKey = String(process.env.TOKEN_LOOKUP_SECRET || "").trim();
    if (lookupKey.length < 32) {
      logger.error("❌ TOKEN_LOOKUP_SECRET must be at least 32 characters in production");
      process.exit(1);
    }
  }

  if (isProduction) {
    logger.info("✅ Environment variables validated for production");
  } else {
    logger.info(`✅ Environment validated (NODE_ENV=${env})`);
  }
}

module.exports = { validateEnvironment };
