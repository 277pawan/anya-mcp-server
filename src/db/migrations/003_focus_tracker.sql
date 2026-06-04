-- src/db/migrations/003_focus_tracker.sql
-- Incredibly robust schema addition for Pawan's Focus OS & Developer Gamification System

CREATE TABLE IF NOT EXISTS focus_daily_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
    protein_hit VARCHAR(10) DEFAULT 'no', -- 'yes', 'no', 'partial'
    workout_done BOOLEAN DEFAULT FALSE,
    water_glasses INT DEFAULT 0,
    skipped_meal BOOLEAN DEFAULT FALSE,
    unusual_food TEXT,
    dsa_solved BOOLEAN DEFAULT FALSE,
    xp_earned INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_checkin_date UNIQUE (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS focus_study_roadmap (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id VARCHAR(50) NOT NULL,
    topic_name VARCHAR(255) NOT NULL,
    pillar VARCHAR(100) NOT NULL,
    read_status BOOLEAN DEFAULT FALSE,
    confidence INT DEFAULT 0, -- 1 to 5 scale
    last_reviewed TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_topic UNIQUE (user_id, topic_id)
);

-- Indexing for fast search and aggregation in daily reports & recall algorithms
CREATE INDEX IF NOT EXISTS idx_focus_checkins_date ON focus_daily_checkins(user_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_focus_roadmap_pillar ON focus_study_roadmap(user_id, pillar);
