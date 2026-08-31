select
  (select count(*) from supabase_migrations.schema_migrations
     where version = '20260830120000')                                  as migration_recorded,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='post_outcome_analyses') as analyses_table,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='post_outcome_findings') as findings_table,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='post_outcome_analysis_reviews') as reviews_table,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='merchant_niche_classifications') as niche_table;
