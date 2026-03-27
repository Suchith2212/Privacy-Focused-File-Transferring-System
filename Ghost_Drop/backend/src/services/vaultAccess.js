const { query } = require("../config/db");
const { computeTokenLookupHash, verifyInnerToken, isBase62 } = require("./crypto");

function validateInnerToken(innerToken) {
  if (typeof innerToken !== "string") return false;
  if (innerToken.length < 10 || innerToken.length > 20) return false;
  return isBase62(innerToken);
}

function getRemainingSeconds(expiresAt) {
  const remaining = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

async function resolveVaultByOuterToken(outerToken) {
  const rows = await query(
    `
    SELECT vault_id, outer_token, status, created_at, expires_at
    FROM vaults
    WHERE outer_token = ?
    `,
    [outerToken]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

function isVaultActive(vault) {
  if (!vault) return false;
  return vault.status === "ACTIVE" && new Date(vault.expires_at) > new Date();
}

async function verifyTokenForVault(vaultId, innerToken) {
  const lookupHash = computeTokenLookupHash(innerToken);
  const indexedRows = await query(
    `
    SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
    FROM inner_tokens
    WHERE token_lookup_hash = ? AND vault_id = ? AND status = 'ACTIVE'
    `,
    [lookupHash, vaultId]
  );

  for (const tokenRow of indexedRows) {
    const ok = verifyInnerToken(
      innerToken,
      tokenRow.token_hash,
      tokenRow.salt,
      tokenRow.key_iterations
    );
    if (ok) return tokenRow;
  }

  const fallbackRows = await query(
    `
    SELECT inner_token_id, token_type, token_hash, salt, key_iterations, status, token_lookup_hash
    FROM inner_tokens
    WHERE vault_id = ? AND status = 'ACTIVE'
    `,
    [vaultId]
  );

  for (const tokenRow of fallbackRows) {
    const ok = verifyInnerToken(
      innerToken,
      tokenRow.token_hash,
      tokenRow.salt,
      tokenRow.key_iterations
    );
    if (!ok) continue;

    if (!tokenRow.token_lookup_hash) {
      await query(
        `
        UPDATE inner_tokens
        SET token_lookup_hash = ?
        WHERE inner_token_id = ? AND token_lookup_hash IS NULL
        `,
        [lookupHash, tokenRow.inner_token_id]
      ).catch(() => {});
      tokenRow.token_lookup_hash = lookupHash;
    }

    return tokenRow;
  }

  return null;
}

module.exports = {
  validateInnerToken,
  getRemainingSeconds,
  resolveVaultByOuterToken,
  isVaultActive,
  verifyTokenForVault
};
