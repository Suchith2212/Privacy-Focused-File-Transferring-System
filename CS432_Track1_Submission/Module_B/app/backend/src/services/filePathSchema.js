const { query } = require("../config/db");

let ensureRelativePathColumnPromise = null;

async function ensureRelativePathColumn() {
  if (!ensureRelativePathColumnPromise) {
    ensureRelativePathColumnPromise = (async () => {
      try {
        const checkColumnQuery = `
          SELECT COUNT(*) as column_count 
          FROM information_schema.COLUMNS 
          WHERE TABLE_NAME = 'file_metadata' 
          AND COLUMN_NAME = 'relative_path'
          AND TABLE_SCHEMA = DATABASE()
        `;
        const results = await query(checkColumnQuery);
        
        if (results[0].column_count === 0) {
          await query(`
            ALTER TABLE file_metadata
            ADD COLUMN relative_path VARCHAR(512) NULL
          `);
        }
      } catch (err) {
        ensureRelativePathColumnPromise = null;
        throw err;
      }
    })();
  }

  return ensureRelativePathColumnPromise;
}

module.exports = {
  ensureRelativePathColumn
};
