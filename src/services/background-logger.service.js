// src/services/background-logger.service.js
import { query } from "../db/pool.js";
import { globalClients } from "./ws-registry.js";

export async function logBackgroundProgress(userId, sessionId, taskType, message) {
  console.log(`[BG-LOG][${taskType}][Session: ${sessionId || "none"}] ${message}`);

  // 1. Broadcast live to the active session via WebSockets
  if (sessionId) {
    const ws = globalClients.get(sessionId);
    if (ws && ws.readyState === 1) {
      ws.send(
        JSON.stringify({
          event: "background_log",
          taskType,
          message,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  // 2. Persist in database
  if (userId) {
    try {
      await query(
        `INSERT INTO background_logs (user_id, session_id, task_type, message)
         VALUES ($1, $2, $3, $4)`,
        [userId, sessionId, taskType, message]
      );
    } catch (err) {
      console.error("Failed to save background log:", err.message);
    }
  }
}
