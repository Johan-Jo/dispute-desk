-- Optional alt text for hub listing / article hero images (accessibility).
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS featured_image_alt text;

COMMENT ON COLUMN content_items.featured_image_alt IS 'Accessible description for featured_image_url on public hub cards and article hero.';
