// src/services/lifeEngine.service.js
import { query, withTransaction } from '../db/pool.js';

export async function getLifeEngineState(userId) {
  const [userRes, statsRes, moodRes] = await Promise.all([
    query(
      `SELECT streak, longest_streak, current_mood, total_nudges_sent,
              total_nudges_engaged, streak_start, last_active_date
       FROM users WHERE id = $1`,
      [userId]
    ),
    query(
      `SELECT category, count FROM weekly_stats
       WHERE user_id = $1 AND week_start = date_trunc('week', now())::date
       ORDER BY category`,
      [userId]
    ),
    query(
      `SELECT mood, note, logged_at FROM mood_history
       WHERE user_id = $1 ORDER BY logged_at DESC LIMIT 7`,
      [userId]
    ),
  ]);
  if (!userRes.rows[0]) return null;
  return { ...userRes.rows[0], weekly_stats: statsRes.rows, recent_moods: moodRes.rows };
}

export async function updateStreak(userId, { streak, longest_streak, streak_start }) {
  const { rows } = await query(
    `UPDATE users SET
       streak         = COALESCE($2, streak),
       longest_streak = COALESCE($3, longest_streak),
       streak_start   = COALESCE($4, streak_start),
       last_active_date = CURRENT_DATE,
       updated_at = now()
     WHERE id = $1
     RETURNING streak, longest_streak, streak_start, last_active_date`,
    [userId, streak ?? null, longest_streak ?? null, streak_start ?? null]
  );
  return rows[0];
}

export async function incrementStreak(userId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT streak, longest_streak, last_active_date FROM users WHERE id = $1`, [userId]
    );
    const user = rows[0];
    const today = new Date().toISOString().split('T')[0];
    const lastActive = user.last_active_date?.toISOString().split('T')[0];
    if (lastActive === today) return user;

    const prevDay = getPreviousDay(today);
    const newStreak = lastActive === prevDay ? user.streak + 1 : 1;
    const newLongest = Math.max(newStreak, user.longest_streak || 0);

    const updated = await client.query(
      `UPDATE users SET streak = $2, longest_streak = $3, last_active_date = $4, updated_at = now()
       WHERE id = $1 RETURNING streak, longest_streak, last_active_date`,
      [userId, newStreak, newLongest, today]
    );
    return updated.rows[0];
  });
}

export async function logMood(userId, mood, note) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO mood_history (user_id, mood, note) VALUES ($1,$2,$3) RETURNING *`,
      [userId, mood, note || null]
    );
    await client.query(
      `UPDATE users SET current_mood = $2, updated_at = now() WHERE id = $1`, [userId, mood]
    );
    return rows[0];
  });
}

export async function getMoodHistory(userId, { days = 30, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT mood, note, logged_at FROM mood_history
     WHERE user_id = $1 AND logged_at >= now() - ($2 || ' days')::interval
     ORDER BY logged_at DESC LIMIT $3`,
    [userId, days, limit]
  );
  return rows;
}

export async function getWeeklyStats(userId, weekStart = null) {
  const params = weekStart ? [userId, weekStart] : [userId];
  const dateExpr = weekStart ? '$2' : `date_trunc('week', now())::date`;
  const { rows } = await query(
    `SELECT category, count FROM weekly_stats
     WHERE user_id = $1 AND week_start = ${dateExpr}
     ORDER BY count DESC`,
    params
  );
  return rows;
}

export async function getEngagementSummary(userId) {
  const { rows } = await query(
    `SELECT
       total_nudges_sent,
       total_nudges_engaged,
       ROUND(CASE WHEN total_nudges_sent > 0
         THEN (total_nudges_engaged::numeric / total_nudges_sent) * 100
         ELSE 0 END, 1) AS engagement_rate,
       streak, longest_streak, current_mood
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || {};
}

function getPreviousDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
