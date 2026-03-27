const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { query } = require("./src/config/db");
const { ensurePortfolioSchema, findTamperedEntries } = require("./src/services/portfolioIntegrity");

async function testTamper() {
  try {
    await ensurePortfolioSchema();

    const requestedVaultId = process.argv[2];
    let vaultId = requestedVaultId;

    if (!vaultId) {
      const seeded = await query(
        `
        SELECT vault_id
        FROM vaults
        WHERE outer_token = 'OUTERDEMO7'
        LIMIT 1
        `
      );
      vaultId = seeded[0]?.vault_id || "";
    }

    if (!vaultId) {
      const latest = await query(
        `
        SELECT vault_id
        FROM vaults
        ORDER BY created_at DESC
        LIMIT 1
        `
      );
      vaultId = latest[0]?.vault_id || "";
    }

    if (!vaultId) {
      throw new Error("No vault found. Seed demo data or pass a vault id as the first argument.");
    }

    const tampered = await findTamperedEntries(vaultId);
    console.log(
      JSON.stringify(
        {
          vaultId,
          tamperedCount: tampered.length,
          tamperedEntries: tampered
        },
        null,
        2
      )
    );
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testTamper();
