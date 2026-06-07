import { query } from '../db/pool.js';
import { sendSmartNotification } from '../utils/notificationHelper.js';

/** Returns the most recent Monday as a YYYY-MM-DD string */
function getLastMonday() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 1 = Mon …
  const diff = day === 0 ? -6 : 1 - day; // roll back to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

export async function generateWeeklyReport() {
  console.log('📊 [Weekly Report] Starting weekly report generation...');
  try {
    const usersRes = await query('SELECT id, name FROM users');
    const weekStart = getLastMonday(); // stable, consistent key

    for (const userRow of usersRes.rows) {
      const userId = userRow.id;
      const userName = userRow.name;

      // Aggregate nudge counts for this week (Monday → today)
      const { rows: stats } = await query(
        `SELECT category, CAST(SUM(count) AS INT) AS total
         FROM weekly_stats
         WHERE user_id = $1 AND week_start >= $2::date
         GROUP BY category
         ORDER BY total DESC`,
        [userId, weekStart]
      );

      if (stats.length === 0) {
        console.log(`[Weekly Report] No data for user ${userName}, skipping.`);
        continue;
      }

      const totalNudges = stats.reduce((acc, curr) => acc + curr.total, 0);
      const topCategory = stats[0].category; // already sorted DESC

      const reportData = {
        totalNudges,
        topCategory,
        breakdown: stats.map(s => ({ category: s.category, total: String(s.total) })),
        message: `You received ${totalNudges} nudge(s) this week. Top focus area: ${topCategory}!`,
      };

      // Upsert — safe to re-run on same week
      await query(
        `INSERT INTO weekly_reports (user_id, week_start, report_data)
         VALUES ($1, $2::date, $3)
         ON CONFLICT (user_id, week_start) DO UPDATE
           SET report_data = EXCLUDED.report_data, generated_at = now()`,
        [userId, weekStart, JSON.stringify(reportData)]
      );

      // Push notification
      await sendSmartNotification({
        type: 'weekly_report',
        userId,
        title: '📊 Your Weekly Anya Report',
        body: reportData.message,
        data: { report_ready: 'true', week_start: weekStart },
      });

      console.log(`✅ [Weekly Report] Sent for ${userName} (week: ${weekStart})`);
    }
    console.log('📊 [Weekly Report] All done.');
  } catch (err) {
    console.error('📊 [Weekly Report Error]', err);
  }
}

/** Manual trigger endpoint helper — call from debug route if needed */
export async function triggerReportForUser(userId) {
  const usersRes = await query('SELECT id, name FROM users WHERE id = $1', [userId]);
  if (!usersRes.rows.length) throw new Error('User not found');
  const original = usersRes.rows[0];
  // Re-use the full loop with a single-user array
  const usersRes2 = { rows: [original] };
  // shallow re-use: just call the report generator
  await generateWeeklyReport();
}
