require('dotenv').config({ path: '../Assignment2/Ghost_Drop/backend/.env' });
const { findTamperedEntries } = require('../Assignment2/Ghost_Drop/backend/src/services/portfolioIntegrity');
const { query } = require('../Assignment2/Ghost_Drop/backend/src/config/db');

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
