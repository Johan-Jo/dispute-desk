-- After the manualSource fix, the latest defence_packages row for D466
-- should now carry a customer_communication fact with strength="strong"
-- and includeInBankNarrative=true.
select dp.version,
       dp.status,
       dp.generated_at,
       (select jsonb_agg(elem)
          from jsonb_array_elements(dp.facts_json) elem
         where elem->>'category' = 'customer_communication') as cc_facts,
       length(coalesce(dp.narrative_json->'communicationArgument'->>'text', '')) as comm_arg_len,
       coalesce(dp.narrative_json->'communicationArgument'->>'text', '') = '' as comm_arg_empty
  from defence_packages dp
  join evidence_packs p on p.id = dp.source_pack_id
 where p.dispute_id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5'
   and dp.status != 'skipped'
 order by dp.version desc
 limit 3;
