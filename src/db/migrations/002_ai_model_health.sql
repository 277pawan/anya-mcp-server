-- 002_ai_model_health.sql
-- Tracks AI model availability, failure reasons, and performance.
-- Populated automatically by model-health.service.js on every LLM call.
-- Query via GET /api/admin/model-health

CREATE TABLE IF NOT EXISTS ai_model_health (
  id              SERIAL PRIMARY KEY,
  provider        VARCHAR(50)  NOT NULL,         -- "gemini", "groq", "mistral" etc.
  model           VARCHAR(100) NOT NULL,          -- "gemini-2.0-flash", "llama-3.3-70b" etc.
  is_healthy      BOOLEAN      NOT NULL DEFAULT true,
  last_checked_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_error      TEXT,                           -- NULL when healthy, error message when failed
  total_calls     INTEGER      NOT NULL DEFAULT 0,
  success_calls   INTEGER      NOT NULL DEFAULT 0,
  fail_calls      INTEGER      NOT NULL DEFAULT 0,
  avg_latency_ms  INTEGER      NOT NULL DEFAULT 0, -- average ms for successful calls
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- One row per provider+model combination
  CONSTRAINT uq_provider_model UNIQUE (provider, model)
);

-- Index for quick dashboard queries
CREATE INDEX IF NOT EXISTS idx_model_health_provider ON ai_model_health (provider);
CREATE INDEX IF NOT EXISTS idx_model_health_healthy  ON ai_model_health (is_healthy);

-- Seed with known models so the dashboard shows them even before first use
INSERT INTO ai_model_health (provider, model, is_healthy, last_error)
VALUES
  ('gemini',  'gemini-2.0-flash',          true,  NULL),
  ('gemini',  'gemini-1.5-flash',          false, '404: model deprecated, use gemini-2.0-flash'),
  ('gemini',  'gemini-1.5-pro',            true,  NULL),
  ('groq',    'llama-3.3-70b-versatile',   true,  NULL),
  ('groq',    'llama-3.1-8b-instant',      true,  NULL),
  ('groq',    'mixtral-8x7b-32768',        true,  NULL),
  ('mistral', 'mistral-small-latest',      true,  NULL),
  ('mistral', 'mistral-medium-latest',     true,  NULL)
ON CONFLICT (provider, model) DO NOTHING;
