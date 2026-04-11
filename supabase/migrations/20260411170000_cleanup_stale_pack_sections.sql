-- Delete stale pack_sections (and cascade pack_section_items) for
-- library packs installed from templates.
--
-- History: installTemplate() in lib/db/packs.ts has always COPIED
-- pack_template_sections / pack_template_items into pack_sections /
-- pack_section_items using the English *_default columns at install
-- time. After migration 20260411130000_pack_template_localization
-- and commit 3c5a8d7, the API path at /api/packs/:id no longer
-- reads those merchant-side copies for library packs that have a
-- template_id — it reads directly from pack_template_sections and
-- pack_template_items joined with the i18n override tables so the
-- merchant's locale is honored.
--
-- The legacy copies are now dead data: they're never rendered, they
-- don't update when the admin edits a template, and they can't be
-- localized without re-running install. This migration removes them
-- for template-linked library packs so the fetchTemplateItems path
-- is unambiguous — the dispute_id = NULL + template_id IS NOT NULL
-- packs lose their copies and fall through cleanly to the live
-- template path.
--
-- Pack_sections / pack_section_items rows for packs WITHOUT a
-- template_id (hand-rolled / MANUAL source library packs) are left
-- alone because the API still reads from them as the legacy fallback
-- for that case.
--
-- DEV-MODE MIGRATION: this deletes rows in place. Cascade delete on
-- pack_sections.pack_id → pack_section_items handles the child rows.

DELETE FROM pack_sections
WHERE pack_id IN (
  SELECT p.id
  FROM packs p
  WHERE p.template_id IS NOT NULL
    AND p.source = 'TEMPLATE'
);
