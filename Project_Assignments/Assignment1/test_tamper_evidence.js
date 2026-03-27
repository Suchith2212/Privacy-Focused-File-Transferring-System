require('dotenv').config({ path: '../Assignment2/Project_432/backend/.env' });
const { findTamperedEntries } = require('../Assignment2/Project_432/backend/src/services/portfolioIntegrity');
const { query } = require('../Assignment2/Project_432/backend/src/config/db');

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
