const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");
const {
  seedModuleBDemo,
  closeSeedPool
} = require("./seed_module_b_demo");
const { startServer } = require("../src/app");

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 4000}`;
const SERVER_CWD = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return res.json();
    } catch {}
    await sleep(500);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function withServer(task) {
  const server = startServer();

  try {
    await waitForHealth();
    return await task();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const seeded = await seedModuleBDemo();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "ghostdrop_proto"
  });

  try {
    const summary = await withServer(async () => {
      const landingRes = await fetch(BASE_URL);
      const landingHtml = await landingRes.text();
      const adminLogin = await requestJson(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outerToken: seeded.outerToken,
          innerToken: seeded.mainInnerToken
        })
      });
      const adminHeaders = { Authorization: `Bearer ${adminLogin.sessionToken}` };
      const adminAuth = await requestJson(`${BASE_URL}/api/auth/isAuth`, { headers: adminHeaders });
      const adminList = await requestJson(`${BASE_URL}/api/portfolio`, { headers: adminHeaders });
      const created = await requestJson(`${BASE_URL}/api/portfolio`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: "Smoke Entry",
          content: "Created during verify_module_b_e2e.js"
        })
      });
      const createdId = created.entry.entryId;
      const fetched = await requestJson(`${BASE_URL}/api/portfolio/${createdId}`, {
        headers: adminHeaders
      });
      const updated = await requestJson(`${BASE_URL}/api/portfolio/${createdId}`, {
        method: "PUT",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: "Smoke Entry Updated",
          content: "Updated during verify_module_b_e2e.js"
        })
      });

      const userLogin = await requestJson(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outerToken: seeded.outerToken,
          innerToken: seeded.subInnerToken
        })
      });
      const userHeaders = { Authorization: `Bearer ${userLogin.sessionToken}` };
      const userAuth = await requestJson(`${BASE_URL}/api/auth/isAuth`, { headers: userHeaders });
      const userList = await requestJson(`${BASE_URL}/api/portfolio`, { headers: userHeaders });

      let denied = { denied: false, status: null };
      try {
        await requestJson(`${BASE_URL}/api/portfolio/${createdId}`, {
          method: "DELETE",
          headers: userHeaders
        });
      } catch (err) {
        denied = { denied: err.status === 403, status: err.status };
      }

      await connection.execute(
        "UPDATE portfolio_entries SET content = ? WHERE entry_id = ?",
        ["tampered-directly", seeded.deniedEntryId]
      );

      let readBlocked = { blocked: false, status: null };
      try {
        await requestJson(`${BASE_URL}/api/portfolio/${seeded.deniedEntryId}`, {
          headers: adminHeaders
        });
      } catch (err) {
        readBlocked = { blocked: err.status === 409, status: err.status };
      }

      const tamper = await requestJson(`${BASE_URL}/api/security/unauthorized-check`, {
        headers: adminHeaders
      });
      const evidence = await requestJson(`${BASE_URL}/api/module-b/evidence`, {
        headers: adminHeaders
      });
      const deleted = await requestJson(`${BASE_URL}/api/portfolio/${createdId}`, {
        method: "DELETE",
        headers: adminHeaders
      });

      return {
        landingServed: landingRes.ok && landingHtml.includes("GhostDrop"),
        adminRole: adminAuth.role,
        userRole: userAuth.role,
        adminVisibleEntries: adminList.entries.length,
        userVisibleEntries: userList.entries.length,
        createdEntryId: createdId,
        fetchedTitle: fetched.entry.title,
        updatedTitle: updated.entry.title,
        userDeleteDenied: denied,
        tamperedEntryId: seeded.deniedEntryId,
        tamperedReadBlocked: readBlocked,
        tamperDetectionConfirmed: !tamper.ok && tamper.tamperedCount >= 1 && readBlocked.blocked,
        unauthorizedCheckOkAfterTamper: tamper.ok,
        tamperedCount: tamper.tamperedCount,
        evidenceIntegrityOkAfterTamper: evidence.integrity.ok,
        evidenceAuditEvents: evidence.audit.totalEvents,
        deleteMessage: deleted.message
      };
    });

    await seedModuleBDemo();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await closeSeedPool().catch(() => {});
    await connection.end().catch(() => {});
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
