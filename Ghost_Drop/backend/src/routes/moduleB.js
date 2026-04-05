const express = require("express");
const { requireAdmin } = require("../middleware/authSession");
const { query } = require("../config/db");
const { findTamperedEntries } = require("../services/portfolioIntegrity");
const { getAuditSummary } = require("../services/fileAuditLogger");

const router = express.Router();

router.get("/evidence", requireAdmin, async (req, res) => {
  try {
    const indexRows = await query("SHOW INDEX FROM portfolio_entries");
    const explainRows = await query(
      `
      EXPLAIN
      SELECT entry_id, title, updated_at
      FROM portfolio_entries
      WHERE vault_id = ? AND status = 'ACTIVE'
      ORDER BY updated_at DESC
      LIMIT 25
      `,
      [req.authSession.vaultId]
    );
    const tamperedEntries = await findTamperedEntries(req.authSession.vaultId);
    const audit = await getAuditSummary();

    return res.json({
      project: "Ghost_Drop",
      module: "Portfolio Security API",
      vaultId: req.authSession.vaultId,
      rbacMapping: {
        MAIN: "admin",
        SUB: "user"
      },
      integrity: {
        ok: tamperedEntries.length === 0,
        tamperedCount: tamperedEntries.length,
        tamperedEntries
      },
      audit,
      indexes: indexRows.map((row) => ({
        table: row.Table,
        keyName: row.Key_name,
        columnName: row.Column_name,
        seqInIndex: row.Seq_in_index,
        nonUnique: row.Non_unique
      })),
      explainPlan: explainRows
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to build portfolio API evidence." });
  }
});

module.exports = router;
