-- Align Resources Hub Portuguese with app i18n: pt-PT → pt-BR (matches pathLocales / LOCALE_LIST).
-- Drop CHECK first so rows can hold pt-BR before we add the new CHECK.

ALTER TABLE content_localizations DROP CONSTRAINT IF EXISTS content_localizations_locale_check;

-- Prefer existing pt-BR row over pt-PT when both exist for the same item
DELETE FROM content_localizations cl
USING content_localizations cl_br
WHERE cl.content_item_id = cl_br.content_item_id
  AND cl.locale = 'pt-PT'
  AND cl_br.locale = 'pt-BR';

UPDATE content_localizations SET locale = 'pt-BR' WHERE locale = 'pt-PT';

UPDATE content_revisions SET locale = 'pt-BR' WHERE locale = 'pt-PT';

UPDATE content_archive_items
SET target_locale_set = array_replace(target_locale_set, 'pt-PT', 'pt-BR')
WHERE 'pt-PT' = ANY(target_locale_set);

ALTER TABLE content_localizations ADD CONSTRAINT content_localizations_locale_check CHECK (locale IN (
  'en-US', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'sv-SE'
));
