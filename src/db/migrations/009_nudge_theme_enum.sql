-- Add Life Engine nudge types used by CategorySelector
DO $$ BEGIN
  ALTER TYPE nudge_theme_enum ADD VALUE 'big_question';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE nudge_theme_enum ADD VALUE 'streak_nudge';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
