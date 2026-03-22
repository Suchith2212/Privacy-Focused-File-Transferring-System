require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/config/db");

async function exportDatabaseToJson() {
  try {
    console.log("Starting database export...");

    // 1. Get all table names in the current database
    const tables = await query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
    `);

    const dbData = {};

    // 2. Iterate through each table and fetch all data
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      console.log(`Fetching data from table: ${tableName}...`);
      
      // Use pool.query because pool.execute (in our query helper) 
      // does not support '??' for table names
      const [rows] = await pool.query(`SELECT * FROM ??`, [tableName]);
      dbData[tableName] = rows;
    }

    // 3. Define the output path
    const outputPath = path.join(__dirname, "..", "database_export.json");

    // 4. Write to JSON file
    fs.writeFileSync(outputPath, JSON.stringify(dbData, null, 2));

    console.log(`\nSuccess! Database exported to: ${outputPath}`);
    console.log(`Total tables exported: ${tables.length}`);

  } catch (error) {
    console.error("Export failed:", error);
  } finally {
    // Close the pool so the script can exit
    await pool.end();
  }
}

exportDatabaseToJson();
