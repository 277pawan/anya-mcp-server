import { query } from '../db/pool.js';

const uid = (req) => req.userId || process.env.DEFAULT_USER_ID;

export async function getWeeklyReports(req, res) {
  try {
    const { rows } = await query(
      `SELECT * FROM weekly_reports WHERE user_id = $1 ORDER BY week_start DESC LIMIT 10`,
      [uid(req)]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
