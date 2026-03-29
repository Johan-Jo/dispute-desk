-- Optional generation brief fields for scalable target word range and role metadata.
ALTER TABLE content_archive_items
  ADD COLUMN IF NOT EXISTS page_role text,
  ADD COLUMN IF NOT EXISTS complexity text,
  ADD COLUMN IF NOT EXISTS target_word_range text;
