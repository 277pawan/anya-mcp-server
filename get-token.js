import { google } from "googleapis";
import * as readline from "readline";

const oauth2Client = new google.auth.OAuth2(
  "YOUR_CLIENT_ID",
  "YOUR_CLIENT_SECRET",
  "urn:ietf:wg:oauth:2.0:oob", // desktop app redirect
);

const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/calendar.readonly"],
});

console.log("\n✅ Open this URL in your browser:\n");
console.log(url);
console.log("\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Paste the code from browser here: ", async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  console.log("\n✅ Your refresh token:\n");
  console.log(tokens.refresh_token);
  console.log("\nAdd this to your .env as GOOGLE_REFRESH_TOKEN=...\n");
  rl.close();
});
