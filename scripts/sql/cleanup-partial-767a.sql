-- Remove the partial English-first test article (item 767a0cfb) created before
-- the structured-outputs JSON fix: only es-ES + fr-FR persisted (4 locales failed
-- JSON.parse on unescaped quotes). Reset its archive item to backlog for a clean
-- regenerate. FK-safe delete order.
delete from content_publish_queue
  where content_localization_id in (
    select id from content_localizations where content_item_id = '767a0cfb-048a-46ef-94f4-69aed4e56b90'
  );
delete from content_revisions where content_item_id = '767a0cfb-048a-46ef-94f4-69aed4e56b90';
delete from content_localizations where content_item_id = '767a0cfb-048a-46ef-94f4-69aed4e56b90';
delete from content_item_tags where content_item_id = '767a0cfb-048a-46ef-94f4-69aed4e56b90';
delete from content_items where id = '767a0cfb-048a-46ef-94f4-69aed4e56b90';
update content_archive_items
  set created_from_archive_to_content_item_id = null,
      status = 'backlog',
      updated_at = now()
  where id = '99380e48-ae6b-4b06-a443-39a81623cd8a';
