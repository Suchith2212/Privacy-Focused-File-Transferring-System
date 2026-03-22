const {
  getSessionTokenFromRequest,
  validateSessionAgainstDb
} = require("../services/authSession");

async function requireAuth(req, res, next) {
  const sessionToken = getSessionTokenFromRequest(req);
  const session = await validateSessionAgainstDb(sessionToken).catch(() => null);
  if (!session) {
    return res.status(401).json({ error: "Authentication required." });
  }

  req.authSession = session;
  return next();
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.authSession.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }
    return next();
  });
}

module.exports = {
  requireAuth,
  requireAdmin
};
