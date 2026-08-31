-- Record 20260831140000 as applied on dev.
--
-- Its DDL was applied through the guarded query path because `db push` was
-- blocked by a migration on dev that is not on this branch. The tables exist
-- (verified 3/3); only the history row is missing. Without it, a later push
-- re-runs the file — harmless, since every statement is `if not exists`, but
-- the drift is real and worth closing rather than relying on idempotency.
insert into supabase_migrations.schema_migrations (version, name, statements)
select '20260831140000', 'learning_actions', array[]::text[]
where not exists (
  select 1 from supabase_migrations.schema_migrations where version = '20260831140000'
);

select version, name
from supabase_migrations.schema_migrations
where version >= '20260830000000'
order by version;
