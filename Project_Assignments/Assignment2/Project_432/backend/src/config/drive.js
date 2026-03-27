const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

let driveClient;

function getDriveClient() {
  if (driveClient) return driveClient;

  // Option 1: User OAuth2 (Best for Personal Drive)
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  }

  // Option 2: Service Account (Best for Shared Drives)
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  const candidates = [
    configured,
    "./service-account.json",
    "./service_account.json"
  ].filter(Boolean);

  const keyFile = candidates.find((p) => fs.existsSync(path.resolve(process.cwd(), p)));

  if (keyFile) {
    const keyPath = path.resolve(process.cwd(), keyFile);
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ["https://www.googleapis.com/auth/drive"]
    });
    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  }

  throw new Error(
    "Drive credentials not found. Configure GOOGLE_CLIENT_ID, SECRET, and REFRESH_TOKEN for personal drives, or GOOGLE_SERVICE_ACCOUNT_KEY_FILE for shared drives."
  );
}

module.exports = {
  getDriveClient
};
