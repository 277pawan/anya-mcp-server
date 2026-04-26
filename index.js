// index.js - Main entry point in root directory
import dotenv from "dotenv";
import {
  initAllMCPServers,
  getMCPStatus,
  listMCPTools,
  shutdownMCP,
  getCalendar,
  searchNearbyPlaces,
  geocode,
  searchBooks,
} from "./src/mcp/mcp-client.js";
import {
  routeUserMessage,
  getStatus as getAIRouterStatus,
} from "./src/ai-intent/ai-intent-router.js";

dotenv.config();

console.log("🚀 ANYA MCP SERVER - Complete Test Suite");
console.log("=".repeat(60));

/**
 * Test 1: Initialize all MCP servers
 */
async function testMCPServers() {
  console.log("\n📡 TEST 1: Starting MCP Servers\n");

  await initAllMCPServers();

  console.log("\n📊 MCP Server Status:");
  console.table(getMCPStatus());

  console.log("\n🔧 Registered Tools:");
  console.table(listMCPTools());
}

/**
 * Test 2: Test Calendar MCP directly
 */
async function testCalendarMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("📅 TEST 2: Calendar MCP Direct Call\n");

  const today = new Date().toISOString().split("T")[0];
  console.log(`📆 Fetching calendar for: ${today}`);

  const calendarData = await getCalendar(today);
  console.log("✅ Calendar Data:", JSON.stringify(calendarData, null, 2));
}

/**
 * Test 3: Test Maps MCP directly
 */
async function testMapsMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("🗺️ TEST 3: Maps MCP Direct Call\n");

  console.log("📍 Geocoding 'Connaught Place, New Delhi':");
  const geoResult = await geocode("Connaught Place, New Delhi");
  console.log("✅ Geocode Result:", JSON.stringify(geoResult, null, 2));

  console.log("\n🏥 Searching nearby hospitals:");
  const placesResult = await searchNearbyPlaces(
    "Connaught Place, New Delhi",
    2000,
    "hospital",
  );
  console.log("✅ Places Result:", JSON.stringify(placesResult, null, 2));
}

/**
 * Test 4: Test Books MCP directly
 */
async function testBooksMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("📚 TEST 4: Books MCP Direct Call\n");

  console.log("📖 Searching for 'system design' books:");
  const booksResult = await searchBooks("system design", 5);
  console.log("✅ Books Result:", JSON.stringify(booksResult, null, 2));
}

/**
 * Test 5: Test AI Router with MCP Integration
 */
async function testAIRouter() {
  console.log("\n" + "=".repeat(60));
  console.log("🤖 TEST 5: AI Router with MCP Integration\n");

  const testCases = ["hi how are you", "find hospitals near Connaught Place"];

  for (const testCase of testCases) {
    console.log(`\n📝 Input: "${testCase}"`);
    console.log("-".repeat(40));

    const result = await routeUserMessage(testCase);
    console.log("✅ Result:", JSON.stringify(result, null, 2));
    console.log("-".repeat(40));
  }
}

/**
 * Main function
 */
async function main() {
  try {
    await testMCPServers();
    // await testAIRouter();

    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Shutting down...");
      shutdownMCP();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
    shutdownMCP();
    process.exit(1);
  }
}

main().catch(console.error);
