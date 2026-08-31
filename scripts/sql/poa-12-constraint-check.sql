create temp table poa_check(test text, result text);

do $$
declare v_shop uuid; v_dispute uuid;
begin
  select d.shop_id, d.id into v_shop, v_dispute from disputes d limit 1;
  if v_dispute is null then
    insert into poa_check values ('setup','SKIP: no dispute in dev'); return;
  end if;

  begin
    insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
      provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
      analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level)
    values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','PLATFORM_SAVE_ONLY',
      'EVIDENCE_GID_MATCH',1,'hash-save-only','won','FULL_POST_OUTCOME');
    insert into poa_check values ('save-only -> FULL_POST_OUTCOME','FAIL (accepted)');
  exception when check_violation then
    insert into poa_check values ('save-only -> FULL_POST_OUTCOME','PASS (blocked)');
  end;

  begin
    insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
      provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
      analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level)
    values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','MANUAL_MERCHANT_REPORT',
      'EVIDENCE_GID_MATCH',1,'hash-manual','won','FULL_POST_OUTCOME');
    insert into poa_check values ('merchant report -> FULL_POST_OUTCOME','FAIL (accepted)');
  exception when check_violation then
    insert into poa_check values ('merchant report -> FULL_POST_OUTCOME','PASS (blocked)');
  end;

  begin
    insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
      provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
      analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level,
      data_integrity_limitation)
    values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','SHOPIFY_EVIDENCE_SENT_ON',
      'AMBIGUOUS_MULTIPLE_PACKAGES',1,'hash-ambig','lost','PACKAGE_INTEGRITY_ONLY',false);
    insert into poa_check values ('unflagged ambiguous tie','FAIL (accepted)');
  exception when check_violation then
    insert into poa_check values ('unflagged ambiguous tie','PASS (blocked)');
  end;

  insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
    provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
    analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level)
  values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','SHOPIFY_EVIDENCE_SENT_ON',
    'EVIDENCE_GID_MATCH',1,'hash-forwarded','lost','FULL_POST_OUTCOME');
  insert into poa_check values ('forwarded case','PASS (accepted)');

  begin
    insert into post_outcome_analyses (shop_id,dispute_id,payment_provider_snapshot,
      provider_access_level_snapshot,submission_confirmation_source,package_evidence_tie,
      analyzer_version,source_snapshot_sha256,final_outcome_snapshot,analysis_level)
    values (v_shop,v_dispute,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','SHOPIFY_EVIDENCE_SENT_ON',
      'EVIDENCE_GID_MATCH',1,'hash-forwarded','lost','FULL_POST_OUTCOME');
    insert into poa_check values ('duplicate identity','FAIL (accepted)');
  exception when unique_violation then
    insert into poa_check values ('duplicate identity','PASS (blocked)');
  end;

  begin
    insert into post_outcome_findings (analysis_id,category,confidence,severity,title,
      description,observed_fact,action_class)
    select id,'AVAILABLE_EVIDENCE_OMITTED','DEFINITE','HIGH','t','d','o','EVIDENCE_MAPPING'
    from post_outcome_analyses where source_snapshot_sha256='hash-forwarded';
    insert into poa_check values ('DEFINITE without provenance','FAIL (accepted)');
  exception when check_violation then
    insert into poa_check values ('DEFINITE without provenance','PASS (blocked)');
  end;

  begin
    insert into post_outcome_analysis_reviews (analysis_id,reviewer_user_id,disposition)
    select id, gen_random_uuid(),'REJECTED'
    from post_outcome_analyses where source_snapshot_sha256='hash-forwarded';
    insert into poa_check values ('REJECTED review without notes','FAIL (accepted)');
  exception when check_violation then
    insert into poa_check values ('REJECTED review without notes','PASS (blocked)');
  end;

  delete from post_outcome_analyses where source_snapshot_sha256 like 'hash-%';
  insert into poa_check values ('cleanup','done');
end $$;

select test, result from poa_check;
