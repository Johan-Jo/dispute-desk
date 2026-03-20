-- 029: Link auto-built evidence packs to the catalog template chosen by automation rules.
-- (Renumbered from 025 — duplicate 025 prefix conflict with policy_snapshots migration.)

ALTER TABLE evidence_packs
  ADD COLUMN IF NOT EXISTS pack_template_id uuid REFERENCES pack_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN evidence_packs.pack_template_id IS
  'Global pack_templates.id used when this pack was auto-built from a reason rule; optional for manual builds.';
