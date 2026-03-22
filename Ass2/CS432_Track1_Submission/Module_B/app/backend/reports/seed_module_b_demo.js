require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { v4: uuidv4 } = require("uuid");
const { query, pool, getConnection } = require("../src/config/db");
const { hashInnerToken, computeTokenLookupHash } = require("../src/services/crypto");
const {
  ensurePortfolioSchema,
  computeIntegrityHash
} = require("../src/services/portfolioIntegrity");

const DEMO = {
  outerToken: "OUTERDEMO7",
  mainInnerToken: "MainDemo1234",
  subInnerToken: "SubDemo12345",
  expiresAt: "2030-12-31 23:59:59"
};

async function seedModuleBDemo() {
  await ensurePortfolioSchema();
  const conn = await getConnection();

  try {
    await conn.beginTransaction();

    const vaultId = uuidv4();
    const mainTokenId = uuidv4();
    const subTokenId = uuidv4();
    const adminEntryId = uuidv4();
    const userEntryId = uuidv4();

    await conn.execute("DELETE FROM vaults WHERE outer_token = ?", [DEMO.outerToken]);

    await conn.execute(
      `
      INSERT INTO vaults (vault_id, outer_token, created_at, expires_at, status)
      VALUES (?, ?, NOW(), ?, 'ACTIVE')
      `,
      [vaultId, DEMO.outerToken, DEMO.expiresAt]
    );

    const mainHash = hashInnerToken(DEMO.mainInnerToken);
    const subHash = hashInnerToken(DEMO.subInnerToken);

    await conn.execute(
      `
      INSERT INTO inner_tokens
      (inner_token_id, vault_id, token_type, token_hash, token_lookup_hash, salt, key_iterations, created_at, status)
      VALUES
      (?, ?, 'MAIN', ?, ?, ?, ?, NOW(), 'ACTIVE'),
      (?, ?, 'SUB', ?, ?, ?, ?, NOW(), 'ACTIVE')
      `,
      [
        mainTokenId,
        vaultId,
        mainHash.tokenHash,
        computeTokenLookupHash(DEMO.mainInnerToken),
        mainHash.salt,
        mainHash.iterations,
        subTokenId,
        vaultId,
        subHash.tokenHash,
        computeTokenLookupHash(DEMO.subInnerToken),
        subHash.salt,
        subHash.iterations
      ]
    );

    await conn.execute(
      `
      INSERT INTO portfolio_entries
      (entry_id, vault_id, owner_token_id, created_by_token_id, title, content, integrity_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
      `,
      [
        adminEntryId,
        vaultId,
        mainTokenId,
        mainTokenId,
        "Admin Seed Entry",
        "Seeded admin-owned entry for Module B evidence.",
        computeIntegrityHash({
          vaultId,
          ownerTokenId: mainTokenId,
          title: "Admin Seed Entry",
          content: "Seeded admin-owned entry for Module B evidence.",
          status: "ACTIVE"
        })
      ]
    );

    await conn.execute(
      `
      INSERT INTO portfolio_entries
      (entry_id, vault_id, owner_token_id, created_by_token_id, title, content, integrity_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
      `,
      [
        userEntryId,
        vaultId,
        subTokenId,
        mainTokenId,
        "User Seed Entry",
        "Seeded sub-owned entry for Module B evidence.",
        computeIntegrityHash({
          vaultId,
          ownerTokenId: subTokenId,
          title: "User Seed Entry",
          content: "Seeded sub-owned entry for Module B evidence.",
          status: "ACTIVE"
        })
      ]
    );

    await conn.commit();

    return {
      message: "Module B demo data seeded.",
      outerToken: DEMO.outerToken,
      mainInnerToken: DEMO.mainInnerToken,
      subInnerToken: DEMO.subInnerToken,
      vaultId,
      mainTokenId,
      subTokenId,
      deniedEntryId: adminEntryId,
      subOwnedEntryId: userEntryId
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function closeSeedPool() {
  await pool.end().catch(() => {});
}

if (require.main === module) {
  seedModuleBDemo()
    .then((output) => {
      console.log(JSON.stringify(output, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeSeedPool();
    });
}

module.exports = {
  seedModuleBDemo,
  closeSeedPool
};
