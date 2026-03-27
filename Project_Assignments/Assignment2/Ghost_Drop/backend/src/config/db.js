const mysql = require("mysql2/promise");

function cleanEnv(name, fallback = "") {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  return value.trim();
}

const pool = mysql.createPool({
  host: cleanEnv("DB_HOST", "127.0.0.1"),
  port: Number(cleanEnv("DB_PORT", "3306")),
  user: cleanEnv("DB_USER", "root"),
  password: cleanEnv("DB_PASSWORD", ""),
  database: cleanEnv("DB_NAME", "ghostdrop_proto"),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
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
