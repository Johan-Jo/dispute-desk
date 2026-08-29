-- Why is there no AVS row on 92 cases? Is the payment section present at all,
-- and does it carry a status telling us the collector ran and found nothing?
with latest as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
    from evidence_packs ep order by ep.dispute_id, ep.created_at desc),
sec as (select l.dispute_id, s.value as section from latest l,
         lateral jsonb_array_elements(l.pack_json->'sections') s
   where jsonb_typeof(l.pack_json->'sections')='array'),
per as (select dispute_id,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'avs_cvv_match'))[1] as avs,
    bool_or(section->'fieldsProvided' ? 'avs_cvv_match') as has_avs_section
  from sec group by dispute_id)
select s.shop_domain,
       p.has_avs_section,
       coalesce(p.avs->>'avsCvvStatus','(no status)') as avs_cvv_status,
       coalesce(p.avs->>'gateway','(none)')          as gateway,
       count(*) as cases
  from per p join disputes d on d.id=p.dispute_id join shops s on s.id=d.shop_id
 where coalesce(p.avs->>'avsResultCode','') = ''
 group by 1,2,3,4 order by 5 desc;
