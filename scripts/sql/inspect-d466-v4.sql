-- What's actually inside the v4 defence_packages row + the latest pack?
select dp.id,
       dp.version,
       dp.status,
       dp.validation_status,
       dp.evidence_hash,
       jsonb_typeof(dp.narrative_json) as narrative_type,
       jsonb_typeof(dp.facts_json)     as facts_type,
       jsonb_array_length(coalesce(dp.facts_json, '[]'::jsonb)) as facts_count,
       (select array_agg(distinct (elem->>'field'))
          from jsonb_array_elements(coalesce(dp.facts_json, '[]'::jsonb)) elem) as facts_fields,
       coalesce(dp.narrative_json->>'rebuttal_body', '') = '' as narrative_body_empty,
       dp.narrative_json ? 'rebuttal_body' as has_rebuttal_body_key,
       (select array_agg(distinct k)
          from jsonb_object_keys(coalesce(dp.narrative_json, '{}'::jsonb)) k) as narrative_top_keys
  from defence_packages dp
  join evidence_packs p on p.id = dp.source_pack_id
  join disputes d on d.id = p.dispute_id
 where d.dispute_gid ilike '%D466%'
 order by dp.version desc
 limit 3;

-- 2. Look at the pack JSON for the customer_communication section
-- AND the evidence_items rows feeding it.
select p.id as pack_id,
       p.status as pack_status,
       p.updated_at,
       (select count(*) from evidence_items ei where ei.pack_id = p.id) as evidence_items_count,
       (select count(*) from evidence_items ei
          where ei.pack_id = p.id
            and ei.type = 'comms') as comms_items,
       jsonb_path_query_first(
         p.pack_json,
         '$.sections[*] ? (@.field == "customer_communication")'
       ) as cc_section
  from evidence_packs p
  join disputes d on d.id = p.dispute_id
 where d.dispute_gid ilike '%D466%'
 order by p.updated_at desc
 limit 1;
