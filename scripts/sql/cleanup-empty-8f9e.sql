-- The 2026-06-08 08:00 cron ran the OLD all-async (pre-#71) code; en-US was
-- rejected by a validator so zero localizations were written, leaving an empty
-- content_item held at in-editorial-review. Remove it and reset its archive item
-- (Friendly Fraud) to backlog for a clean re-run on the new English-first flow.
delete from content_publish_queue where content_localization_id in (select id from content_localizations where content_item_id='8f9e2e8e-039e-4a51-9673-0f302be92694');
delete from content_revisions where content_item_id='8f9e2e8e-039e-4a51-9673-0f302be92694';
delete from content_localizations where content_item_id='8f9e2e8e-039e-4a51-9673-0f302be92694';
delete from content_item_tags where content_item_id='8f9e2e8e-039e-4a51-9673-0f302be92694';
delete from content_items where id='8f9e2e8e-039e-4a51-9673-0f302be92694';
update content_archive_items set created_from_archive_to_content_item_id=null, status='backlog', updated_at=now() where id='6a92bd5f-45a6-41a8-9265-cb5bfd39a5c5';
