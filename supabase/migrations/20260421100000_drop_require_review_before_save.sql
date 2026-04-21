-- Drop the dead `require_review_before_save` column from shop_settings.
--
-- This global flag silently overrode the Rules page: a merchant could set a
-- dispute family to "Auto" on /app/rules, the pack would build automatically,
-- but the auto-save gate would still park it for manual review because this
-- default-true flag applied on top. The Rules page is now the single source
-- of truth for automation decisions (auto_pack | review | manual | notify);
-- the save-time gate only checks completeness + blockers.
--
-- No app code reads this column anymore.

ALTER TABLE shop_settings DROP COLUMN IF EXISTS require_review_before_save;
