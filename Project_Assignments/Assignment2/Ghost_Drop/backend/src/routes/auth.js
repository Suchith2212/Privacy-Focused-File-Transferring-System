const express = require("express");
const { createSession, getSessionTokenFromRequest, getSession } = require("../services/authSession");
const { appendAuditLog } = require("../services/fileAuditLogger");
const {
  validateInnerToken,
  resolveVaultByOuterToken,
  isVaultActive,
  verifyTokenForVault,
  getRemainingSeconds
} = require("../services/vaultAccess");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { outerToken, innerToken } = req.body || {};

    if (!outerToken || !validateInnerToken(innerToken)) {
      return res.status(400).json({ error: "outerToken and a valid innerToken are required." });
    }

    const vault = await resolveVaultByOuterToken(outerToken);
    if (!vault || !isVaultActive(vault)) {
      await appendAuditLog({
        req,
        action: "auth.login.denied",
        outerToken,
        reason: "VAULT_NOT_ACTIVE"
      }).catch(() => {});
      return res.status(404).json({ error: "Active vault not found." });
    }

    const tokenRow = await verifyTokenForVault(vault.vault_id, innerToken);
    if (!tokenRow) {
      await appendAuditLog({
        req,
        action: "auth.login.denied",
        outerToken,
        vaultId: vault.vault_id,
        reason: "INVALID_INNER_TOKEN"
      }).catch(() => {});
      return res.status(401).json({ error: "Invalid inner token." });
    }

    const session = createSession({ vault, tokenRow, outerToken });
    await appendAuditLog({
      req,
      action: "auth.login.success",
      outerToken,
      vaultId: vault.vault_id,
      tokenType: tokenRow.token_type,
      role: session.role
    }).catch(() => {});

    return res.json({
      message: "Vault session established.",
      ...session
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed." });
  }
});

router.get("/isAuth", async (req, res) => {
  const session = getSession(getSessionTokenFromRequest(req));
  if (!session) {
    return res.status(401).json({ authenticated: false, error: "Session not found." });
  }

  return res.json({
    authenticated: true,
    outerToken: session.outerToken,
    vaultId: session.vaultId,
    role: session.role,
    tokenType: session.tokenType,
    remainingSeconds: getRemainingSeconds(new Date(session.expiresAtMs))
  });
});

module.exports = router;
