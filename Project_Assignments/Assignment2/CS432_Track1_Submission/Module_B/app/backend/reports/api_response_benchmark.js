const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const API_BASE_URL = process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const ITERATIONS = Math.max(5, Number(process.env.API_BENCHMARK_ITERATIONS || 25));

const DEMO = {
  outerToken: process.env.MODULE_B_DEMO_OUTER_TOKEN || "OUTERDEMO7",
  mainInnerToken: process.env.MODULE_B_DEMO_MAIN_TOKEN || "MainDemo1234",
  subInnerToken: process.env.MODULE_B_DEMO_SUB_TOKEN || "SubDemo12345"
};

function hrtimeMs(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e6;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    iterations: samples.length,
    avgMs: total / samples.length,
    minMs: Math.min(...samples),
    medianMs: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    maxMs: Math.max(...samples)
  };
}

async function timedFetch(url, options) {
  const started = process.hrtime.bigint();
  const response = await fetch(url, options);
  const durationMs = hrtimeMs(started);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return { durationMs, payload };
}

async function login(innerToken) {
  const { payload } = await timedFetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      outerToken: DEMO.outerToken,
      innerToken
    })
  });
  return payload.sessionToken;
}

async function benchmarkRoute(name, buildRequest) {
  const samples = [];
  let lastPayload = null;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const { url, options } = buildRequest();
    const { durationMs, payload } = await timedFetch(url, options);
    samples.push(durationMs);
    lastPayload = payload;
  }

  return {
    name,
    ...summarize(samples),
    lastPayloadShape: Object.keys(lastPayload || {})
  };
}

async function main() {
  const adminSessionToken = await login(DEMO.mainInnerToken);
  const userSessionToken = await login(DEMO.subInnerToken);

  const results = [];

  results.push(
    await benchmarkRoute("auth.login.admin", () => ({
      url: `${API_BASE_URL}/api/auth/login`,
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outerToken: DEMO.outerToken,
          innerToken: DEMO.mainInnerToken
        })
      }
    }))
  );

  results.push(
    await benchmarkRoute("auth.isAuth.admin", () => ({
      url: `${API_BASE_URL}/api/auth/isAuth`,
      options: {
        headers: { Authorization: `Bearer ${adminSessionToken}` }
      }
    }))
  );

  results.push(
    await benchmarkRoute("portfolio.list.admin", () => ({
      url: `${API_BASE_URL}/api/portfolio`,
      options: {
        headers: { Authorization: `Bearer ${adminSessionToken}` }
      }
    }))
  );

  results.push(
    await benchmarkRoute("portfolio.list.user", () => ({
      url: `${API_BASE_URL}/api/portfolio`,
      options: {
        headers: { Authorization: `Bearer ${userSessionToken}` }
      }
    }))
  );

  results.push(
    await benchmarkRoute("module-b.evidence.admin", () => ({
      url: `${API_BASE_URL}/api/module-b/evidence`,
      options: {
        headers: { Authorization: `Bearer ${adminSessionToken}` }
      }
    }))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl: API_BASE_URL,
        iterations: ITERATIONS,
        demoOuterToken: DEMO.outerToken,
        endpoints: results
      },
      null,
      2
    )}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
