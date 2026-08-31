-- Record the renumbered cohort-snapshots migration as applied on dev.
--
-- The table was created by hand under the old, colliding version number, so the
-- schema already has it. Recording the NEW version keeps history and schema in
-- step and stops a later push re-running it.
insert into supabase_migrations.schema_migrations (version, name, statements)
select '20260831150000', 'outcome_cohort_snapshots', array[]::text[]
where not exists (
  select 1 from supabase_migrations.schema_migrations where version = '20260831150000'
);

select version, name from supabase_migrations.schema_migrations
where version >= '20260830000000' order by version;
