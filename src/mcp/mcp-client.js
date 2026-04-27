// src/mcp/mcp-client.js - UPDATED with correct paths
import { spawn } from "child_process";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

function cleanMCPParams(params) {
  const cleaned = {};
  for (const [key, value] of Object.entries(params)) {
    // Skip null, undefined, empty strings, NaN
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !Number.isNaN(value)
    ) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
class MCPClient {
  constructor() {
    this.servers = new Map();
    this.tools = new Map();
    this.nextId = 1;
  }

  /**
   * Start an MCP server
   */
  startServer(name, filePath) {
    // Get absolute path to the MCP file
    const absolutePath = path.resolve(__dirname, filePath);

    const serverProcess = spawn("node", [absolutePath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.servers.set(name, {
      process: serverProcess,
      name: name,
      isReady: false,
      tools: [],
    });

    // Log output
    serverProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      if (output.includes("✅") || output.includes("running")) {
        this.servers.get(name).isReady = true;
      }
    });

    return serverProcess;
  }

  /**
   * Wait for server to be ready
   */
  async waitForServer(name, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const server = this.servers.get(name);
      if (server && server.isReady) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  /**
   * Register a tool
   */
  registerTool(toolName, serverName) {
    this.tools.set(toolName, serverName);
    const server = this.servers.get(serverName);
    if (server) {
      server.tools.push(toolName);
    }
  }

  /**
   * Call a tool
   */

  async callTool(toolName, params = {}) {
    // Clean parameters first
    const cleanedParams = cleanMCPParams(params);

    const serverName = this.tools.get(toolName);

    if (!serverName) {
      throw new Error(
        `Tool "${toolName}" not registered. Available: ${Array.from(this.tools.keys()).join(", ")}`,
      );
    }

    const server = this.servers.get(serverName);
    if (!server || !server.process) {
      throw new Error(`Server "${serverName}" not running`);
    }

    const id = this.nextId++;
    const request = {
      jsonrpc: "2.0",
      id: id,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: cleanedParams, // Use cleaned params!
      },
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tool "${toolName}" timeout after 30s`));
      }, 30000);

      const handler = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === id) {
            clearTimeout(timeout);
            server.process.stdout.off("data", handler);

            // Check for MCP error response
            if (response.result?.isError) {
              reject(
                new Error(response.result.content[0]?.text || "MCP tool error"),
              );
            } else {
              resolve(response);
            }
          }
        } catch (e) {
          // Not JSON, ignore
        }
      };

      server.process.stdout.on("data", handler);
      server.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  /**
   * Get all registered tools
   */
  listTools() {
    return Array.from(this.tools.entries()).map(([tool, server]) => ({
      tool,
      server,
    }));
  }

  /**
   * Get server status
   */
  getStatus() {
    const status = {};
    for (const [name, server] of this.servers.entries()) {
      status[name] = {
        isReady: server.isReady,
        tools: server.tools,
        pid: server.process?.pid,
      };
    }
    return status;
  }

  /**
   * Shutdown all servers
   */
  shutdown() {
    for (const [name, server] of this.servers.entries()) {
      if (server.process) {
        server.process.kill("SIGTERM");
      }
    }
  }
}

// Singleton instance
const mcpClient = new MCPClient();

// ============================================
// EXPORT SIMPLE FUNCTIONS
// ============================================

// Initialize all MCP servers (call ONCE at startup)
export async function initAllMCPServers() {
  // Start Calendar MCP (path relative to src/mcp/)
  mcpClient.startServer("calendar", "./calender-mcp.js"); // Note: calender-mcp.js (spelling!)
  await mcpClient.waitForServer("calendar");
  mcpClient.registerTool("getMyCalendarDataByDate", "calendar");

  // Start Maps MCP
  mcpClient.startServer("maps", "./maps-mcp.js");
  await mcpClient.waitForServer("maps");
  mcpClient.registerTool("geocodeAddress", "maps");
  mcpClient.registerTool("reverseGeocode", "maps");
  mcpClient.registerTool("searchNearbyPlaces", "maps");
  mcpClient.registerTool("getPlaceDetails", "maps");
  mcpClient.registerTool("getDirections", "maps");
  mcpClient.registerTool("getDistance", "maps");
  mcpClient.registerTool("searchPlaces", "maps");

  // Start Books MCP
  mcpClient.startServer("books", "./books-mcp.js");
  await mcpClient.waitForServer("books");
  mcpClient.registerTool("searchBooks", "books");
  mcpClient.registerTool("getBookDetails", "books");
  mcpClient.registerTool("searchBooksByAuthor", "books");

  return mcpClient;
}

// Calendar Functions
export async function getCalendar(date) {
  try {
    const result = await mcpClient.callTool("getMyCalendarDataByDate", {
      date,
    });
    if (result && result.result && result.result.content) {
      return JSON.parse(result.result.content[0].text);
    }
    return { error: "No response from calendar server" };
  } catch (error) {
    return { error: error.message };
  }
}

// Maps Functions
export async function geocode(address) {
  try {
    const result = await mcpClient.callTool("geocodeAddress", { address });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function reverseGeocode(lat, lng) {
  try {
    const result = await mcpClient.callTool("reverseGeocode", { lat, lng });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function searchNearbyPlaces(
  location,
  radius = 1000,
  type = null,
  keyword = null,
) {
  try {
    const result = await mcpClient.callTool("searchNearbyPlaces", {
      location,
      radius,
      type,
      keyword,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function getPlaceDetails(placeId) {
  try {
    const result = await mcpClient.callTool("getPlaceDetails", {
      place_id: placeId,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function getDirections(origin, destination, mode = "driving") {
  try {
    const result = await mcpClient.callTool("getDirections", {
      origin,
      destination,
      mode,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function getDistance(origins, destinations, mode = "driving") {
  try {
    const result = await mcpClient.callTool("getDistance", {
      origins,
      destinations,
      mode,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function searchPlaces(query) {
  try {
    const result = await mcpClient.callTool("searchPlaces", { query });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

// Books Functions
export async function searchBooks(query, maxResults = 10, language = null) {
  try {
    const result = await mcpClient.callTool("searchBooks", {
      query,
      maxResults,
      language,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function getBookDetails(volumeId) {
  try {
    const result = await mcpClient.callTool("getBookDetails", {
      volume_id: volumeId,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

export async function searchBooksByAuthor(author, maxResults = 10) {
  try {
    const result = await mcpClient.callTool("searchBooksByAuthor", {
      author,
      maxResults,
    });
    return JSON.parse(result.result.content[0].text);
  } catch (error) {
    return { error: error.message };
  }
}

// Utility
export function getMCPStatus() {
  return mcpClient.getStatus();
}

export function listMCPTools() {
  return mcpClient.listTools();
}

export function shutdownMCP() {
  mcpClient.shutdown();
}

export { mcpClient };
