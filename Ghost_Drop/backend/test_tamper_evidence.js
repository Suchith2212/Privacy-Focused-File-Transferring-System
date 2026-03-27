require('dotenv').config();
const { findTamperedEntries } = require('./src/services/portfolioIntegrity');

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
