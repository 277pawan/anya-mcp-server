// src/routes/admin.routes.js
// Internal admin/diagnostic routes — model health dashboard, system status.
// These are NOT user-facing routes.

import { Router } from "express";
import { getAllModelHealth, getLiveHealthCache } from "../services/model-health.service.js";

const router = Router();

/**
 * GET /api/admin/model-health
 *
 * Returns the health status of all AI models from the database.
 * Includes: is_healthy, last_error, total_calls, success_rate, avg_latency.
 *
 * Example response:
 * {
 *   "summary": { "total": 8, "healthy": 7, "failed": 1 },
 *   "models": [
 *     { "provider": "gemini", "model": "gemini-2.0-flash", "is_healthy": true, ... },
 *     { "provider": "gemini", "model": "gemini-1.5-flash", "is_healthy": false,
 *       "last_error": "404: model deprecated" },
 *     ...
 *   ]
 * }
 */
router.get("/model-health", async (req, res) => {
  try {
    const models  = await getAllModelHealth();
    const healthy = models.filter(m => m.is_healthy).length;
    const failed  = models.filter(m => !m.is_healthy).length;

    res.json({
      success: true,
      summary: {
        total:   models.length,
        healthy,
        failed,
        health_pct: models.length
          ? Math.round((healthy / models.length) * 100)
          : 0,
      },
      models,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/model-health/live
 *
 * Returns the in-memory live cache (resets on server restart).
 * More real-time than the DB view, but no historical data.
 */
router.get("/model-health/live", (req, res) => {
  const models  = getLiveHealthCache();
  const healthy = models.filter(m => m.lastFailure === null || (m.lastSuccess && m.lastSuccess > m.lastFailure)).length;

  res.json({
    success: true,
    note: "This is the in-memory cache. Resets on server restart. Use /model-health for persisted data.",
    summary: { total: models.length, healthy, failed: models.length - healthy },
    models,
  });
});

export default router;
