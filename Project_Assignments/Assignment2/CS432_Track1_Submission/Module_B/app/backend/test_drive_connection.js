const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { getDriveClient } = require("./src/config/drive");

async function testDrive() {
  try {
    console.log("Testing Drive connection...");
    console.log("Key File:", process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
    console.log("Folder ID:", process.env.GOOGLE_DRIVE_FOLDER_ID);
    
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    console.log("Attempting to list files in folder...");
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    
    console.log("Success! Files found:", res.data.files.length);
    res.data.files.forEach(f => console.log(` - ${f.name} (${f.id})`));
    
  } catch (err) {
    console.error("DRIVE ERROR:", err.message);
    if (err.errors) {
      console.error("Details:", JSON.stringify(err.errors, null, 2));
    }
  }
}

testDrive();
