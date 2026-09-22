create temp table c(test text, result text);
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='outcome_cohort_snapshots') then
    insert into c values('table exists','FAIL'); return;
  end if;
  insert into c values('table exists','PASS');

  -- A SUFFICIENT row must clear all three floors.
  begin
    insert into outcome_cohort_snapshots (scope_owner_type,cohort_key,cohort_definition,
      payment_provider,provider_access_level,phase,reason_family,card_network,
      window_start,window_end,peer_merchants,peer_cases,peer_won,subject_cases,subject_won,status)
    values ('MERCHANT','k1','{}'::jsonb,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','chargeback',
      'FRAUDULENT','UNKNOWN',now()-interval '90 days',now(),2,40,10,12,3,'SUFFICIENT');
    insert into c values('SUFFICIENT with 2 peer merchants','FAIL (accepted)');
  exception when check_violation then
    insert into c values('SUFFICIENT with 2 peer merchants','PASS (blocked)');
  end;

  begin
    insert into outcome_cohort_snapshots (scope_owner_type,cohort_key,cohort_definition,
      payment_provider,provider_access_level,phase,reason_family,card_network,
      window_start,window_end,peer_merchants,peer_cases,peer_won,subject_cases,subject_won,status)
    values ('MERCHANT','k2','{}'::jsonb,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','chargeback',
      'FRAUDULENT','UNKNOWN',now()-interval '90 days',now(),4,20,5,12,3,'SUFFICIENT');
    insert into c values('SUFFICIENT with 20 peer cases','FAIL (accepted)');
  exception when check_violation then
    insert into c values('SUFFICIENT with 20 peer cases','PASS (blocked)');
  end;

  begin
    insert into outcome_cohort_snapshots (scope_owner_type,cohort_key,cohort_definition,
      payment_provider,provider_access_level,phase,reason_family,card_network,
      window_start,window_end,peer_merchants,peer_cases,peer_won,subject_cases,subject_won,status)
    values ('MERCHANT','k3','{}'::jsonb,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','chargeback',
      'FRAUDULENT','UNKNOWN',now()-interval '90 days',now(),1,2,0,1,0,'INSUFFICIENT_SAMPLE');
    insert into c values('refusal without blockers','FAIL (accepted)');
  exception when check_violation then
    insert into c values('refusal without blockers','PASS (blocked)');
  end;

  insert into outcome_cohort_snapshots (scope_owner_type,cohort_key,cohort_definition,
    payment_provider,provider_access_level,phase,reason_family,card_network,
    window_start,window_end,peer_merchants,peer_cases,peer_won,subject_cases,subject_won,
    status,blockers)
  values ('MERCHANT','k4','{}'::jsonb,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','chargeback',
    'FRAUDULENT','UNKNOWN',now()-interval '90 days',now(),1,2,0,1,0,'INSUFFICIENT_SAMPLE',
    array['TOO_FEW_PEER_MERCHANTS','TOO_FEW_PEER_CASES']);
  insert into c values('refusal WITH blockers','PASS (accepted)');

  begin
    insert into outcome_cohort_snapshots (scope_owner_type,cohort_key,cohort_definition,
      payment_provider,provider_access_level,phase,reason_family,card_network,
      window_start,window_end,peer_merchants,peer_cases,peer_won,subject_cases,subject_won,
      status,blockers)
    values ('MERCHANT','k5','{}'::jsonb,'SHOPIFY_PAYMENTS','PARTIAL_CASE_FILE','chargeback',
      'FRAUDULENT','UNKNOWN',now()-interval '90 days',now(),4,30,40,12,3,'SUFFICIENT',array[]::text[]);
    insert into c values('won exceeding cases','FAIL (accepted)');
  exception when check_violation then
    insert into c values('won exceeding cases','PASS (blocked)');
  end;

  delete from outcome_cohort_snapshots where cohort_key like 'k%';
  insert into c values('cleanup','done');
end $$;
select test, result from c;
