// src/services/nudge.service.js
import { query, withTransaction } from '../db/pool.js';

export async function listNudges(userId, { category, from, to, limit = 50, offset = 0 } = {}) {
  let sql = `SELECT * FROM nudges WHERE user_id = $1`;
  const params = [userId];
  let i = 2;
  if (category) { sql += ` AND category = $${i++}`; params.push(category); }
  if (from)     { sql += ` AND delivered_at >= $${i++}`; params.push(from); }
  if (to)       { sql += ` AND delivered_at <= $${i++}`; params.push(to); }
  sql += ` ORDER BY delivered_at DESC LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);
  const { rows } = await query(sql, params);
  return rows;
}

export async function recordNudge(userId, { category, theme = 'normal', slot, message }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO nudges (user_id, category, theme, slot, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userId, category, theme, slot || null, message || null]
    );
    await client.query(
      `UPDATE users SET total_nudges_sent = total_nudges_sent + 1, updated_at = now() WHERE id = $1`,
      [userId]
    );
    const weekStart = getMonday();
    await client.query(
      `INSERT INTO weekly_stats (user_id, week_start, category, count)
       VALUES ($1,$2,$3,1)
       ON CONFLICT (user_id, week_start, category) DO UPDATE SET count = weekly_stats.count + 1, updated_at = now()`,
      [userId, weekStart, category]
    );
    return rows[0];
  });
}

export async function engageNudge(userId, nudgeId, engaged = true) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE nudges SET engaged = $3, engaged_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [nudgeId, userId, engaged]
    );
    if (rows.length && engaged) {
      await client.query(
        `UPDATE users SET total_nudges_engaged = total_nudges_engaged + 1, updated_at = now() WHERE id = $1`,
        [userId]
      );
    }
    return rows[0] || null;
  });
}

export async function getNudgesCountToday(userId) {
  const { rows } = await query(
    `SELECT COUNT(*) as count FROM nudges
     WHERE user_id = $1 AND delivered_at >= date_trunc('day', now())`,
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

export async function getNudgeCategories(userId) {
  const { rows } = await query(
    `SELECT * FROM nudge_categories WHERE user_id = $1 ORDER BY category`, [userId]
  );
  return rows;
}

export async function updateNudgeCategory(userId, category, { enabled, weight, themes }) {
  const { rows } = await query(
    `UPDATE nudge_categories SET
       enabled = COALESCE($3, enabled),
       weight  = COALESCE($4, weight),
       themes  = COALESCE($5, themes),
       updated_at = now()
     WHERE user_id = $1 AND category = $2 RETURNING *`,
    [userId, category, enabled ?? null, weight ?? null, themes || null]
  );
  return rows[0] || null;
}

export async function getNudgeSchedule(userId) {
  const { rows } = await query(
    `SELECT * FROM nudge_schedule WHERE user_id = $1 ORDER BY slot_time`, [userId]
  );
  return rows;
}

export async function updateNudgeScheduleSlot(userId, slot, { slot_time, categories, description, enabled }) {
  const { rows } = await query(
    `UPDATE nudge_schedule SET
       slot_time   = COALESCE($3, slot_time),
       categories  = COALESCE($4, categories),
       description = COALESCE($5, description),
       enabled     = COALESCE($6, enabled),
       updated_at  = now()
     WHERE user_id = $1 AND slot = $2 RETURNING *`,
    [userId, slot, slot_time || null, categories || null, description || null, enabled ?? null]
  );
  return rows[0] || null;
}

function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

export async function getLastNudgeTime(userId) {
  const { rows } = await query(
    `SELECT delivered_at FROM nudges
     WHERE user_id = $1
     ORDER BY delivered_at DESC LIMIT 1`,
    [userId]
  );
  return rows.length ? new Date(rows[0].delivered_at) : null;
}
