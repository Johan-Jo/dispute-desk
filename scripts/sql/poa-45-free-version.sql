select version, name from supabase_migrations.schema_migrations
where version in ('20260831150000','20260831160000') order by version;
