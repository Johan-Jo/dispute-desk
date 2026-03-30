-- Add checklist as a hub content_type (matches marketing ResourcesFilterBar and cms_settings keys).

ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_content_type_check;

ALTER TABLE content_items ADD CONSTRAINT content_items_content_type_check CHECK (content_type IN (
  'pillar_page',
  'cluster_article',
  'template',
  'case_study',
  'legal_update',
  'glossary_entry',
  'faq_entry',
  'checklist'
));
