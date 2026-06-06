// model-health.service.js
// Tracks which AI models are working, failing, and why.
// Every call to Gemini/Groq/etc. reports its result here.
//
// Data is written to the `ai_model_health` table (see migration below).
// You can query it via GET /api/admin/model-health to see live status.

import { query } from "../db/pool.js";

// ─── In-Memory Cache (survives one restart, low-overhead) ──────────────────
// Keyed by "provider/model" e.g. "gemini/gemini-2.0-flash"
const healthCache = new Map();

/**
 * Record one model call result.
 * Fire-and-forget — never blocks the caller.
 *
 * @param {string} provider    e.g. "gemini", "groq", "mistral"
 * @param {string} model       e.g. "gemini-2.0-flash", "llama-3.3-70b-versatile"
 * @param {boolean} success    true = worked, false = failed
 * @param {number}  latencyMs  how long the call took (0 on failure)
 * @param {string}  errorMsg   only on failure — the error message/reason
 */
export function recordModelHealth(provider, model, success, latencyMs = 0, errorMsg = null) {
  // Update in-memory cache immediately
  const key = `${provider}/${model}`;
  const now = new Date();
  const existing = healthCache.get(key) || {
    provider, model,
    totalCalls: 0, successCalls: 0, failCalls: 0,
    lastSuccess: null, lastFailure: null,
    lastErrorMsg: null, avgLatencyMs: 0,
  };

  existing.totalCalls++;
  if (success) {
    existing.successCalls++;
    existing.lastSuccess = now;
    existing.avgLatencyMs = Math.round(
      (existing.avgLatencyMs * (existing.successCalls - 1) + latencyMs) / existing.successCalls
    );
  } else {
    existing.failCalls++;
    existing.lastFailure = now;
    existing.lastErrorMsg = errorMsg;
  }
  healthCache.set(key, existing);

  // Persist to DB async (non-blocking)
  persistToDb(provider, model, success, latencyMs, errorMsg, now).catch((e) =>
    console.warn("[ModelHealth] DB write failed:", e.message)
  );
}

async function persistToDb(provider, model, success, latencyMs, errorMsg, timestamp) {
  // Upsert: update existing row or create it
  await query(
    `INSERT INTO ai_model_health
       (provider, model, last_checked_at, is_healthy, last_error, total_calls, success_calls, fail_calls, avg_latency_ms)
     VALUES ($1, $2, $3, $4, $5, 1, $6::int, $7::int, $8)
     ON CONFLICT (provider, model) DO UPDATE SET
       last_checked_at = EXCLUDED.last_checked_at,
       is_healthy      = EXCLUDED.is_healthy,
       last_error      = CASE WHEN EXCLUDED.is_healthy THEN NULL ELSE EXCLUDED.last_error END,
       total_calls     = ai_model_health.total_calls + 1,
       success_calls   = ai_model_health.success_calls + $6::int,
       fail_calls      = ai_model_health.fail_calls + $7::int,
       avg_latency_ms  = CASE
         WHEN EXCLUDED.is_healthy THEN
           ROUND((ai_model_health.avg_latency_ms * ai_model_health.success_calls + $8) /
                 (ai_model_health.success_calls + $6::int))
         ELSE ai_model_health.avg_latency_ms
       END,
       updated_at      = now()`,
    [
      provider,
      model,
      timestamp,
      success,               // is_healthy
      errorMsg,              // last_error
      success ? 1 : 0,       // success increment
      success ? 0 : 1,       // fail increment
      success ? latencyMs : 0,
    ]
  );
}

/**
 * Get health status of all tracked models.
 * Returns from DB for persistence across restarts.
 */
export async function getAllModelHealth() {
  const { rows } = await query(
    `SELECT
       provider,
       model,
       is_healthy,
       last_checked_at,
       last_error,
       total_calls,
       success_calls,
       fail_calls,
       avg_latency_ms,
       CASE WHEN total_calls > 0
         THEN ROUND((success_calls::numeric / total_calls * 100), 1)
         ELSE 0
       END AS success_rate_pct,
       updated_at
     FROM ai_model_health
     ORDER BY provider, model`,
    []
  );
  return rows;
}

/**
 * Get in-memory live cache (no DB hit needed, resets on restart).
 */
export function getLiveHealthCache() {
  return Array.from(healthCache.values());
}

/**
 * Pre-populate the in-memory health cache from the database at startup.
 */
export async function initHealthCacheFromDb() {
  try {
    const { rows } = await query(
      `SELECT provider, model, is_healthy, last_checked_at, last_error, total_calls, success_calls, fail_calls, avg_latency_ms 
       FROM ai_model_health`
    );
    for (const row of rows) {
      const key = `${row.provider}/${row.model}`;
      healthCache.set(key, {
        provider: row.provider,
        model: row.model,
        totalCalls: row.total_calls,
        successCalls: row.success_calls,
        failCalls: row.fail_calls,
        lastSuccess: row.is_healthy ? new Date(row.last_checked_at) : null,
        lastFailure: !row.is_healthy ? new Date(row.last_checked_at) : null,
        lastErrorMsg: row.last_error,
        avgLatencyMs: row.avg_latency_ms,
      });
    }
    console.log(`ℹ️ [ModelHealth] Loaded ${healthCache.size} model health record(s) from DB.`);
  } catch (err) {
    console.warn("⚠️ [ModelHealth] Failed to load health cache from DB:", err.message);
  }
}
