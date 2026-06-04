-- =============================================================================
-- Migration: 005_add_avatar_url.sql
-- Add a dedicated avatar_url column to the users table
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
