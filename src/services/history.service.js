// src/services/history.service.js
import { query } from '../db/pool.js';

export async function getMCPCallHistory(userId, { tool, from, limit = 50, offset = 0 } = {}) {
  let sql = `SELECT * FROM mcp_tool_calls WHERE user_id = $1`;
  const params = [userId];
  let i = 2;
  if (tool) { sql += ` AND tool = $${i++}`; params.push(tool); }
  if (from) { sql += ` AND called_at >= $${i++}`; params.push(from); }
  sql += ` ORDER BY called_at DESC LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

export async function getAICallHistory(userId, { provider, from, limit = 50, offset = 0 } = {}) {
  let sql = `SELECT * FROM ai_model_calls WHERE user_id = $1`;
  const params = [userId];
  let i = 2;
  if (provider) { sql += ` AND provider = $${i++}`; params.push(provider); }
  if (from)     { sql += ` AND called_at >= $${i++}`; params.push(from); }
  sql += ` ORDER BY called_at DESC LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

export async function getAICallStats(userId) {
  const { rows } = await query(
    `SELECT
       provider,
       COUNT(*)                           AS total_calls,
       SUM(CASE WHEN success THEN 1 END)  AS successful,
       SUM(CASE WHEN NOT success THEN 1 END) AS failed,
       ROUND(AVG(latency_ms))             AS avg_latency_ms,
       SUM(total_tokens)                  AS total_tokens
     FROM ai_model_calls
     WHERE user_id = $1
     GROUP BY provider
     ORDER BY total_calls DESC`,
    [userId]
  );
  return rows;
}

export async function getLeadSearchHistory(userId, { limit = 30, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT id, query, result_count, source, searched_at
     FROM lead_searches WHERE user_id = $1
     ORDER BY searched_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

export async function getLeadSearchById(userId, id) {
  const { rows } = await query(
    `SELECT * FROM lead_searches WHERE id = $1 AND user_id = $2`, [id, userId]
  );
  return rows[0] || null;
}

export async function getNotificationHistory(userId, { unread, type, limit = 50, offset = 0 } = {}) {
  let sql = `SELECT * FROM notifications WHERE user_id = $1`;
  const params = [userId];
  let i = 2;
  if (unread !== undefined) { sql += ` AND read = $${i++}`; params.push(!unread); }
  if (type) { sql += ` AND type = $${i++}`; params.push(type); }
  sql += ` ORDER BY sent_at DESC LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

export async function markNotificationRead(userId, notifId) {
  const { rows } = await query(
    `UPDATE notifications SET read = true, read_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [notifId, userId]
  );
  return rows[0] || null;
}

export async function markAllNotificationsRead(userId) {
  const { rows } = await query(
    `UPDATE notifications SET read = true, read_at = now()
     WHERE user_id = $1 AND read = false
     RETURNING id`,
    [userId]
  );
  return { updated: rows.length };
}
