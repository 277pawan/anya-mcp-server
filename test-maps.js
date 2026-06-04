import { searchNearbyPlaces } from './src/mcp/mcp-client.js';
import { initAllMCPServers } from './src/mcp/mcp-client.js';

async function run() {
  await initAllMCPServers();
  console.log("Testing searchNearbyPlaces...");
  const res = await searchNearbyPlaces("Connaught Place", 2000, "hospital");
  console.log(JSON.stringify(res, null, 2));
  
  console.log("Testing with healthcare.hospital...");
  const res2 = await searchNearbyPlaces("Connaught Place", 2000, "healthcare.hospital");
  console.log(JSON.stringify(res2, null, 2));
  process.exit(0);
}
run().catch(console.error);
