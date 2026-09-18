with pk as (
  select dp.id, d.id as dispute_id, d.order_name, d.shop_id, d.order_gid,
         (select count(*) from jsonb_array_elements(
            case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
          where f->>'category'='customer_communication')                as comms_facts
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
)
select
  case when pk.comms_facts > 0 then 'has comms evidence' else 'NO comms evidence' end as bucket,
  count(*)                                                                as packages,
  count(*) filter (where g.msgs > 0)          as any_gorgias_message,
  count(*) filter (where g.approved > 0)      as approved_gorgias,
  count(*) filter (where gt.tickets > 0)      as matched_gorgias_ticket,
  count(*) filter (where ge.runs > 0)         as enrichment_ran,
  count(*) filter (where s.integration > 0)   as shop_has_gorgias_integration
from pk
left join lateral (select count(*) as msgs,
         count(*) filter (where review_status='approved') as approved
  from gorgias_evidence_messages m where m.dispute_id=pk.dispute_id) g on true
left join lateral (select count(*) as tickets from gorgias_matched_tickets t
  where t.dispute_id=pk.dispute_id) gt on true
left join lateral (select count(*) as runs from gorgias_enrichment_runs r
  where r.dispute_id=pk.dispute_id) ge on true
left join lateral (select count(*) as integration from integrations i
  where i.shop_id=pk.shop_id) s on true
group by 1;
