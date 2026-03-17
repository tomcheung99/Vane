-- Migration: Add Space System Support
-- Created: 2026-03-17

-- Create spaces table
CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Create index for updated_at queries
CREATE INDEX IF NOT EXISTS idx_spaces_updatedat ON spaces(updated_at);

-- Add space_id to chats table
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;

-- Add is_archived to chats table
ALTER TABLE chats 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

-- Create index for space queries
CREATE INDEX IF NOT EXISTS idx_chats_space_id ON chats(space_id);
CREATE INDEX IF NOT EXISTS idx_chats_space_archived ON chats(space_id, is_archived);

-- Create trigger to update spaces.updated_at
CREATE OR REPLACE FUNCTION update_spaces_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NEW.created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_spaces_updatedat ON spaces;

-- Create trigger
CREATE TRIGGER trigger_spaces_updatedat
    BEFORE UPDATE ON spaces
    FOR EACH ROW
    EXECUTE FUNCTION update_spaces_timestamp();
