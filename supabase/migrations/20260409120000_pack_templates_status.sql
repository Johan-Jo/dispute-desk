-- Add status column to pack_templates for template governance.
-- Canonical values: active | draft | archived
-- "deprecated" is NOT a DB status — it is a computed UI warning
-- (e.g. when an archived template is still mapped as a default).

ALTER TABLE pack_templates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'draft', 'archived'));

CREATE INDEX IF NOT EXISTS idx_pack_templates_status ON pack_templates(status);
