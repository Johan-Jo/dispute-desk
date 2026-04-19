-- Existing evidence packs have label snapshots frozen into the JSONB
-- columns at build time. The previous migration fixed pack_template_items
-- so future builds get the corrected labels, but already-built packs
-- still surface "Order confirmation email or screenshot" / "Customer
-- email correspondence" because the workspace endpoint reads
-- checklist_v2 / checklist / pack_json straight through without
-- re-localizing. This migration rewrites the snapshots in place.
--
-- A naive text REPLACE on the jsonb-cast-to-text is safe here: both
-- target strings are unique enough that no other field carries them as
-- value content (we already vetted via grep across the codebase that
-- they only appear in the seed migration and in pack snapshots derived
-- from it).

-- checklist_v2 (current Overview tab source)
UPDATE evidence_packs
SET checklist_v2 = REPLACE(
      REPLACE(
        checklist_v2::text,
        '"Order confirmation email or screenshot"',
        '"Order confirmation"'
      ),
      '"Customer email correspondence"',
      '"Customer correspondence"'
    )::jsonb
WHERE checklist_v2::text LIKE '%Order confirmation email or screenshot%'
   OR checklist_v2::text LIKE '%Customer email correspondence%';

-- checklist (legacy v1 — still rendered in some surfaces)
UPDATE evidence_packs
SET checklist = REPLACE(
      REPLACE(
        checklist::text,
        '"Order confirmation email or screenshot"',
        '"Order confirmation"'
      ),
      '"Customer email correspondence"',
      '"Customer correspondence"'
    )::jsonb
WHERE checklist::text LIKE '%Order confirmation email or screenshot%'
   OR checklist::text LIKE '%Customer email correspondence%';

-- pack_json.completeness.checklist (used by various downstream views)
UPDATE evidence_packs
SET pack_json = REPLACE(
      REPLACE(
        pack_json::text,
        '"Order confirmation email or screenshot"',
        '"Order confirmation"'
      ),
      '"Customer email correspondence"',
      '"Customer correspondence"'
    )::jsonb
WHERE pack_json::text LIKE '%Order confirmation email or screenshot%'
   OR pack_json::text LIKE '%Customer email correspondence%';
