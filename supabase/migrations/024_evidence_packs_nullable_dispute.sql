-- 024: Allow evidence_packs.dispute_id to be NULL for library/template packs.
-- Template-installed packs are created in packs table only; we now also create
-- an evidence_packs row (same id, dispute_id NULL) so uploads and evidence_items work.

ALTER TABLE evidence_packs
  ALTER COLUMN dispute_id DROP NOT NULL;

COMMENT ON COLUMN evidence_packs.dispute_id IS 'Linked dispute when pack is for a specific dispute; NULL for library/template packs.';
