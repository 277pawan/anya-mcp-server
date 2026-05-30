-- Migration: 004_add_fcm_token.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;
