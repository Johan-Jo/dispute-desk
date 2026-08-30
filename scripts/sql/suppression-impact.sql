-- Fleet-wide impact of the AVS no_match suppression: how many CURRENT packs
-- lose the agreement note, and how many keep it?
with latest as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
    from evidence_packs ep order by ep.dispute_id, ep.created_at desc),
sec as (select l.dispute_id, s.value as section from latest l,
         lateral jsonb_array_elements(l.pack_json->'sections') s
   where jsonb_typeof(l.pack_json->'sections')='array'),
per as (select dispute_id,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'avs_cvv_match'))[1]      as avs,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'order_confirmation'))[1] as ord
  from sec group by dispute_id),
cls as (
  select s.shop_domain, p.dispute_id, d.status,
    ( coalesce(ord #>> '{billingAddress,countryCode}','') <> ''
      and coalesce(ord #>> '{shippingAddress,countryCode}','') <> ''
      and coalesce(ord #>> '{billingAddress,city}','') <> ''
      and coalesce(ord #>> '{shippingAddress,city}','') <> ''
      and ord #>> '{billingAddress,countryCode}' = ord #>> '{shippingAddress,countryCode}'
      and ord #>> '{billingAddress,city}' = ord #>> '{shippingAddress,city}' ) as note_before,
    upper(coalesce(p.avs->>'avsResultCode','')) in ('N','Z','C') as avs_no_match
  from per p join disputes d on d.id=p.dispute_id join shops s on s.id=d.shop_id)
select shop_domain,
       count(*) filter (where note_before)                        as note_before,
       count(*) filter (where note_before and avs_no_match)       as note_suppressed,
       count(*) filter (where note_before and not avs_no_match)   as note_kept,
       count(*) filter (where note_before and avs_no_match
                          and status in ('needs_response','under_review')) as suppressed_still_open
  from cls group by 1 order by 3 desc;
