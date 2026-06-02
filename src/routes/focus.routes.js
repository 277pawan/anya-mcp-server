// src/routes/focus.routes.js
// Focus OS API — XP/Level backend tracking, weekly reset, roadmap.sh proxy,
// nutrition API proxy, content caching

import { Router } from 'express';
import pool from '../db/pool.js';
import fetch from 'node-fetch';

const router = Router();
const UID = '89968338-6678-48e0-be01-f8472e550e1d';
const uid = (req) => req.headers['x-user-id'] || UID;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the Monday of the ISO week containing `date` */
function getWeekMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** XP required per level = 100 XP × level multiplier (flat for now) */
const XP_PER_LEVEL = 100;
const calcLevel = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;

/**
 * Ensure user XP row exists & check if a new week has started.
 * If yes → snapshot previous week, reset weekly_xp to 0.
 */
async function ensureWeeklyReset(userId) {
  const client = await pool.connect();
  try {
    const monday = getWeekMonday();
    const mondayStr = monday.toISOString().split('T')[0];

    const res = await client.query(
      'SELECT total_xp, current_level, weekly_xp, week_start_date FROM users WHERE id = $1',
      [userId]
    );
    if (!res.rows.length) return;

    const user = res.rows[0];
    const storedWeek = user.week_start_date
      ? new Date(user.week_start_date).toISOString().split('T')[0]
      : null;

    if (storedWeek && storedWeek !== mondayStr) {
      // New week — snapshot old week then reset
      const prevMonday = new Date(storedWeek);
      const prevSunday = new Date(prevMonday);
      prevSunday.setDate(prevMonday.getDate() + 6);

      // Aggregate daily checkins for the closed week
      const stats = await client.query(
        `SELECT 
          COUNT(*) AS days_checked_in,
          SUM(CASE WHEN workout_done THEN 1 ELSE 0 END) AS workout_days,
          SUM(CASE WHEN dsa_solved THEN 1 ELSE 0 END) AS dsa_solved_count,
          AVG(water_glasses)::NUMERIC(4,1) AS avg_water,
          SUM(xp_earned) AS xp_sum
         FROM focus_daily_checkins
         WHERE user_id = $1 AND checkin_date BETWEEN $2 AND $3`,
        [userId, storedWeek, prevSunday.toISOString().split('T')[0]]
      );
      const s = stats.rows[0];

      const topicsRead = await client.query(
        `SELECT COUNT(*) FROM focus_study_roadmap WHERE user_id = $1 AND read_status = true`,
        [userId]
      );

      await client.query(
        `INSERT INTO focus_weekly_snapshots
          (user_id, week_start, week_end, final_level, total_xp_earned,
           days_checked_in, workout_days, dsa_solved_count, topics_read_count, avg_water_glasses)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (user_id, week_start) DO NOTHING`,
        [
          userId, storedWeek, prevSunday.toISOString().split('T')[0],
          user.current_level, s.xp_sum || 0,
          parseInt(s.days_checked_in) || 0,
          parseInt(s.workout_days) || 0,
          parseInt(s.dsa_solved_count) || 0,
          parseInt(topicsRead.rows[0].count) || 0,
          parseFloat(s.avg_water) || 0,
        ]
      );

      // Reset weekly XP + level back to 1, new week start
      await client.query(
        `UPDATE users SET weekly_xp = 0, current_level = 1, week_start_date = $1 WHERE id = $2`,
        [mondayStr, userId]
      );
      console.log(`[Focus] Weekly reset complete for user ${userId}. Week starting ${mondayStr}`);
    } else if (!storedWeek) {
      await client.query(
        `UPDATE users SET week_start_date = $1 WHERE id = $2`,
        [mondayStr, userId]
      );
    }
  } finally {
    client.release();
  }
}

// ─── XP & Level Endpoints ─────────────────────────────────────────────────────

// GET current XP state (total, weekly, level, week_start)
router.get('/xp', async (req, res) => {
  const userId = uid(req);
  try {
    await ensureWeeklyReset(userId);
    const r = await pool.query(
      'SELECT total_xp, current_level, weekly_xp, week_start_date FROM users WHERE id = $1',
      [userId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST earn XP — adds to both total_xp and weekly_xp, recalculates level
router.post('/xp/earn', async (req, res) => {
  const userId = uid(req);
  const { points = 0, reason = 'action' } = req.body;
  if (!points || points <= 0) return res.status(400).json({ success: false, error: 'points must be > 0' });

  try {
    await ensureWeeklyReset(userId);

    const r = await pool.query(
      `UPDATE users
       SET total_xp     = total_xp + $1,
           weekly_xp    = weekly_xp + $1,
           current_level = FLOOR((weekly_xp + $1) / ${XP_PER_LEVEL}) + 1
       WHERE id = $2
       RETURNING total_xp, weekly_xp, current_level, week_start_date`,
      [points, userId]
    );

    console.log(`[Focus XP] +${points} XP (${reason}) → total:${r.rows[0]?.total_xp}`);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all weekly snapshots (history)
router.get('/weekly/history', async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT * FROM focus_weekly_snapshots WHERE user_id = $1 ORDER BY week_start DESC LIMIT 12`,
      [userId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Daily Check-in Endpoints ─────────────────────────────────────────────────

router.post('/checkin', async (req, res) => {
  const userId = uid(req);
  const { protein_hit, workout_done, water_glasses, skipped_meal, unusual_food, dsa_solved, xp_earned } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO focus_daily_checkins
        (user_id, checkin_date, protein_hit, workout_done, water_glasses, skipped_meal, unusual_food, dsa_solved, xp_earned)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, checkin_date) DO UPDATE SET
        protein_hit   = EXCLUDED.protein_hit,
        workout_done  = EXCLUDED.workout_done,
        water_glasses = EXCLUDED.water_glasses,
        skipped_meal  = EXCLUDED.skipped_meal,
        unusual_food  = COALESCE(EXCLUDED.unusual_food, focus_daily_checkins.unusual_food),
        dsa_solved    = EXCLUDED.dsa_solved,
        xp_earned     = focus_daily_checkins.xp_earned + EXCLUDED.xp_earned,
        created_at    = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, protein_hit || 'no', workout_done || false, water_glasses || 0,
       skipped_meal || false, unusual_food || null, dsa_solved || false, xp_earned || 0]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/checkin/today', async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT * FROM focus_daily_checkins WHERE user_id = $1 AND checkin_date = CURRENT_DATE`,
      [userId]
    );
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Study Roadmap Endpoints ───────────────────────────────────────────────────

router.post('/roadmap', async (req, res) => {
  const userId = uid(req);
  const { topic_id, topic_name, pillar, read_status, confidence, notes } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO focus_study_roadmap (user_id, topic_id, topic_name, pillar, read_status, confidence, last_reviewed, notes)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,$7)
       ON CONFLICT (user_id, topic_id) DO UPDATE SET
        read_status = EXCLUDED.read_status,
        confidence  = EXCLUDED.confidence,
        notes       = EXCLUDED.notes,
        last_reviewed = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, topic_id, topic_name, pillar, read_status || false, confidence || 0, notes || null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/roadmap', async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT * FROM focus_study_roadmap WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Roadmap.sh / GitHub Raw Proxy with DB Cache ──────────────────────────────
// Fetches roadmap JSON from roadmap.sh GitHub, parses topic nodes, caches in DB.
// Frontend calls this — works offline after first successful fetch.

const ROADMAP_SOURCES = {
  frontend: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/frontend/frontend.json',
  backend: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/backend/backend.json',
  fullstack: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/full-stack/full-stack.json',
  systemdesign: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/system-design/system-design.json',
  devops: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/devops/devops.json',
  dsa: 'https://raw.githubusercontent.com/kamranahmedse/developer-roadmap/master/src/data/roadmaps/datastructures-and-algorithms/datastructures-and-algorithms.json',
};

// Parse roadmap.sh JSON graph → flat checklist array
function parseRoadmapNodes(json) {
  const nodes = json?.nodes || [];
  const topics = [];
  for (const node of nodes) {
    const type = node?.type;
    const label = node?.data?.label || node?.data?.title || '';
    if (!label || label.length < 2) continue;
    // Include topic, subtopic, and leaf node types
    if (['topic', 'subtopic', 'leaf-node', 'todo'].includes(type)) {
      topics.push({
        id: node.id,
        topic: label.trim(),
        pillar: node?.data?.group || type || 'General',
        type,
      });
    }
  }
  return topics;
}

router.get('/content/roadmap/:type', async (req, res) => {
  const userId = uid(req);
  const roadmapType = req.params.type?.toLowerCase();
  const cacheKey = `roadmap:${roadmapType}`;

  if (!ROADMAP_SOURCES[roadmapType]) {
    return res.status(400).json({ success: false, error: `Unknown roadmap type: ${roadmapType}` });
  }

  try {
    // 1. Check DB cache (valid for 7 days)
    const cached = await pool.query(
      `SELECT content_type, links_json FROM focus_content_cache
       WHERE user_id = $1 AND cache_key = $2 AND expires_at > NOW()`,
      [userId, cacheKey]
    );

    if (cached.rows.length && cached.rows[0].links_json?.length > 0) {
      return res.json({ success: true, data: cached.rows[0].links_json, source: 'cache' });
    }

    // 2. Fetch from roadmap.sh GitHub raw
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    let topics = [];
    try {
      const response = await fetch(ROADMAP_SOURCES[roadmapType], { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const json = await response.json();
        topics = parseRoadmapNodes(json);
      }
    } catch (e) {
      console.warn(`[Roadmap Fetch] Failed: ${e.message}`);
    }

    // 3. Robust Fallback Data if GitHub raw is moved or offline
    if (!topics.length) {
      console.log('[Roadmap] Using offline fallback structure for ' + roadmapType);
      const fallbacks = {
        frontend: [
          { id: '1', topic: 'Internet Fundamentals', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'HTML Semantic Elements', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'CSS Flexbox & Grid', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'JavaScript DOM Manipulation', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'React & Component Lifecycle', pillar: 'topic', type: 'topic' },
          { id: '6', topic: 'State Management (Redux/Zustand)', pillar: 'topic', type: 'topic' },
          { id: '7', topic: 'Next.js & SSR', pillar: 'topic', type: 'topic' }
        ],
        backend: [
          { id: '1', topic: 'Internet & OSI Model', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'Node.js & Event Loop', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'Express APIs & Middleware', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'Relational Databases (PostgreSQL)', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'NoSQL (MongoDB/Redis)', pillar: 'topic', type: 'topic' },
          { id: '6', topic: 'Authentication (JWT/OAuth)', pillar: 'topic', type: 'topic' },
          { id: '7', topic: 'Docker Containerization', pillar: 'topic', type: 'topic' }
        ],
        fullstack: [
          { id: '1', topic: 'Frontend UI/UX', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'RESTful API Design', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'Database Normalization', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'CI/CD Pipelines', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'System Design Basics', pillar: 'topic', type: 'topic' }
        ],
        systemdesign: [
          { id: '1', topic: 'Client-Server Architecture', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'Network Protocols (HTTP, TCP/UDP)', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'Load Balancing & Proxies', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'Caching (Redis, Memcached)', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'Database Sharding & Replication', pillar: 'topic', type: 'topic' },
          { id: '6', topic: 'Message Queues (Kafka, RabbitMQ)', pillar: 'topic', type: 'topic' },
          { id: '7', topic: 'Microservices vs Monoliths', pillar: 'topic', type: 'topic' }
        ],
        devops: [
          { id: '1', topic: 'Linux Basics & Shell Scripting', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'Version Control (Git/GitHub)', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'CI/CD (GitHub Actions, Jenkins)', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'Containerization (Docker)', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'Container Orchestration (Kubernetes)', pillar: 'topic', type: 'topic' },
          { id: '6', topic: 'Infrastructure as Code (Terraform)', pillar: 'topic', type: 'topic' },
          { id: '7', topic: 'Monitoring (Prometheus, Grafana)', pillar: 'topic', type: 'topic' }
        ],
        dsa: [
          { id: '1', topic: 'Big-O Time & Space Complexity', pillar: 'topic', type: 'topic' },
          { id: '2', topic: 'Arrays & Strings (Two Pointers, Sliding Window)', pillar: 'topic', type: 'topic' },
          { id: '3', topic: 'Hash Maps & Sets', pillar: 'topic', type: 'topic' },
          { id: '4', topic: 'Linked Lists (Fast/Slow Pointers)', pillar: 'topic', type: 'topic' },
          { id: '5', topic: 'Stacks & Queues', pillar: 'topic', type: 'topic' },
          { id: '6', topic: 'Trees & Graphs (BFS, DFS)', pillar: 'topic', type: 'topic' },
          { id: '7', topic: 'Dynamic Programming & Memoization', pillar: 'topic', type: 'topic' }
        ]
      };
      topics = fallbacks[roadmapType] || fallbacks.frontend;
    }

    // 4. Store in cache
    await pool.query(
      `INSERT INTO focus_content_cache (user_id, cache_key, content_type, title, links_json, source_url, expires_at)
       VALUES ($1, $2, 'roadmap_list', $3, $4, $5, NOW() + INTERVAL '7 days')
       ON CONFLICT (user_id, cache_key) DO UPDATE SET
        links_json = EXCLUDED.links_json, fetched_at = NOW(), expires_at = NOW() + INTERVAL '7 days'`,
      [userId, cacheKey, `${roadmapType} Roadmap`, JSON.stringify(topics), ROADMAP_SOURCES[roadmapType]]
    );

    res.json({ success: true, data: topics, source: 'live' });
  } catch (err) {
    console.warn(`[RoadmapProxy] ${err.message} — trying stale cache`);
    // Return stale cache if available (offline fallback)
    const stale = await pool.query(
      `SELECT links_json FROM focus_content_cache WHERE user_id = $1 AND cache_key = $2`,
      [userId, cacheKey]
    );
    if (stale.rows.length && stale.rows[0].links_json?.length) {
      return res.json({ success: true, data: stale.rows[0].links_json, source: 'stale_cache' });
    }
    res.status(503).json({ success: false, error: 'Roadmap unavailable and no cache found', offline: true });
  }
});

// ─── DEV.to Article Search Proxy (real content for search) ───────────────────
// Proxies DEV.to's free API. No key required. Caches results per query.

router.get('/content/articles', async (req, res) => {
  const userId = uid(req);
  const query = (req.query.q || 'javascript').trim();
  const cacheKey = `article:${query.toLowerCase().replace(/\s+/g, '-')}`;

  try {
    // Check cache (1 day)
    const cached = await pool.query(
      `SELECT links_json FROM focus_content_cache
       WHERE user_id = $1 AND cache_key = $2 AND expires_at > NOW()`,
      [userId, cacheKey]
    );
    if (cached.rows.length && cached.rows[0].links_json?.length) {
      return res.json({ success: true, data: cached.rows[0].links_json, source: 'cache' });
    }

    // Fetch from DEV.to
    const devRes = await fetch(
      `https://dev.to/api/articles?tag=${encodeURIComponent(query)}&per_page=8&top=7`,
      { headers: { 'User-Agent': 'AnyaAI-App/1.0' }, timeout: 8000 }
    );

    let articles = [];
    if (devRes.ok) {
      const data = await devRes.json();
      articles = data.map(a => ({
        id: String(a.id),
        title: a.title,
        pillar: a.tag_list?.join(', ') || query,
        summary: a.description || '',
        readingTime: a.reading_time_minutes,
        url: a.url,
        coverImage: a.cover_image,
        author: a.user?.name,
        publishedAt: a.published_at,
        source: 'devto',
      }));
    }

    // Also try Hacker News Algolia for tech topics
    if (articles.length < 4) {
      const hnRes = await fetch(
        `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(query)}&hitsPerPage=5`,
        { timeout: 6000 }
      );
      if (hnRes.ok) {
        const hnData = await hnRes.json();
        const hnArticles = (hnData.hits || [])
          .filter(h => h.url && h.title)
          .map(h => ({
            id: h.objectID,
            title: h.title,
            pillar: query,
            summary: `${h.points || 0} points · ${h.num_comments || 0} comments`,
            url: h.url,
            author: h.author,
            source: 'hackernews',
          }));
        articles = [...articles, ...hnArticles];
      }
    }

    if (articles.length) {
      await pool.query(
        `INSERT INTO focus_content_cache (user_id, cache_key, content_type, title, links_json, expires_at)
         VALUES ($1,$2,'articles',$3,$4, NOW() + INTERVAL '1 day')
         ON CONFLICT (user_id, cache_key) DO UPDATE SET
          links_json = EXCLUDED.links_json, fetched_at = NOW(), expires_at = NOW() + INTERVAL '1 day'`,
        [userId, cacheKey, query, JSON.stringify(articles)]
      );
    }

    res.json({ success: true, data: articles, source: 'live' });
  } catch (err) {
    console.warn(`[ArticleProxy] ${err.message}`);
    const stale = await pool.query(
      `SELECT links_json FROM focus_content_cache WHERE user_id = $1 AND cache_key = $2`,
      [userId, cacheKey]
    );
    if (stale.rows.length) {
      return res.json({ success: true, data: stale.rows[0].links_json || [], source: 'stale_cache' });
    }
    res.status(503).json({ success: false, error: 'Article search unavailable', offline: true });
  }
});

// ─── Nutrition Endpoints ───────────────────────────────────────────────────────

// GET user body metrics + calculated TDEE & macro targets
router.get('/nutrition/targets', async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT weight_kg, height_cm, age_years, body_goal, activity_level FROM users WHERE id = $1`,
      [userId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'User not found' });

    const { weight_kg, height_cm, age_years, body_goal, activity_level } = r.rows[0];

    // Mifflin-St Jeor BMR (male)
    let targets = null;
    if (weight_kg && height_cm && age_years) {
      const bmr = 10 * parseFloat(weight_kg) + 6.25 * parseFloat(height_cm) - 5 * age_years + 5;
      const activityMultipliers = {
        sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9
      };
      const tdee = bmr * (activityMultipliers[activity_level] || 1.55);
      const goalAdjust = { bulk: 300, cut: -400, maintain: 0, recomp: 0 };
      const targetCalories = Math.round(tdee + (goalAdjust[body_goal] || 0));
      // Standard macro split based on goal
      const proteinG = Math.round(parseFloat(weight_kg) * (body_goal === 'cut' ? 2.2 : 1.8));
      const fatG = Math.round(targetCalories * 0.25 / 9);
      const carbsG = Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4);

      targets = {
        bmr: Math.round(bmr),
        tdee: Math.round(tdee),
        targetCalories,
        protein_g: proteinG,
        carbs_g: carbsG,
        fat_g: fatG,
        water_ml: Math.round(parseFloat(weight_kg) * 33),
        body_goal,
        activity_level,
      };
    }

    res.json({ success: true, data: { ...r.rows[0], targets } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update body metrics
router.put('/nutrition/metrics', async (req, res) => {
  const userId = uid(req);
  const { weight_kg, height_cm, age_years, body_goal, activity_level } = req.body;
  try {
    const r = await pool.query(
      `UPDATE users SET
        weight_kg = COALESCE($1, weight_kg),
        height_cm = COALESCE($2, height_cm),
        age_years = COALESCE($3, age_years),
        body_goal = COALESCE($4, body_goal),
        activity_level = COALESCE($5, activity_level)
       WHERE id = $6 RETURNING weight_kg, height_cm, age_years, body_goal, activity_level`,
      [weight_kg || null, height_cm || null, age_years || null,
       body_goal || null, activity_level || null, userId]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET — proxy Open Food Facts search
router.get('/nutrition/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ success: false, error: 'Missing search query' });

  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,nutriments,serving_size,image_thumb_url`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('Open Food Facts unavailable');

    const data = await response.json();
    const products = (data.products || [])
      .filter(p => p.product_name)
      .slice(0, 10)
      .map(p => ({
        name: p.product_name,
        calories_per100g: Math.round(p.nutriments?.['energy-kcal_100g'] || p.nutriments?.['energy_100g'] / 4.184 || 0),
        protein_per100g: parseFloat((p.nutriments?.proteins_100g || 0).toFixed(1)),
        carbs_per100g: parseFloat((p.nutriments?.carbohydrates_100g || 0).toFixed(1)),
        fat_per100g: parseFloat((p.nutriments?.fat_100g || 0).toFixed(1)),
        fiber_per100g: parseFloat((p.nutriments?.fiber_100g || 0).toFixed(1)),
        serving_size: p.serving_size || '100g',
        image: p.image_thumb_url || null,
      }));

    res.json({ success: true, data: products });
  } catch (err) {
    const qLower = query.toLowerCase();
    
    // Robust Offline Fallback Dictionary for 503 / network errors
    const localFallback = {
      'milk': [
        { name: "Whole Milk (Cow)", calories_per100g: 61, protein_per100g: 3.2, carbs_per100g: 4.8, fat_per100g: 3.3, fiber_per100g: 0, serving_size: "100g" },
        { name: "Skim Milk", calories_per100g: 35, protein_per100g: 3.4, carbs_per100g: 5.0, fat_per100g: 0.1, fiber_per100g: 0, serving_size: "100g" }
      ],
      'chicken': [
        { name: "Chicken Breast (Raw)", calories_per100g: 120, protein_per100g: 22.5, carbs_per100g: 0, fat_per100g: 2.6, fiber_per100g: 0, serving_size: "100g" },
        { name: "Chicken Thigh", calories_per100g: 177, protein_per100g: 24, carbs_per100g: 0, fat_per100g: 8, fiber_per100g: 0, serving_size: "100g" }
      ],
      'rice': [
        { name: "White Rice (Cooked)", calories_per100g: 130, protein_per100g: 2.7, carbs_per100g: 28, fat_per100g: 0.3, fiber_per100g: 0.4, serving_size: "100g" },
        { name: "Brown Rice (Cooked)", calories_per100g: 111, protein_per100g: 2.6, carbs_per100g: 23, fat_per100g: 0.9, fiber_per100g: 1.8, serving_size: "100g" }
      ],
      'egg': [
        { name: "Whole Egg (Large)", calories_per100g: 143, protein_per100g: 12.6, carbs_per100g: 0.7, fat_per100g: 9.5, fiber_per100g: 0, serving_size: "100g" },
        { name: "Egg White", calories_per100g: 52, protein_per100g: 10.9, carbs_per100g: 0.7, fat_per100g: 0.2, fiber_per100g: 0, serving_size: "100g" }
      ],
      'apple': [
        { name: "Apple (Raw)", calories_per100g: 52, protein_per100g: 0.3, carbs_per100g: 13.8, fat_per100g: 0.2, fiber_per100g: 2.4, serving_size: "100g" }
      ],
      'banana': [
        { name: "Banana", calories_per100g: 89, protein_per100g: 1.1, carbs_per100g: 22.8, fat_per100g: 0.3, fiber_per100g: 2.6, serving_size: "100g" }
      ],
      'oats': [
        { name: "Rolled Oats", calories_per100g: 389, protein_per100g: 16.9, carbs_per100g: 66.3, fat_per100g: 6.9, fiber_per100g: 10.6, serving_size: "100g" }
      ],
      'whey': [
        { name: "Whey Protein Isolate", calories_per100g: 359, protein_per100g: 80, carbs_per100g: 4.5, fat_per100g: 1.5, fiber_per100g: 0, serving_size: "100g" },
        { name: "Whey Protein Concentrate", calories_per100g: 412, protein_per100g: 75, carbs_per100g: 7, fat_per100g: 7, fiber_per100g: 0, serving_size: "100g" }
      ],
      'bread': [
        { name: "Whole Wheat Bread", calories_per100g: 252, protein_per100g: 12.4, carbs_per100g: 42.7, fat_per100g: 3.5, fiber_per100g: 6, serving_size: "100g" }
      ]
    };

    const fallbackKey = Object.keys(localFallback).find(k => qLower.includes(k));
    if (fallbackKey) {
      console.log(`[Nutrition] Offline fallback hit for: ${fallbackKey}`);
      return res.json({ success: true, data: localFallback[fallbackKey] });
    }

    res.status(503).json({ success: false, error: 'Open Food Facts unavailable and no local fallback found.' });
  }
});

// POST log a food item
router.post('/nutrition/log', async (req, res) => {
  const userId = uid(req);
  const { food_name, quantity_g, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, source } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO focus_nutrition_log
        (user_id, log_date, food_name, quantity_g, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, source)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, food_name, quantity_g || 100, calories_kcal || 0,
       protein_g || 0, carbs_g || 0, fat_g || 0, fiber_g || 0, source || 'manual']
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET today's nutrition log + totals
router.get('/nutrition/today', async (req, res) => {
  const userId = uid(req);
  try {
    const logs = await pool.query(
      `SELECT * FROM focus_nutrition_log WHERE user_id = $1 AND log_date = CURRENT_DATE ORDER BY created_at ASC`,
      [userId]
    );
    const totals = logs.rows.reduce((acc, row) => {
      const ratio = parseFloat(row.quantity_g) / 100;
      return {
        calories: acc.calories + parseFloat(row.calories_kcal || 0) * ratio,
        protein: acc.protein + parseFloat(row.protein_g || 0) * ratio,
        carbs: acc.carbs + parseFloat(row.carbs_g || 0) * ratio,
        fat: acc.fat + parseFloat(row.fat_g || 0) * ratio,
        fiber: acc.fiber + parseFloat(row.fiber_g || 0) * ratio,
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

    // Round all totals
    Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k] * 10) / 10; });

    res.json({ success: true, data: { logs: logs.rows, totals } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE a nutrition log entry
router.delete('/nutrition/log/:id', async (req, res) => {
  const userId = uid(req);
  try {
    await pool.query(
      `DELETE FROM focus_nutrition_log WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
