-- Diagnose: was the cardholder acknowledgement recorded for dispute D466
-- and did it propagate into the rebuilt evidence pack + defence package?
-- Run via:
--   npx supabase db query --linked --file scripts/sql/check-d466-cardholder-ack.sql

-- 1. Find the dispute + the latest pack
select d.id            as dispute_id,
       d.dispute_gid,
       d.reason,
       d.normalized_status,
       d.submission_state,
       p.id            as pack_id,
       p.status        as pack_status,
       p.completeness_score,
       p.updated_at    as pack_updated_at,
       p.saved_to_shopify_at,
       p.rebuild_pending
  from disputes d
  left join evidence_packs p on p.dispute_id = d.id
 where d.dispute_gid ilike '%D466%'
    or d.id::text ilike '%d466%'
 order by p.updated_at desc nulls last
 limit 5;

-- 2. Look for evidence_items rows recorded for customer_communication
-- (`type='comms'` + payload.kind='cardholder_acknowledgement')
select ei.id,
       ei.type,
       ei.label,
       ei.source,
       ei.created_at,
       ei.payload->>'kind' as payload_kind,
       ei.payload->>'customerConfirmsOrder' as customer_confirms_order,
       length(coalesce(ei.payload->>'text', '')) as text_len,
       ei.payload->>'checklistField' as checklist_field
  from evidence_items ei
  join evidence_packs p on p.id = ei.pack_id
  join disputes d on d.id = p.dispute_id
 where (d.dispute_gid ilike '%D466%' or d.id::text ilike '%d466%')
   and (ei.type = 'comms' or ei.payload->>'checklistField' = 'customer_communication')
 order by ei.created_at desc
 limit 5;

-- 3. Look inside the pack JSON for a customer_communication section
select p.id as pack_id,
       p.updated_at,
       p.pack_json->'sections' is not null as has_sections,
       jsonb_path_query_array(
         p.pack_json,
         '$.sections[*] ? (@.field == "customer_communication")'
       ) as cc_section
  from evidence_packs p
  join disputes d on d.id = p.dispute_id
 where d.dispute_gid ilike '%D466%' or d.id::text ilike '%d466%'
 order by p.updated_at desc
 limit 1;

-- 4. Look at the most recent defence_packages row + check whether the
-- narrative + facts_json mention the acknowledgement
select dp.id,
       dp.version,
       dp.status,
       dp.generated_at,
       dp.submitted_at,
       jsonb_path_query_array(
         dp.facts_json,
         '$[*] ? (@.field == "customer_communication")'
       ) as cc_fact_rows,
       (dp.narrative_json->>'rebuttal_body') ilike '%customer%confirm%' as narrative_mentions_customer_confirm,
       (dp.narrative_json->>'rebuttal_body') ilike '%cardholder%acknowledg%' as narrative_mentions_cardholder_ack,
       length(dp.narrative_json->>'rebuttal_body') as narrative_len
  from defence_packages dp
  join evidence_packs p on p.id = dp.source_pack_id
  join disputes d on d.id = p.dispute_id
 where d.dispute_gid ilike '%D466%' or d.id::text ilike '%d466%'
 order by dp.version desc
 limit 3;
