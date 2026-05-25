-- The customer_communication fact rows on v4 + their classification flags
select dp.version,
       (select jsonb_agg(elem)
          from jsonb_array_elements(dp.facts_json) elem
         where elem->>'category' = 'customer_communication') as cc_facts
  from defence_packages dp
  join evidence_packs p on p.id = dp.source_pack_id
 where p.dispute_id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5'
   and dp.version = 4;
