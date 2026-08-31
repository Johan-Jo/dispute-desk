select v.version, v.expected_name,
       (select m.name from supabase_migrations.schema_migrations m where m.version=v.version) as history_name,
       (select count(*) from information_schema.tables t
         where t.table_schema='public' and t.table_name = any(v.tables)) as tables_present,
       array_length(v.tables,1) as tables_expected
from (values
  ('20260830120000','post_outcome_analysis_foundation', array['post_outcome_analyses','post_outcome_findings','post_outcome_analysis_reviews','merchant_niche_classifications']),
  ('20260831140000','learning_actions',                 array['learning_actions','learning_action_evidence','learning_action_evaluations']),
  ('20260831150000','outcome_cohort_snapshots',         array['outcome_cohort_snapshots'])
) as v(version, expected_name, tables);
