-- 007_email_logs.sql
-- Create a table to track sent job application / proposal emails to enforce daily limits.
CREATE TABLE IF NOT EXISTS email_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_to     TEXT        NOT NULL,
  subject     TEXT,
  lead_name   TEXT,
  score       INT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_date ON email_logs (user_id, sent_at DESC);
