require('dotenv').config();
const { appendAuditLog } = require('./src/services/fileAuditLogger');

async function triggerLogs() {
  try {
    await appendAuditLog({ action: 'test.init', severity: 'INFO', message: 'Triggering evidence logs' });
    await appendAuditLog({ action: 'auth.login.success', outerToken: 'OUTER123', vaultId: 'v-1', role: 'admin' });
    await appendAuditLog({ action: 'portfolio.create', vaultId: 'v-1', entryId: 'p-1', actorTokenId: 'it-1' });
    await appendAuditLog({ action: 'security.integrity_check', severity: 'WARN', vaultId: 'v-1', tamperedCount: 1 });
    console.log('Audit logs triggered.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

triggerLogs();
