const mysql = require("mysql2/promise");

function cleanEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  return value.trim();
}

const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";

/**
 * Build optional SSL config for production.
 * Set DB_SSL_CA_CERT / DB_SSL_KEY_CERT / DB_SSL_CERT as base64-encoded PEM strings
 * in the deployment platform's environment variables — never in files.
 */
function buildSslConfig() {
  if (!isProduction) return false;

  const sslConfig = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
  };

  if (process.env.DB_SSL_CA_CERT) {
    sslConfig.ca = Buffer.from(process.env.DB_SSL_CA_CERT, "base64").toString();
  }
  if (process.env.DB_SSL_KEY_CERT) {
    sslConfig.key = Buffer.from(process.env.DB_SSL_KEY_CERT, "base64").toString();
  }
  if (process.env.DB_SSL_CERT) {
    sslConfig.cert = Buffer.from(process.env.DB_SSL_CERT, "base64").toString();
  }

  return sslConfig;
}

const pool = mysql.createPool({
  host: cleanEnv("DB_HOST", "127.0.0.1"),
  port: Number(cleanEnv("DB_PORT", "3306")),
  user: cleanEnv("DB_USER", "root"),
  password: cleanEnv("DB_PASSWORD", ""),
  database: cleanEnv("DB_NAME", "ghostdrop_proto"),
  waitForConnections: true,
  connectionLimit: Number(cleanEnv("DB_CONNECTION_LIMIT", "20")),
  queueLimit: 0,
  ssl: buildSslConfig(),
  // Automatically reconnect on idle timeout
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getConnection() {
  return pool.getConnection();
}

module.exports = {
  pool,
  query,
  getConnection
};
