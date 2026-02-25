-- Add locale column to shops for merchant language preference
ALTER TABLE shops ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
