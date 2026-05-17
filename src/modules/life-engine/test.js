import { LifeEngine } from "./index.js";
import dotenv from "dotenv";

dotenv.config({ path: "../../../.env" }); // Ensure AI keys are loaded

async function runTests() {
  console.log("🚀 Starting Anya Life Engine Test...");

  // Trigger a single nudge
  await LifeEngine.triggerNudge();

  // Test weekly report
  await LifeEngine.generateWeeklyReport();

  console.log("✅ Test complete. Check dummydata/userContext.json to see state updates.");
}

runTests();
