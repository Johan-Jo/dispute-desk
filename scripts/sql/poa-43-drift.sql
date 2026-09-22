select v.version, v.tables_expected,
       (select count(*) from information_schema.tables t
         where t.table_schema='public' and t.table_name = any(v.tables_expected)) as tables_present,
       exists (select 1 from supabase_migrations.schema_migrations m
                where m.version = v.version)                                      as in_history
from (values
  ('20260830120000', array['post_outcome_analyses','post_outcome_findings','post_outcome_analysis_reviews','merchant_niche_classifications']),
  ('20260831150000', array['outcome_cohort_snapshots']),
  ('20260831140000', array['learning_actions','learning_action_evidence','learning_action_evaluations'])
) as v(version, tables_expected);
