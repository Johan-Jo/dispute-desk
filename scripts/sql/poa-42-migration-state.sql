select
  (select string_agg(column_name, ', ' order by ordinal_position)
     from information_schema.columns
    where table_schema='supabase_migrations' and table_name='schema_migrations') as columns,
  (select string_agg(version, ', ' order by version)
     from supabase_migrations.schema_migrations
    where version >= '20260830000000')                                          as recent_versions;
