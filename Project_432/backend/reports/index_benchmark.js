const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");

function hrtimeMs(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e6;
}

async function runTimedQuery(connection, sql, params, iterations = 150) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    await connection.execute(sql, params);
  }
  return hrtimeMs(start);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "blinddrop_proto"
  });

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS portfolio_benchmark_entries (
      benchmark_id INT AUTO_INCREMENT PRIMARY KEY,
      vault_id VARCHAR(36) NOT NULL,
      owner_token_id VARCHAR(36) NOT NULL,
      title VARCHAR(120) NOT NULL,
      status VARCHAR(16) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [[countRow]] = await connection.execute(
    "SELECT COUNT(*) AS total FROM portfolio_benchmark_entries"
  );

  if (Number(countRow.total) < 5000) {
    await connection.execute("TRUNCATE TABLE portfolio_benchmark_entries");
    const batch = [];
    for (let i = 0; i < 5000; i += 1) {
      batch.push([
        `vault-${i % 25}`,
        `token-${i % 200}`,
        `Entry ${i}`,
        i % 7 === 0 ? "DELETED" : "ACTIVE"
      ]);
    }
    await connection.query(
      `
      INSERT INTO portfolio_benchmark_entries (vault_id, owner_token_id, title, status)
      VALUES ?
      `,
      [batch]
    );
  }

  const benchmarkSql = `
    SELECT benchmark_id, title, updated_at
    FROM portfolio_benchmark_entries
    WHERE vault_id = ? AND owner_token_id = ? AND status = 'ACTIVE'
    ORDER BY updated_at DESC
    LIMIT 25
  `;
  const benchmarkParams = ["vault-3", "token-18"];

  const [existingIndexes] = await connection.execute(
    `
    SHOW INDEX
    FROM portfolio_benchmark_entries
    WHERE Key_name IN ('idx_portfolio_benchmark_lookup', 'idx_portfolio_benchmark_covering')
    `
  );
  const existingIndexNames = [...new Set(existingIndexes.map((row) => row.Key_name))];
  for (const indexName of existingIndexNames) {
    await connection.execute(`DROP INDEX ${indexName} ON portfolio_benchmark_entries`);
  }

  const [beforePlan] = await connection.execute(`EXPLAIN ${benchmarkSql}`, benchmarkParams);
  const beforeMs = await runTimedQuery(connection, benchmarkSql, benchmarkParams);

  await connection.execute(
    `
    CREATE INDEX idx_portfolio_benchmark_lookup
    ON portfolio_benchmark_entries(vault_id, owner_token_id, status, updated_at)
    `
  );
  const [afterPlan] = await connection.execute(`EXPLAIN ${benchmarkSql}`, benchmarkParams);
  const afterMs = await runTimedQuery(connection, benchmarkSql, benchmarkParams);

  await connection.execute(
    `
    CREATE INDEX idx_portfolio_benchmark_covering
    ON portfolio_benchmark_entries(vault_id, owner_token_id, status, updated_at, benchmark_id, title)
    `
  );
  const [coveringPlan] = await connection.execute(`EXPLAIN ${benchmarkSql}`, benchmarkParams);
  const coveringMs = await runTimedQuery(connection, benchmarkSql, benchmarkParams);

  const report = {
    comparison: {
      fullTableScan: {
        durationMs: beforeMs,
        scanType: beforePlan[0]?.type || null,
        key: beforePlan[0]?.key || null,
        extra: beforePlan[0]?.Extra || null,
        rows: beforePlan[0]?.rows || null
      },
      compositeIndex: {
        durationMs: afterMs,
        scanType: afterPlan[0]?.type || null,
        key: afterPlan[0]?.key || null,
        extra: afterPlan[0]?.Extra || null,
        rows: afterPlan[0]?.rows || null
      },
      coveringIndex: {
        durationMs: coveringMs,
        scanType: coveringPlan[0]?.type || null,
        key: coveringPlan[0]?.key || null,
        extra: coveringPlan[0]?.Extra || null,
        rows: coveringPlan[0]?.rows || null
      }
    },
    beforeMs,
    afterMs,
    beforePlan,
    afterPlan,
    coveringMs,
    coveringPlan
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await connection.end();
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
