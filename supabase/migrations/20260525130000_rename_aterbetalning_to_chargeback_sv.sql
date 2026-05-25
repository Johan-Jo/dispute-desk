-- Swedish: rename "Återbetalning"/"återbetalning" → "Chargeback"/"chargeback"
-- across all sv rows in the pack-template i18n tables.
--
-- Rationale: per merchant decision, the Swedish UI uses the loanword
-- "Chargeback" everywhere the concept appears, including compounds like
-- "Chargebackpolicy" / "Chargebackhistorik". The previous seed
-- (20260525120000) used "Återbetalning" for refund-context strings; this
-- migration brings rows already in the DB in line with the seed file
-- (which has been edited to the same convention) so re-running from
-- scratch and the current state stay consistent.
--
-- Touched columns:
--   pack_template_i18n         : name, short_description, works_best_for, preview_note
--   pack_template_section_i18n : title
--   pack_template_item_i18n    : label, guidance
-- All scoped to locale = 'sv'.

UPDATE pack_template_i18n
SET name              = REPLACE(REPLACE(name,              'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback'),
    short_description = REPLACE(REPLACE(short_description, 'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback'),
    works_best_for    = REPLACE(REPLACE(works_best_for,    'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback'),
    preview_note      = REPLACE(REPLACE(preview_note,      'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback')
WHERE locale = 'sv';

UPDATE pack_template_section_i18n
SET title = REPLACE(REPLACE(title, 'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback')
WHERE locale = 'sv';

UPDATE pack_template_item_i18n
SET label    = REPLACE(REPLACE(label,    'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback'),
    guidance = REPLACE(REPLACE(guidance, 'Återbetalning', 'Chargeback'), 'återbetalning', 'chargeback')
WHERE locale = 'sv';
