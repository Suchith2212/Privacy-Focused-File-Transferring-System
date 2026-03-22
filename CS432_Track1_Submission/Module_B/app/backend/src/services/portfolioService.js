const { v4: uuidv4 } = require("uuid");
const { query } = require("../config/db");
const { computeIntegrityHash, ensurePortfolioSchema } = require("./portfolioIntegrity");

async function createPortfolioEntry({
  vaultId,
  ownerTokenId,
  createdByTokenId,
  title,
  content
}) {
  await ensurePortfolioSchema();
  const entryId = uuidv4();
  const integrityHash = computeIntegrityHash({
    vaultId,
    ownerTokenId,
    title,
    content,
    status: "ACTIVE"
  });

  await query(
    `
    INSERT INTO portfolio_entries
    (entry_id, vault_id, owner_token_id, created_by_token_id, title, content, integrity_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NOW(), NOW())
    `,
    [entryId, vaultId, ownerTokenId, createdByTokenId, title, content, integrityHash]
  );

  return entryId;
}

module.exports = {
  createPortfolioEntry
};
