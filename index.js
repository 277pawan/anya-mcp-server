// index.js — Anya MCP Server — Main Entry Point
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root with explicit path
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { URL } from "url";

// Routes barrel — all API routes in one import
import { registerRoutes } from "./src/routes/index.js";

// WebSocket streaming service
import { streamMessage } from "./src/services/chat.service.js";

// MCP servers + test utilities
import {
  initAllMCPServers,
  shutdownMCP,
  getCalendar,
  searchNearbyPlaces,
  geocode,
  searchBooks,
} from "./src/mcp/mcp-client.js";
import { routeUserMessage } from "./src/ai-intent/ai-intent-router.js";
import { findLeadsForProposal } from "./src/search/leadPipeline.js";
import { addClient, removeClient } from "./src/services/ws-registry.js";
import { startLifeEngine } from "./src/services/life-engine.service.js";
import { runMigrations } from "./src/db/migrate.js";
import { runSeed } from "./src/db/seed.js";
import { initHealthCacheFromDb } from "./src/services/model-health.service.js";



const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-User-Id",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Inject userId — from header or DEFAULT_USER_ID env (single-user setup)
app.use((req, _res, next) => {
  req.userId = req.headers["x-user-id"] || process.env.DEFAULT_USER_ID;
  next();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    service: "anya-mcp-server",
  });
});

// ---------------------------------------------------------------------------
// Debug Utilities (dev only — no auth guard needed for single-user Anya)
// ---------------------------------------------------------------------------
import cron from "node-cron";

/** GET /debug/cron-status — list all scheduled cron tasks and their state */
app.get("/debug/cron-status", (_req, res) => {
  try {
    const tasks = cron.getTasks(); // Map<taskId, ScheduledTask> — node-cron v4
    const taskList = [];
    tasks.forEach((task, _key) => {
      taskList.push({
        id: task.id,
        name: task.name,
        expression: task.cronExpression,
        timezone: task.timezone ?? "system",
        state: task.stateMachine?.state ?? "unknown",
      });
    });
    res.json({
      cronLibrary: "node-cron",
      version: "4.x",
      scheduledTaskCount: taskList.length,
      tasks: taskList,
      scheduleInfo: {
        lifeEngine: "every 30 minutes  →  */30 * * * *",
        chatCleanup: "daily at 02:00 AM →  0 2 * * *",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /debug/fire-notification — manually fire a test notification */
app.post("/debug/fire-notification", async (req, res) => {
  try {
    const { sendSmartNotification } =
      await import("./src/utils/notificationHelper.js");
    const {
      type = "custom",
      title = "Anya Test 🔔",
      body = "This is a test notification from Anya!",
      token,
    } = req.body;
    const userId = req.userId || "89968338-6678-48e0-be01-f8472e550e1d";
    const result = await sendSmartNotification({
      type,
      userId,
      token,
      title,
      body,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
// Root status check
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    message: "Anya MCP Server is running",
    time: new Date().toISOString(),
  });
});

registerRoutes(app);

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: "Route not found" }));

// ---------------------------------------------------------------------------
// HTTP Server (shared with WebSocket)
// ---------------------------------------------------------------------------
const server = createServer(app);

// Disable all timeouts — required for WebSocket + streaming
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

// ---------------------------------------------------------------------------
// WebSocket — ws://localhost:PORT/ws/chat/:sessionId
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

// Heartbeat ping every 30s to keep long-lived connections alive
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

wss.on("connection", (ws, _req, { sessionId, userId }) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  addClient(sessionId, ws);

  console.log(`[WS] connected — session: ${sessionId}`);
  ws.send(JSON.stringify({ event: "connected", sessionId }));

  ws.on("close", () => {
    ws.isCancelled = true;
    removeClient(sessionId);
    console.log(`[WS] disconnected — session: ${sessionId}`);
  });

  ws.on("message", async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.event === "cancel") {
        console.log(`[WS] Received cancel request for session: ${sessionId}`);
        ws.isCancelled = true;
        return;
      }
      const { content } = msg;
      if (!content?.trim()) {
        return ws.send(
          JSON.stringify({ event: "error", message: "content is required" }),
        );
      }
      // Reset cancel state for new generation
      ws.isCancelled = false;
      // Stream AI response — no timeout, event-driven chunks
      await streamMessage(ws, userId, sessionId, content.trim());
    } catch (err) {
      console.error("[WS] error:", err);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ event: "error", message: err.message }));
      }
    }
  });

  ws.on("error", (err) => console.error("[WS] socket error:", err));
});

// Upgrade HTTP → WebSocket only for /ws/chat/:sessionId
server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const match = pathname.match(/^\/ws\/chat\/([a-f0-9-]+)$/i);
  if (!match) return socket.destroy();

  const sessionId = match[1];
  const userId =
    req.headers["x-user-id"] ||
    new URL(req.url, `http://${req.headers.host}`).searchParams.get("userId") ||
    process.env.DEFAULT_USER_ID;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, { sessionId, userId });
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  clearInterval(pingInterval);
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));
  server.close(() => {
    console.log("HTTP server closed");
    shutdownMCP();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// DEV UTILITIES — uncomment calls inside boot() to test individual systems
// ---------------------------------------------------------------------------

async function testCalendarMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Calendar MCP Direct Call\n");
  const today = new Date().toISOString().split("T")[0];
  const calendarData = await getCalendar(today);
  console.log("Calendar Data:", JSON.stringify(calendarData, null, 2));
}

async function testMapsMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Maps MCP Direct Call\n");
  const geoResult = await geocode("Connaught Place, New Delhi");
  console.log("Geocode Result:", JSON.stringify(geoResult, null, 2));
  const placesResult = await searchNearbyPlaces(
    "Connaught Place, New Delhi",
    2000,
    "hospital",
  );
  console.log("Places Result:", JSON.stringify(placesResult, null, 2));
}

async function testBooksMCP() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Books MCP Direct Call\n");
  const booksResult = await searchBooks("system design", 5);
  console.log("Books Result:", JSON.stringify(booksResult, null, 2));
}

async function testAIRouter() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: AI Router with MCP Integration\n");
  const testCases = [
    "hey what is your name?",
    "find hospitals near Connaught Place",
  ];
  for (const testCase of testCases) {
    console.log(`\nInput: "${testCase}"`);
    const result = await routeUserMessage(testCase);
    console.log("Result:", JSON.stringify(result, null, 2));
  }
}

async function testLeadPipeline() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST: Lead Pipeline\n");
  const query = "search freelancing jobs for me in web development";
  console.log(`Query: "${query}"`);
  const result = await routeUserMessage(query);
  console.log("Result:", JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Database migrations complete!\n");

    console.log("Running database seeding...");
    await runSeed();
    console.log("Database seeding check complete!\n");

    console.log("Loading model health cache...");
    await initHealthCacheFromDb();
    console.log("Model health cache loaded!\n");

    console.log("Initializing MCP servers...");
    await initAllMCPServers();
    // await testAIRouter()
    // await testLeadPipeline()
    console.log("MCP servers ready\n");

    console.log("Starting Life Engine...");
    startLifeEngine();
    console.log("Life Engine started\n");

    server.listen(PORT, () => {
      console.log(`Anya API Server   → http://localhost:${PORT}`);
      console.log(
        `WebSocket         → ws://localhost:${PORT}/ws/chat/:sessionId`,
      );
      console.log(`Health            → http://localhost:${PORT}/health\n`);
      console.log("Routes:");
      console.log(
        "  GET/PUT  /api/user/profile | /skills | /goals | /preferences",
      );
      console.log(
        "  CRUD     /api/chat/session(s)  |  POST /message  |  WS /ws/chat/:id",
      );
      console.log(
        "  GET/PUT  /api/life-engine/state | /streak | /mood | /stats/*",
      );
      console.log("  CRUD     /api/nudges  |  /categories  |  /schedule");
      console.log(
        "  GET      /api/history/mcp-calls | /ai-calls | /leads | /notifications\n",
      );
    });
  } catch (err) {
    console.error("Boot failed:", err);
    process.exit(1);
  }
}

boot();
