/**
 * CLI Utility to rotate the SUB_TOKEN_SECRET_KEY.
 * Reads all rows from the sub_token_secrets table, decrypts them using the old key seed,
 * re-encrypts them using the new key seed, and updates them inside a database transaction.
 * 
 * Usage:
 *   node scripts/rotateSubTokenKey.js --oldKey="<old_seed>" --newKey="<new_seed>"
 */
require("dotenv").config();
const { query, getConnection, pool } = require("../src/config/db");
const crypto = require("crypto");

// Parse arguments
const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith("--")) {
    const [key, val] = arg.split("=");
    args[key.slice(2)] = val;
  }
});

const oldKeySeed = args.oldKey;
const newKeySeed = args.newKey;

if (!oldKeySeed || !newKeySeed) {
  console.error("❌ Error: Both --oldKey and --newKey are required.");
  console.log('Usage: node scripts/rotateSubTokenKey.js --oldKey="<old_seed>" --newKey="<new_seed>"');
  process.exit(1);
}

function deriveKey(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest();
}

function decrypt(ciphertextHex, ivHex, tagHex, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final()
  ]);
  return {
    ciphertextHex: ciphertext.toString("hex"),
    ivHex: iv.toString("hex"),
    tagHex: cipher.getAuthTag().toString("hex")
  };
}

async function runRotation() {
  console.log("🔄 Starting sub-token encryption key rotation...");
  
  const oldKey = deriveKey(oldKeySeed);
  const newKey = deriveKey(newKeySeed);
  
  let conn;
  try {
    conn = await getConnection();
    
    // Check if table exists
    const [tableCheck] = await conn.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'sub_token_secrets'
    `);
    
    if (tableCheck[0].count === 0) {
      console.log("ℹ️  sub_token_secrets table does not exist or has not been initialized. Nothing to rotate.");
      process.exit(0);
    }

    // Get all encrypted sub-tokens
    const [rows] = await conn.query(`
      SELECT inner_token_id, secret_ciphertext, secret_iv, secret_auth_tag 
      FROM sub_token_secrets 
      WHERE secret_ciphertext IS NOT NULL
    `);
    
    if (rows.length === 0) {
      console.log("✅ No encrypted sub-token records found. Rotation complete.");
      process.exit(0);
    }
    
    console.log(`Found ${rows.length} records to process. Starting transaction...`);
    await conn.beginTransaction();
    
    let rotatedCount = 0;
    for (const row of rows) {
      try {
        // 1. Decrypt with old key
        const plaintext = decrypt(
          row.secret_ciphertext,
          row.secret_iv,
          row.secret_auth_tag,
          oldKey
        );
        
        // 2. Re-encrypt with new key
        const { ciphertextHex, ivHex, tagHex } = encrypt(plaintext, newKey);
        
        // 3. Update database
        await conn.execute(
          `
          UPDATE sub_token_secrets 
          SET secret_ciphertext = ?, secret_iv = ?, secret_auth_tag = ?, updated_at = NOW() 
          WHERE inner_token_id = ?
          `,
          [ciphertextHex, ivHex, tagHex, row.inner_token_id]
        );
        
        rotatedCount++;
      } catch (err) {
        throw new Error(`Failed decrypting/re-encrypting token ID ${row.inner_token_id}: ${err.message}`);
      }
    }
    
    await conn.commit();
    console.log(`🎉 Success! Successfully rotated ${rotatedCount} sub-token secret records.`);
  } catch (error) {
    console.error("❌ Key rotation failed:", error.message);
    if (conn) {
      console.log("🔄 Rolling back database transaction...");
      await conn.rollback().catch(() => {});
    }
    process.exit(1);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

runRotation();
