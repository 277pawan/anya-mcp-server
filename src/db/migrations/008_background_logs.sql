-- Up
CREATE TABLE IF NOT EXISTS background_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id VARCHAR(255),
  task_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bg_logs_user_id ON background_logs(user_id);
