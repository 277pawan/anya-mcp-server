import { google } from "googleapis";
import readline from "readline";
import { CONFIG } from "./src/config/config.js";

// For MCP server/CLI tools, use localhost with any port
const REDIRECT_URI = "http://localhost:3000"; // or "http://localhost" or "http://localhost:8080"

const oauth2Client = new google.auth.OAuth2(
  CONFIG.GOOGLE_CLIENT_ID,
  CONFIG.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
);

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// CRITICAL: access_type=offline AND prompt=consent
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // Forces a new refresh token
  redirect_uri: REDIRECT_URI, // Explicitly set it
});

console.log("\n🔐 Go to this URL:\n");
console.log(authUrl);
console.log("\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("📋 Paste the authorization code here: ", async (code) => {
  rl.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log("\n✅ SUCCESS! Add these to your config:\n");
    console.log(`GOOGLE_CLIENT_ID=${CONFIG.GOOGLE_CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CONFIG.GOOGLE_CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n⚠️ Keep this refresh token secret!\n");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.response?.data) {
      console.error("Details:", error.response.data);
    }
  }
});
