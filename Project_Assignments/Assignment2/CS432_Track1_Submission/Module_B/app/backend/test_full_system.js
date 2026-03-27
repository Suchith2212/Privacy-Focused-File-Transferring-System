const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { uploadBuffer } = require("./src/services/driveService");
const { query } = require("./src/config/db");

async function testEverything() {
  try {
    console.log("--- TEST 1: DATABASE ---");
    const dbTest = await query("SELECT 1");
    console.log("Database connection successful!", dbTest);

    console.log("\n--- TEST 2: DRIVE UPLOAD ---");
    const testBuffer = Buffer.from("Hello, this is a test upload.");
    const result = await uploadBuffer({
      buffer: testBuffer,
      fileName: "test_upload_" + Date.now() + ".txt",
      mimeType: "text/plain"
    });
    console.log("Drive upload successful!", result);
    
  } catch (err) {
    console.error("\nTEST FAILED:");
    console.error("Error Message:", err.message);
    if (err.errors) console.error("Drive Errors:", JSON.stringify(err.errors, null, 2));
    if (err.code) console.error("Error Code:", err.code);
    process.exitCode = 1;
  }

  process.exit();
}

testEverything();
