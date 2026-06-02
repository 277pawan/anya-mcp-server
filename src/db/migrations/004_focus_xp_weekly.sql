-- =============================================================================
-- Migration: 004_focus_xp_weekly.sql
-- Adds backend XP tracking, weekly level reset system, body metrics, nutrition log
-- =============================================================================

-- ── 1. Add XP / Level columns to users table ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_xp         INT         NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_level    INT         NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_xp        INT         NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS week_start_date  DATE        DEFAULT DATE_TRUNC('week', CURRENT_DATE)::DATE;

-- Body metrics for accurate nutrition/TDEE calculations
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_kg        NUMERIC(5,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm        NUMERIC(5,1);
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_years        INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS body_goal        TEXT        DEFAULT 'maintain'; -- 'bulk', 'cut', 'maintain', 'recomp'
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_level   TEXT        DEFAULT 'moderate'; -- 'sedentary','light','moderate','active','very_active'

-- ── 2. Weekly Focus Snapshot Table ────────────────────────────────────────────
-- Captures full weekly metrics when the week closes (Sunday midnight)
CREATE TABLE IF NOT EXISTS focus_weekly_snapshots (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start          DATE        NOT NULL,  -- Monday of that week
    week_end            DATE        NOT NULL,  -- Sunday of that week
    final_level         INT         NOT NULL DEFAULT 1,
    total_xp_earned     INT         NOT NULL DEFAULT 0,
    days_checked_in     INT         NOT NULL DEFAULT 0,
    workout_days        INT         NOT NULL DEFAULT 0,
    dsa_solved_count    INT         NOT NULL DEFAULT 0,
    topics_read_count   INT         NOT NULL DEFAULT 0,
    avg_water_glasses   NUMERIC(4,1) DEFAULT 0,
    avg_protein_hit     TEXT        DEFAULT 'no',  -- 'yes','no','partial'
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_week_snapshot UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_user ON focus_weekly_snapshots(user_id, week_start DESC);

-- ── 3. Nutrition Food Log Table ────────────────────────────────────────────────
-- Stores each logged food item with real macro data from Open Food Facts / USDA
CREATE TABLE IF NOT EXISTS focus_nutrition_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    food_name       TEXT        NOT NULL,
    quantity_g      NUMERIC(7,1) NOT NULL DEFAULT 100,
    calories_kcal   NUMERIC(7,1) DEFAULT 0,
    protein_g       NUMERIC(6,2) DEFAULT 0,
    carbs_g         NUMERIC(6,2) DEFAULT 0,
    fat_g           NUMERIC(6,2) DEFAULT 0,
    fiber_g         NUMERIC(6,2) DEFAULT 0,
    source          TEXT        DEFAULT 'manual', -- 'openfoodfacts','usda','manual'
    food_barcode    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_user_date ON focus_nutrition_log(user_id, log_date DESC);

-- ── 4. Study content cache table (roadmap.sh + GitHub raw) ────────────────────
-- Caches fetched roadmap items so app works offline after first load
CREATE TABLE IF NOT EXISTS focus_content_cache (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_key       TEXT        NOT NULL,       -- e.g. 'roadmap:frontend', 'article:docker'
    content_type    TEXT        NOT NULL,       -- 'roadmap_item', 'article', 'dsa_problem', 'concept'
    title           TEXT        NOT NULL,
    pillar          TEXT,
    body_md         TEXT,                       -- Markdown body
    code_snippet    TEXT,
    links_json      JSONB       DEFAULT '[]',
    source_url      TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
    CONSTRAINT unique_user_cache_key UNIQUE (user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_content_cache_user ON focus_content_cache(user_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_content_cache_type ON focus_content_cache(user_id, content_type);
