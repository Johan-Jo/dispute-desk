create temp table c(test text, result text);
do $$
declare v_shop uuid; v_dispute uuid; v_analysis uuid; v_finding uuid;
        v_action uuid; v_user uuid := gen_random_uuid();
begin
  select d.shop_id, d.id into v_shop, v_dispute from disputes d limit 1;
  if v_dispute is null then insert into c values('setup','SKIP'); return; end if;

  insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
    provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
    analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level,
    primary_category,primary_confidence,actionable)
  values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','SHOPIFY_EVIDENCE_SENT_ON',
    'EVIDENCE_GID_MATCH',1,'la-check-hash','lost','FULL_POST_OUTCOME',
    'INCORRECT_EVIDENCE_INTERPRETATION','DEFINITE',true)
  returning id into v_analysis;

  insert into post_outcome_findings (analysis_id,is_primary,category,confidence,severity,
    title,description,observed_fact,action_class,evidence_refs,rule_refs)
  values (v_analysis,true,'INCORRECT_EVIDENCE_INTERPRETATION','DEFINITE','HIGH','t','d','o',
    'RULE_ENGINE','[]'::jsonb,'[{"id":"r","version":1}]'::jsonb)
  returning id into v_finding;

  insert into learning_actions (title,problem_statement,hypothesis,action_class,scope_type,owner_user_id)
  values ('t','p','h','RULE_ENGINE','REASON_NETWORK',v_user) returning id into v_action;
  insert into c values('create DRAFT with no evidence','PASS (accepted)');

  -- Approve with no supporting findings at all.
  begin
    update learning_actions set status='APPROVED', approved_by=v_user, approved_at=now()
     where id=v_action;
    insert into c values('approve with zero findings','FAIL (accepted)');
  exception when check_violation then
    insert into c values('approve with zero findings','PASS (blocked)');
  end;

  insert into learning_action_evidence (learning_action_id,analysis_id,finding_id,
    analyzer_version_at_link,snapshot_sha256_at_link)
  values (v_action,v_analysis,v_finding,1,'la-check-hash');

  -- The finding exists but nobody has reviewed it.
  begin
    update learning_actions set status='APPROVED', approved_by=v_user, approved_at=now()
     where id=v_action;
    insert into c values('approve on UNREVIEWED finding','FAIL (accepted)');
  exception when check_violation then
    insert into c values('approve on UNREVIEWED finding','PASS (blocked)');
  end;

  -- A rejection is a review, but cannot support an action.
  insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition,notes)
  values (v_analysis,v_user,'REJECTED','not a defect');
  begin
    update learning_actions set status='APPROVED', approved_by=v_user, approved_at=now()
     where id=v_action;
    insert into c values('approve on REJECTED review','FAIL (accepted)');
  exception when check_violation then
    insert into c values('approve on REJECTED review','PASS (blocked)');
  end;

  -- Confirmed: now it may be approved.
  insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition)
  values (v_analysis,v_user,'CONFIRMED');
  update learning_actions set status='APPROVED', approved_by=v_user, approved_at=now()
   where id=v_action;
  insert into c values('approve on CONFIRMED review','PASS (accepted)');

  -- Approved without an approver recorded.
  begin
    update learning_actions set approved_by=null where id=v_action;
    insert into c values('approved with no approver','FAIL (accepted)');
  exception when check_violation then
    insert into c values('approved with no approver','PASS (blocked)');
  end;

  -- Deployed without a release pointer.
  begin
    update learning_actions set status='DEPLOYED' where id=v_action;
    insert into c values('deploy with no deployment_ref','FAIL (accepted)');
  exception when check_violation then
    insert into c values('deploy with no deployment_ref','PASS (blocked)');
  end;

  -- PLATFORM scope on a single finding.
  begin
    update learning_actions set scope_type='PLATFORM', status='DRAFT' where id=v_action;
    update learning_actions set status='APPROVED' where id=v_action;
    insert into c values('PLATFORM scope on one finding','FAIL (accepted)');
  exception when check_violation then
    insert into c values('PLATFORM scope on one finding','PASS (blocked)');
  end;

  -- Evaluation verdicts.
  begin
    insert into learning_action_evaluations (learning_action_id,comparison_cohort_definition,
      baseline_metrics_snapshot,post_change_metrics_snapshot,sample_quality,result)
    values (v_action,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'INSUFFICIENT','PROMISING');
    insert into c values('PROMISING on insufficient sample','FAIL (accepted)');
  exception when check_violation then
    insert into c values('PROMISING on insufficient sample','PASS (blocked)');
  end;

  begin
    insert into learning_action_evaluations (learning_action_id,comparison_cohort_definition,
      baseline_metrics_snapshot,post_change_metrics_snapshot,sample_quality,result,guardrail_regression)
    values (v_action,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'SUFFICIENT','PROMISING',true);
    insert into c values('PROMISING with guardrail regression','FAIL (accepted)');
  exception when check_violation then
    insert into c values('PROMISING with guardrail regression','PASS (blocked)');
  end;

  delete from learning_actions where id=v_action;
  delete from post_outcome_analyses where id=v_analysis;
  insert into c values('cleanup','done');
end $$;
select test, result from c;
