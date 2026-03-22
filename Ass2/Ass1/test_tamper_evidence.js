require('dotenv').config({ path: 'Project_432/backend/.env' });
const { findTamperedEntries } = require('./Project_432/backend/src/services/portfolioIntegrity');
const { query } = require('./Project_432/backend/src/config/db');

async function testTamper() {
  try {
    const tampered = await findTamperedEntries('v-1');
    console.log(JSON.stringify(tampered, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testTamper();
