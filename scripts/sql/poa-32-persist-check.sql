create temp table chk(test text, result text);
do $$
declare v_shop uuid; v_dispute uuid; v_analysis uuid; v_user uuid := gen_random_uuid();
begin
  select d.shop_id, d.id into v_shop, v_dispute from disputes d limit 1;
  if v_dispute is null then insert into chk values('setup','SKIP: no dispute'); return; end if;

  insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
    provider_access_level_snapshot,platform_save_confirmation,
    submission_confirmation_source,package_evidence_tie,analyzer_version,
    source_snapshot_sha256,final_outcome_snapshot,analysis_level,
    primary_category,primary_confidence,actionable,summary)
  values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE',true,
    'SHOPIFY_EVIDENCE_SENT_ON','EVIDENCE_GID_MATCH',1,'persist-check-hash','lost',
    'FULL_POST_OUTCOME','INCORRECT_EVIDENCE_INTERPRETATION','DEFINITE',true,
    '{"findingCount":1}'::jsonb)
  returning id into v_analysis;
  insert into chk values('insert analysis','PASS');

  -- save-confirmation and forwarding are separate columns, both stored
  perform 1 from post_outcome_analyses
   where id=v_analysis and platform_save_confirmation
     and submission_confirmation_source='SHOPIFY_EVIDENCE_SENT_ON';
  insert into chk values('save vs forwarding stored separately',
    case when found then 'PASS' else 'FAIL' end);

  insert into post_outcome_findings (analysis_id,is_primary,category,confidence,severity,
    title,description,observed_fact,action_class,evidence_refs,rule_refs)
  values (v_analysis,true,'INCORRECT_EVIDENCE_INTERPRETATION','DEFINITE','HIGH',
    't','d','o','RULE_ENGINE','[]'::jsonb,'[{"id":"fraud.adverse","version":1}]'::jsonb);
  insert into chk values('insert primary finding','PASS');

  begin
    insert into post_outcome_findings (analysis_id,is_primary,category,confidence,severity,
      title,description,observed_fact,action_class,evidence_refs,rule_refs)
    values (v_analysis,true,'DATA_INTEGRITY_FAILURE','HIGH','HIGH','t2','d','o',
      'DATA_QUALITY','[]'::jsonb,'[{"id":"x","version":1}]'::jsonb);
    insert into chk values('second primary finding','FAIL (accepted)');
  exception when unique_violation then
    insert into chk values('second primary finding','PASS (blocked)');
  end;

  begin
    insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition)
    values (v_analysis,v_user,'REJECTED');
    insert into chk values('REJECTED without notes','FAIL (accepted)');
  exception when check_violation then
    insert into chk values('REJECTED without notes','PASS (blocked)');
  end;

  insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition,notes)
  values (v_analysis,v_user,'CONFIRMED',null);
  insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition,
    category_override,notes)
  values (v_analysis,v_user,'EDITED','NO_MATERIAL_GAP_OBSERVED','withholding was correct');
  insert into chk values('append-only review history',
    case when (select count(*) from post_outcome_analysis_reviews where analysis_id=v_analysis)=2
         then 'PASS (2 rows kept)' else 'FAIL' end);

  insert into chk values('latest review derives state',
    (select disposition from post_outcome_analysis_reviews
      where analysis_id=v_analysis order by created_at desc limit 1));

  delete from post_outcome_analyses where id=v_analysis;
  insert into chk values('cascade deletes findings+reviews',
    case when (select count(*) from post_outcome_findings where analysis_id=v_analysis)=0
          and (select count(*) from post_outcome_analysis_reviews where analysis_id=v_analysis)=0
         then 'PASS' else 'FAIL' end);
end $$;
select test, result from chk;
