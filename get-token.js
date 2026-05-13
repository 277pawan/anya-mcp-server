import { google } from "googleapis";
import { CONFIG } from "./src/config/config.js";
import http from "http";
import { URL } from "url";
import open from "open";

// For MCP server/CLI tools, use localhost with any port
const REDIRECT_URI = "http://localhost:3000";

const oauth2Client = new google.auth.OAuth2(
  CONFIG.GOOGLE_CLIENT_ID,
  CONFIG.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://mail.google.com/"
];

// CRITICAL: access_type=offline AND prompt=consent
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // Forces a new refresh token
  redirect_uri: REDIRECT_URI, // Explicitly set it
});

console.log("\n🔐 Starting local server to capture the token...");
console.log("\nPlease authorize the app in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for redirect...");

// Start a local server to listen for the redirect
const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:3000`);
    
    // We only care about requests with a "code" query param
    const code = reqUrl.searchParams.get("code");
    
    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization successful!</h1><p>You can close this tab and return to your terminal.</p>');
      
      console.log("\n✅ Authorization code received! Exchanging for tokens...");
      
      const { tokens } = await oauth2Client.getToken(code);
      
      console.log("\n✅ SUCCESS! Update your .env or config file with this:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("\nThis token now works for both Gmail and Calendar.");
      
      // Close the server and exit
      server.close(() => process.exit(0));
    } else if (reqUrl.searchParams.get("error")) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Authorization failed</h1><p>Error: ${reqUrl.searchParams.get("error")}</p>`);
      console.error("\n❌ Error from Google:", reqUrl.searchParams.get("error"));
      server.close(() => process.exit(1));
    }
  } catch (error) {
    console.error("\n❌ Error exchanging code for tokens:", error.message);
    if (error.response?.data) {
      console.error("Details:", error.response.data);
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error while exchanging token.');
    server.close(() => process.exit(1));
  }
});

server.listen(3000, () => {
  // Automatically open the browser
  try {
    open(authUrl);
  } catch (e) {
    // Ignore error if `open` fails, user can manually click
  }
});
