-- Is AVS 'N' concentrated in one shop / one gateway / one card network?
with latest as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
    from evidence_packs ep
   order by ep.dispute_id, ep.created_at desc
),
sec as (
  select l.dispute_id, l.pack_json, s.value as section
    from latest l, lateral jsonb_array_elements(l.pack_json->'sections') s
   where jsonb_typeof(l.pack_json->'sections')='array'
),
per as (
  select dispute_id,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'avs_cvv_match'))[1] as avs
  from sec group by dispute_id
)
select s.shop_domain,
       upper(coalesce(p.avs->>'avsResultCode','(none)')) as avs_code,
       coalesce(p.avs->>'gateway','(none)')             as gateway,
       coalesce(p.avs->>'cardCompany','(none)')         as card,
       count(*) as cases
  from per p
  join disputes d on d.id = p.dispute_id
  join shops s    on s.id = d.shop_id
 group by 1,2,3,4
 order by 1, 5 desc;
