-- =============================================================================
-- Anya MCP Server — Full PostgreSQL Schema
-- Migration: 001_init.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------------------
-- ENUM Types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE work_type_enum AS ENUM (
    'remote', 'contract', 'freelance', 'full-time', 'part-time', 'hybrid'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nudge_category_enum AS ENUM (
    'health', 'mind', 'business', 'tech', 'body', 'motivation', 'innovation', 'reflection'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nudge_theme_enum AS ENUM (
    'normal', 'rabbit_hole', 'deep_dive', 'quick_hit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nudge_slot_enum AS ENUM (
    'morning', 'midMorning', 'afternoon', 'lateAfternoon', 'evening', 'night'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_role_enum AS ENUM (
    'user', 'assistant', 'system', 'tool'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_provider_enum AS ENUM (
    'gemini', 'groq', 'openai', 'cloudflare', 'github', 'deepseek', 'mistral'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mcp_tool_enum AS ENUM (
    'calendar_list', 'calendar_create', 'calendar_update', 'calendar_delete',
    'maps_geocode', 'maps_nearby', 'books_search',
    'gmail_list', 'gmail_send', 'gmail_read',
    'life_engine_nudge', 'lead_search'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_status_enum AS ENUM (
    'confirmed', 'tentative', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_status_enum AS ENUM (
    'active', 'completed', 'paused', 'dropped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  contact         TEXT,
  github_url      TEXT,
  linkedin_url    TEXT,
  timezone        TEXT        NOT NULL DEFAULT 'Asia/Kolkata',
  location        TEXT,
  availability    TEXT,
  edu_degree      TEXT,
  edu_university  TEXT,
  edu_year        TEXT,
  edu_cgpa        NUMERIC(3,1),
  rate_min        NUMERIC(8,2),
  rate_max        NUMERIC(8,2),
  rate_currency   TEXT        DEFAULT 'USD',
  streak          INT         NOT NULL DEFAULT 0,
  longest_streak  INT         NOT NULL DEFAULT 0,
  streak_start    DATE,
  last_active_date DATE,
  current_mood    SMALLINT    CHECK (current_mood BETWEEN 1 AND 10),
  total_nudges_sent     INT   NOT NULL DEFAULT 0,
  total_nudges_engaged  INT   NOT NULL DEFAULT 0,
  preferences     JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ---------------------------------------------------------------------------
-- user_skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_skills (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT  NOT NULL,
  name        TEXT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills (user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_cat  ON user_skills (user_id, category);

-- ---------------------------------------------------------------------------
-- user_work_types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_work_types (
  id       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     work_type_enum NOT NULL,
  UNIQUE (user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_user_work_types ON user_work_types (user_id);

-- ---------------------------------------------------------------------------
-- experience
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experience (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company     TEXT  NOT NULL,
  role        TEXT  NOT NULL,
  duration    TEXT,
  start_date  DATE,
  end_date    DATE,
  highlights  TEXT[],
  is_current  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experience_user    ON experience (user_id);
CREATE INDEX IF NOT EXISTS idx_experience_current ON experience (user_id) WHERE is_current = true;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT  NOT NULL,
  type        TEXT,
  description TEXT,
  highlights  TEXT[],
  url         TEXT,
  github_url  TEXT,
  sort_order  INT   NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goals (
  id           UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT              NOT NULL,
  description  TEXT,
  category     nudge_category_enum,
  status       goal_status_enum  NOT NULL DEFAULT 'active',
  progress     SMALLINT          CHECK (progress BETWEEN 0 AND 100) DEFAULT 0,
  target_date  DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user     ON goals (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_active   ON goals (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_goals_category ON goals (user_id, category);

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id TEXT              UNIQUE,
  title           TEXT              NOT NULL,
  description     TEXT,
  location        TEXT,
  start_time      TIMESTAMPTZ       NOT NULL,
  end_time        TIMESTAMPTZ       NOT NULL,
  is_all_day      BOOLEAN           NOT NULL DEFAULT false,
  status          event_status_enum NOT NULL DEFAULT 'confirmed',
  attendees       JSONB             DEFAULT '[]',
  recurrence      TEXT[],
  meet_link       TEXT,
  raw_data        JSONB             DEFAULT '{}',
  synced_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_user      ON calendar_events (user_id);
CREATE INDEX IF NOT EXISTS idx_cal_start     ON calendar_events (user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_cal_upcoming  ON calendar_events (user_id, start_time) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_cal_google_id ON calendar_events (google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cal_fts ON calendar_events USING GIN (
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
);

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT,
  context         JSONB DEFAULT '{}',
  message_count   INT   NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_recent ON chat_sessions (user_id, last_message_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID               NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id     UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        message_role_enum  NOT NULL,
  content     TEXT               NOT NULL,
  tool_name   mcp_tool_enum,
  tool_input  JSONB,
  tool_output JSONB,
  model       TEXT,
  provider    ai_provider_enum,
  tokens_in   INT,
  tokens_out  INT,
  latency_ms  INT,
  is_streamed BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msgs_session ON chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_user    ON chat_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_role    ON chat_messages (session_id, role);
CREATE INDEX IF NOT EXISTS idx_msgs_fts ON chat_messages USING GIN (
  to_tsvector('english', content)
);

-- ---------------------------------------------------------------------------
-- nudges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nudges (
  id           UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     nudge_category_enum NOT NULL,
  theme        nudge_theme_enum    NOT NULL DEFAULT 'normal',
  slot         nudge_slot_enum,
  message      TEXT,
  engaged      BOOLEAN,
  engaged_at   TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ         NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nudges_user     ON nudges (user_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_category ON nudges (user_id, category, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_engaged  ON nudges (user_id, engaged);
CREATE INDEX IF NOT EXISTS idx_nudges_slot     ON nudges (user_id, slot);
-- Note: "today's nudges" filtered at query time (CURRENT_DATE is volatile, can't use in index predicate)

-- ---------------------------------------------------------------------------
-- nudge_categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nudge_categories (
  id         UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   nudge_category_enum NOT NULL,
  enabled    BOOLEAN             NOT NULL DEFAULT true,
  weight     SMALLINT            NOT NULL DEFAULT 1,
  themes     TEXT[]              NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ         NOT NULL DEFAULT now(),
  UNIQUE (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_nudge_cat_user    ON nudge_categories (user_id);
CREATE INDEX IF NOT EXISTS idx_nudge_cat_enabled ON nudge_categories (user_id) WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- nudge_schedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nudge_schedule (
  id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot        nudge_slot_enum NOT NULL,
  slot_time   TIME            NOT NULL,
  categories  nudge_category_enum[] NOT NULL DEFAULT '{}',
  description TEXT,
  enabled     BOOLEAN         NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_schedule_user ON nudge_schedule (user_id);

-- ---------------------------------------------------------------------------
-- mood_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mood_history (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood      SMALLINT NOT NULL CHECK (mood BETWEEN 1 AND 10),
  note      TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mood_user ON mood_history (user_id, logged_at DESC);
-- Note: DATE(timestamptz) is STABLE not IMMUTABLE (depends on timezone), so no expression index here.
-- Filter by date using: WHERE logged_at >= date_trunc('day', now()) in queries.

-- ---------------------------------------------------------------------------
-- weekly_stats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_stats (
  id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  DATE                NOT NULL,
  category    nudge_category_enum NOT NULL,
  count       INT                 NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start, category)
);

CREATE INDEX IF NOT EXISTS idx_weekly_user ON weekly_stats (user_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_cat  ON weekly_stats (user_id, category, week_start DESC);

-- ---------------------------------------------------------------------------
-- daily_questions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_questions (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question    TEXT  NOT NULL,
  answer      TEXT,
  asked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dq_user ON daily_questions (user_id, asked_at DESC);

-- ---------------------------------------------------------------------------
-- weekly_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_reports (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start   DATE  NOT NULL,
  report_data  JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON weekly_reports (user_id, week_start DESC);

-- ---------------------------------------------------------------------------
-- mcp_tool_calls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          REFERENCES users(id) ON DELETE SET NULL,
  session_id UUID          REFERENCES chat_sessions(id) ON DELETE SET NULL,
  tool       mcp_tool_enum NOT NULL,
  input      JSONB         NOT NULL DEFAULT '{}',
  output     JSONB,
  success    BOOLEAN       NOT NULL DEFAULT true,
  error_msg  TEXT,
  latency_ms INT,
  called_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_user    ON mcp_tool_calls (user_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool    ON mcp_tool_calls (tool, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_session ON mcp_tool_calls (session_id) WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ai_model_calls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_model_calls (
  id                UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID             REFERENCES users(id) ON DELETE SET NULL,
  session_id        UUID             REFERENCES chat_sessions(id) ON DELETE SET NULL,
  provider          ai_provider_enum NOT NULL,
  model             TEXT             NOT NULL,
  prompt_tokens     INT,
  completion_tokens INT,
  total_tokens      INT,
  latency_ms        INT,
  success           BOOLEAN          NOT NULL DEFAULT true,
  error_msg         TEXT,
  called_at         TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_user     ON ai_model_calls (user_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_provider ON ai_model_calls (provider, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_success  ON ai_model_calls (user_id, success, called_at DESC);

-- ---------------------------------------------------------------------------
-- lead_searches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_searches (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID  REFERENCES users(id) ON DELETE SET NULL,
  query        TEXT  NOT NULL,
  results      JSONB DEFAULT '[]',
  result_count INT   NOT NULL DEFAULT 0,
  source       TEXT,
  searched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_user ON lead_searches (user_id, searched_at DESC);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id      UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT  NOT NULL,
  title   TEXT  NOT NULL,
  body    TEXT,
  data    JSONB DEFAULT '{}',
  read    BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications (user_id) WHERE read = false;

-- ---------------------------------------------------------------------------
-- updated_at auto-trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at      BEFORE UPDATE ON users          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_experience_updated_at BEFORE UPDATE ON experience      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_projects_updated_at   BEFORE UPDATE ON projects        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_goals_updated_at      BEFORE UPDATE ON goals           FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_cal_updated_at        BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_sessions_updated_at   BEFORE UPDATE ON chat_sessions   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
