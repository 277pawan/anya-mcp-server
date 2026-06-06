-- 006_mcp_tool_text.sql
-- The mcp_tool_enum was too restrictive — new tool names like
-- searchGeneralJobs / searchFreelanceJobs / getUpcomingEvents etc.
-- caused INSERT failures (code 22P02).
--
-- Fix: convert mcp_tool_calls.tool and chat_messages.tool_name from
-- enum to TEXT so any tool name can be logged without a migration.
-- Also add missing enum values as a safety-net for any legacy code.

-- ── 1. Add all missing values to the enum (idempotent) ────────────────────
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchGeneralJobs';        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchFreelanceJobs';      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'getMyCalendarDataByDate';  EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'getUpcomingEvents';        EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchEvents';             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchNearbyPlaces';       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'geocodeAddress';           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'getDirections';            EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchPlaces';             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'getPlaceDetails';          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'searchBooks';              EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'device_control';           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE mcp_tool_enum ADD VALUE IF NOT EXISTS 'application_control';      EXCEPTION WHEN others THEN NULL; END $$;

-- ── 2. Convert mcp_tool_calls.tool to TEXT (future-proof) ─────────────────
ALTER TABLE mcp_tool_calls
  ALTER COLUMN tool TYPE TEXT USING tool::TEXT;

-- ── 3. Convert chat_messages.tool_name to TEXT (future-proof) ─────────────
ALTER TABLE chat_messages
  ALTER COLUMN tool_name TYPE TEXT USING tool_name::TEXT;
