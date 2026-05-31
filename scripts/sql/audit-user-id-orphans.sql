-- Audit: which public tables reference auth.users by uuid columns, and how
-- many rows have user_ids that don't exist in this project's auth.users.
-- Diagnostic only; no writes.

with cols as (
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and data_type = 'uuid'
    and (
      column_name = 'user_id'
      or column_name = 'owner_user_id'
      or column_name = 'created_by'
      or column_name = 'updated_by'
      or column_name = 'granted_by'
      or column_name like '%_user_id'
    )
)
select table_name, column_name
from cols
order by table_name, column_name;
