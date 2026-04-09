-- Add optional description column to packs table
ALTER TABLE packs ADD COLUMN IF NOT EXISTS description text;
