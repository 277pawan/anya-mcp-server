// src/services/user.service.js
import { query, withTransaction } from '../db/pool.js';

export async function getUserProfile(userId) {
  const { rows } = await query(
    `SELECT u.*,
       COALESCE(
         json_agg(DISTINCT jsonb_build_object('category', s.category, 'name', s.name))
         FILTER (WHERE s.id IS NOT NULL), '[]'
       ) AS skills,
       COALESCE(
         json_agg(DISTINCT wt.type) FILTER (WHERE wt.id IS NOT NULL), '[]'
       ) AS work_types
     FROM users u
     LEFT JOIN user_skills s    ON s.user_id = u.id
     LEFT JOIN user_work_types wt ON wt.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  );
  return rows[0] || null;
}

export async function updateUserProfile(userId, fields) {
  const allowed = [
    'name', 'contact', 'github_url', 'linkedin_url', 'location', 'availability', 
    'current_mood', 'timezone', 'edu_degree', 'edu_university', 'edu_year', 
    'edu_cgpa', 'rate_min', 'rate_max', 'rate_currency', 'streak', 'longest_streak'
  ];
  const sets = [], values = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = $${i++}`); values.push(v); }
  }
  if (!sets.length) throw new Error('No valid fields to update');
  values.push(userId);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

export async function getSkills(userId) {
  const { rows } = await query(
    `SELECT category, json_agg(name ORDER BY name) AS names
     FROM user_skills WHERE user_id = $1
     GROUP BY category ORDER BY category`,
    [userId]
  );
  return rows;
}

export async function replaceSkills(userId, skills) {
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM user_skills WHERE user_id = $1`, [userId]);
    for (const { category, name } of skills) {
      if (category && name) {
        await client.query(
          `INSERT INTO user_skills (user_id, category, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [userId, category, name]
        );
      }
    }
    const { rows } = await client.query(
      `SELECT category, json_agg(name ORDER BY name) AS names
       FROM user_skills WHERE user_id = $1 GROUP BY category ORDER BY category`,
      [userId]
    );
    return rows;
  });
}

export async function getGoals(userId, status = null) {
  const base = `SELECT * FROM goals WHERE user_id = $1`;
  const cond = status ? ` AND status = $2` : '';
  const order = ` ORDER BY created_at DESC`;
  const params = status ? [userId, status] : [userId];
  const { rows } = await query(base + cond + order, params);
  return rows;
}

export async function createGoal(userId, { title, description, category, target_date }) {
  const { rows } = await query(
    `INSERT INTO goals (user_id, title, description, category, target_date)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, title, description||null, category||null, target_date||null]
  );
  return rows[0];
}

export async function updateGoal(userId, goalId, { title, description, status, progress, target_date }) {
  const { rows } = await query(
    `UPDATE goals SET
       title = COALESCE($3, title),
       description = COALESCE($4, description),
       status = COALESCE($5, status),
       progress = COALESCE($6, progress),
       target_date = COALESCE($7, target_date),
       completed_at = CASE WHEN $5 = 'completed' THEN now() ELSE completed_at END,
       updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [goalId, userId, title||null, description||null, status||null, progress||null, target_date||null]
  );
  return rows[0] || null;
}

export async function deleteGoal(userId, goalId) {
  const { rowCount } = await query(
    `DELETE FROM goals WHERE id = $1 AND user_id = $2`, [goalId, userId]
  );
  return rowCount > 0;
}

export async function getPreferences(userId) {
  const { rows } = await query(`SELECT preferences FROM users WHERE id = $1`, [userId]);
  return rows[0]?.preferences || {};
}

export async function updatePreferences(userId, prefs) {
  const { rows } = await query(
    `UPDATE users SET preferences = preferences || $2::jsonb, updated_at = now()
     WHERE id = $1 RETURNING preferences`,
    [userId, JSON.stringify(prefs)]
  );
  return rows[0]?.preferences || {};
}

export async function replaceWorkTypes(userId, workTypes) {
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM user_work_types WHERE user_id = $1`, [userId]);
    for (const type of workTypes) {
      if (type) {
        // Enums must match: 'remote', 'contract', 'freelance', 'full-time', 'part-time', 'hybrid'
        const normalized = type.toLowerCase().trim();
        await client.query(
          `INSERT INTO user_work_types (user_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, normalized]
        );
      }
    }
    const { rows } = await client.query(
      `SELECT type FROM user_work_types WHERE user_id = $1`,
      [userId]
    );
    return rows.map(r => r.type);
  });
}
