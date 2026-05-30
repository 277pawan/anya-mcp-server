// src/routes/focus.routes.js
// Express API Router for Pawan's Focus OS Tracker & Developer Metrics

import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

const DEFAULT_USER_ID = '89968338-6678-48e0-be01-f8472e550e1d'; // Pawan's user ID

// ── Daily Check-in Endpoints ────────────────────────────────────────────────

// UPSERT Daily Check-in Metrics
router.post('/checkin', async (req, res) => {
  const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
  const {
    protein_hit,
    workout_done,
    water_glasses,
    skipped_meal,
    unusual_food,
    dsa_solved,
    xp_earned
  } = req.body;

  try {
    const queryText = `
      INSERT INTO focus_daily_checkins 
        (user_id, checkin_date, protein_hit, workout_done, water_glasses, skipped_meal, unusual_food, dsa_solved, xp_earned)
      VALUES 
        ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, checkin_date)
      DO UPDATE SET
        protein_hit = EXCLUDED.protein_hit,
        workout_done = EXCLUDED.workout_done,
        water_glasses = EXCLUDED.water_glasses,
        skipped_meal = EXCLUDED.skipped_meal,
        unusual_food = COALESCE(EXCLUDED.unusual_food, focus_daily_checkins.unusual_food),
        dsa_solved = EXCLUDED.dsa_solved,
        xp_earned = focus_daily_checkins.xp_earned + EXCLUDED.xp_earned,
        created_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(queryText, [
      userId,
      protein_hit || 'no',
      workout_done || false,
      water_glasses || 0,
      skipped_meal || false,
      unusual_food || null,
      dsa_solved || false,
      xp_earned || 0
    ]);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[FocusAPI] Check-in error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Today's Check-in Metrics
router.get('/checkin/today', async (req, res) => {
  const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
  try {
    const queryText = `
      SELECT * FROM focus_daily_checkins
      WHERE user_id = $1 AND checkin_date = CURRENT_DATE;
    `;
    const result = await pool.query(queryText, [userId]);
    
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[FocusAPI] Fetch check-in error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Study Roadmap Endpoints ─────────────────────────────────────────────────

// UPSERT Study Roadmap Topic progress
router.post('/roadmap', async (req, res) => {
  const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
  const { topic_id, topic_name, pillar, read_status, confidence, notes } = req.body;

  try {
    const queryText = `
      INSERT INTO focus_study_roadmap
        (user_id, topic_id, topic_name, pillar, read_status, confidence, last_reviewed, notes)
      VALUES
        ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)
      ON CONFLICT (user_id, topic_id)
      DO UPDATE SET
        read_status = EXCLUDED.read_status,
        confidence = EXCLUDED.confidence,
        notes = EXCLUDED.notes,
        last_reviewed = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(queryText, [
      userId,
      topic_id,
      topic_name,
      pillar,
      read_status || false,
      confidence || 0,
      notes || null
    ]);

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[FocusAPI] Roadmap update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Roadmap Syllabus progress
router.get('/roadmap', async (req, res) => {
  const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
  try {
    const queryText = `
      SELECT * FROM focus_study_roadmap
      WHERE user_id = $1
      ORDER BY created_at ASC;
    `;
    const result = await pool.query(queryText, [userId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[FocusAPI] Fetch roadmap error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
