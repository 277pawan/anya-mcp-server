// src/db/seed.js — Seed user data from userContext.json into PostgreSQL
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { withTransaction } from './pool.js';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Valid nudge_category_enum values — must match 001_init.sql exactly
const VALID_CATS = new Set([
  'health', 'mind', 'business', 'tech', 'body', 'motivation', 'innovation', 'reflection'
]);

async function seed() {
  const raw = readFileSync(join(__dirname, '../dummydata/userContext.json'), 'utf8');
  const ctx = JSON.parse(raw);
  const { profile, preferences, lifeEngine } = ctx;

  console.log('Seeding user data from userContext.json...');

  await withTransaction(async (client) => {

    // 1. Insert / upsert user
    const targetUserId = process.env.DEFAULT_USER_ID || '89968338-6678-48e0-be01-f8472e550e1d';
    const userRes = await client.query(
      `INSERT INTO users (
         id, name, email, contact, github_url, linkedin_url, timezone, location,
         availability, edu_degree, edu_university, edu_year, edu_cgpa,
         rate_min, rate_max, rate_currency,
         streak, longest_streak, current_mood,
         total_nudges_sent, total_nudges_engaged, preferences
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         contact = EXCLUDED.contact,
         streak = EXCLUDED.streak,
         longest_streak = EXCLUDED.longest_streak,
         current_mood = EXCLUDED.current_mood,
         total_nudges_sent = EXCLUDED.total_nudges_sent,
         preferences = EXCLUDED.preferences,
         updated_at = now()
       RETURNING id`,
      [
        targetUserId,
        profile.name, profile.email, profile.contact,
        profile.github, profile.linkedin,
        profile.timezone, profile.location, profile.availability,
        profile.education.degree, profile.education.university,
        profile.education.year, profile.education.cgpa,
        profile.hourlyRate.min, profile.hourlyRate.max, profile.hourlyRate.currency,
        lifeEngine.streak, lifeEngine.longestStreak, lifeEngine.currentMood || 5,
        lifeEngine.totalNudgesSent || 0, lifeEngine.totalNudgesEngaged || 0,
        JSON.stringify({
          autoApplyThreshold:    preferences.autoApplyThreshold,
          maxApplicationsPerDay: preferences.maxApplicationsPerDay,
          excludedCompanies:     preferences.excludedCompanies,
          technologies:          preferences.technologies,
          notifications:         preferences.notifications,
          preferredWorkTypes:    profile.preferredWorkTypes,
          preferredJobTypes:     profile.preferredJobTypes,
          preferredLocations:    profile.preferredLocations,
          industries:            profile.industries,
        }),
      ]
    );
    const userId = userRes.rows[0].id;
    console.log('   OK User upserted:', userId);

    // 2. Skills
    await client.query(`DELETE FROM user_skills WHERE user_id = $1`, [userId]);
    const skillCategories = {
      language:  profile.skills.languages,
      framework: profile.skills.frameworks,
      database:  profile.skills.databases,
      cloud:     profile.skills.cloud,
      ai_tool:   profile.skills.ai_tools,
      protocol:  profile.skills.protocols,
      other:     profile.skills.other,
    };
    for (const [category, names] of Object.entries(skillCategories)) {
      for (const name of (names || [])) {
        await client.query(
          `INSERT INTO user_skills (user_id, category, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [userId, category, name]
        );
      }
    }
    console.log('   OK Skills seeded');

    // 3. Work types
    await client.query(`DELETE FROM user_work_types WHERE user_id = $1`, [userId]);
    for (const type of (profile.preferredWorkTypes || [])) {
      await client.query(
        `INSERT INTO user_work_types (user_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, type]
      );
    }
    console.log('   OK Work types seeded');

    // 4. Experience
    await client.query(`DELETE FROM experience WHERE user_id = $1`, [userId]);
    for (let i = 0; i < (profile.experience || []).length; i++) {
      const exp = profile.experience[i];
      await client.query(
        `INSERT INTO experience (user_id, company, role, duration, highlights, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, exp.company, exp.role, exp.duration, exp.highlights || [], i]
      );
    }
    console.log('   OK Experience seeded');

    // 5. Projects
    await client.query(`DELETE FROM projects WHERE user_id = $1`, [userId]);
    for (let i = 0; i < (profile.projects || []).length; i++) {
      const p = profile.projects[i];
      await client.query(
        `INSERT INTO projects (user_id, name, type, description, highlights, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, p.name, p.type, p.description, p.highlights || [], i]
      );
    }
    console.log('   OK Projects seeded');

    // 6. Goals
    for (const g of (lifeEngine.personalGoals || [])) {
      await client.query(
        `INSERT INTO goals (user_id, title, category, status)
         VALUES ($1,$2,$3,'active') ON CONFLICT DO NOTHING`,
        [userId, g.title, g.category]
      );
    }
    console.log('   OK Goals seeded');

    // 7. Nudge Categories
    for (const [category, cfg] of Object.entries(lifeEngine.nudgeCategories || {})) {
      await client.query(
        `INSERT INTO nudge_categories (user_id, category, enabled, weight, themes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, category) DO UPDATE
           SET enabled = EXCLUDED.enabled, weight = EXCLUDED.weight,
               themes = EXCLUDED.themes, updated_at = now()`,
        [userId, category, cfg.enabled, cfg.weight, cfg.themes || []]
      );
    }
    console.log('   OK Nudge categories seeded');

    // 8. Nudge Schedule
    // userContext.json mixes theme names ("hydration","sleep","movement") into the categories array.
    // Filter to only valid nudge_category_enum values before inserting.
    for (const [slot, cfg] of Object.entries(lifeEngine.nudgeSchedule || {})) {
      const validCats = (cfg.categories || [])
        .map(c => c.toLowerCase())
        .filter(c => VALID_CATS.has(c));

      await client.query(
        `INSERT INTO nudge_schedule (user_id, slot, slot_time, categories, description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, slot) DO UPDATE
           SET slot_time = EXCLUDED.slot_time,
               categories = EXCLUDED.categories,
               description = EXCLUDED.description,
               updated_at = now()`,
        [userId, slot, cfg.time, validCats, cfg.description || null]
      );
    }
    console.log('   OK Nudge schedule seeded');

    // 9. Historical nudges
    const themeMap = { normal: 'normal', rabbit_hole: 'rabbit_hole', deep_dive: 'deep_dive', quick_hit: 'quick_hit' };
    for (const n of (lifeEngine.receivedNudges || [])) {
      const rawTheme = (n.theme || 'normal').toLowerCase().replace(/\s+/g, '_');
      const theme = themeMap[rawTheme] || 'normal';
      const category = n.category.toLowerCase();
      // Skip nudges with invalid category
      if (!VALID_CATS.has(category)) continue;
      await client.query(
        `INSERT INTO nudges (user_id, category, theme, message, engaged, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, category, theme, n.message || null, n.engaged || null, new Date(n.timestamp)]
      );
    }
    console.log('   OK Historical nudges seeded');

    // 10. Weekly stats
    const weekStart = getMonday(new Date()).toISOString().split('T')[0];
    for (const [category, count] of Object.entries(lifeEngine.weeklyStats || {})) {
      if (count > 0) {
        await client.query(
          `INSERT INTO weekly_stats (user_id, week_start, category, count)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, week_start, category) DO UPDATE SET count = EXCLUDED.count`,
          [userId, weekStart, category, count]
        );
      }
    }
    console.log('   OK Weekly stats seeded');

    console.log('\nSeed complete!');
    console.log('\nAdd this to your .env:');
    console.log('DEFAULT_USER_ID=' + userId);
  });

  await pool.end();
  process.exit(0);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  console.error(err);
  process.exit(1);
});
