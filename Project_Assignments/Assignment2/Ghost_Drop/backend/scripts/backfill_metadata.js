const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { query } = require("../src/config/db");
const {
  buildStoragePath,
  buildFileIv,
  buildFileHmac
} = require("../src/services/fileSecurityMetadata");
const { createPortfolioEntry } = require("../src/services/portfolioService");
const { ensurePortfolioSchema } = require("../src/services/portfolioIntegrity");

async function backfillFiles() {
  const rows = await query(
    `
    SELECT
      file_id,
      vault_id,
      drive_file_id,
      original_filename,
      storage_path,
      file_key_iv,
      file_hmac
    FROM files
    `
  );

  let updatedCount = 0;

  for (const row of rows) {
    const nextStoragePath =
      row.storage_path || buildStoragePath({ id: row.drive_file_id }, row.original_filename);
    const nextIv = row.file_key_iv || buildFileIv();
    const nextHmac =
      row.file_hmac || buildFileHmac(Buffer.from(`${row.file_id}:${row.drive_file_id}`), row.vault_id);

    const needsUpdate =
      nextStoragePath !== row.storage_path ||
      nextIv !== row.file_key_iv ||
      nextHmac !== row.file_hmac;

    if (!needsUpdate) continue;

    await query(
      `
      UPDATE files
      SET storage_path = ?, file_key_iv = ?, file_hmac = ?
      WHERE file_id = ?
      `,
      [nextStoragePath, nextIv, nextHmac, row.file_id]
    );
    updatedCount += 1;
  }

  return updatedCount;
}

async function backfillPortfolioEntries() {
  await ensurePortfolioSchema();

  const [vaultRows, subTokenRows] = await Promise.all([
    query(
      `
      SELECT v.vault_id, v.expires_at, t.inner_token_id AS main_token_id
      FROM vaults v
      JOIN inner_tokens t ON t.vault_id = v.vault_id
      WHERE t.token_type = 'MAIN' AND t.status = 'ACTIVE'
      `
    ),
    query(
      `
      SELECT vault_id, inner_token_id
      FROM inner_tokens
      WHERE token_type = 'SUB' AND status = 'ACTIVE'
      `
    )
  ]);

  let insertedCount = 0;

  for (const vault of vaultRows) {
    const existing = await query(
      `
      SELECT entry_id
      FROM portfolio_entries
      WHERE vault_id = ?
      LIMIT 1
      `,
      [vault.vault_id]
    );
    if (existing.length > 0) continue;

    const fileCountRows = await query(
      `
      SELECT COUNT(*) AS total_files
      FROM files
      WHERE vault_id = ?
      `,
      [vault.vault_id]
    );

    await createPortfolioEntry({
      vaultId: vault.vault_id,
      ownerTokenId: vault.main_token_id,
      createdByTokenId: vault.main_token_id,
      title: "Backfilled vault summary",
      content: `Backfilled summary entry for vault with ${Number(fileCountRows[0]?.total_files || 0)} stored file(s). Expires at ${new Date(vault.expires_at).toISOString()}.`
    });
    insertedCount += 1;
  }

  for (const subToken of subTokenRows) {
    const existing = await query(
      `
      SELECT entry_id
      FROM portfolio_entries
      WHERE owner_token_id = ?
      LIMIT 1
      `,
      [subToken.inner_token_id]
    );
    if (existing.length > 0) continue;

    const fileCountRows = await query(
      `
      SELECT COUNT(*) AS total_files
      FROM file_key_access
      WHERE inner_token_id = ?
      `,
      [subToken.inner_token_id]
    );

    await createPortfolioEntry({
      vaultId: subToken.vault_id,
      ownerTokenId: subToken.inner_token_id,
      createdByTokenId: subToken.inner_token_id,
      title: "Backfilled scoped access summary",
      content: `Backfilled summary entry for SUB token with ${Number(fileCountRows[0]?.total_files || 0)} mapped file(s).`
    });
    insertedCount += 1;
  }

  return insertedCount;
}

async function main() {
  const updatedFiles = await backfillFiles();
  const insertedPortfolioEntries = await backfillPortfolioEntries();

  process.stdout.write(
    JSON.stringify(
      {
        updatedFiles,
        insertedPortfolioEntries
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
