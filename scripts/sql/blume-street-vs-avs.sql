-- The pack redacts street (zipPrefix only), so use the 3-digit zip prefix +
-- city as the proxy: do billing and shipping agree, vs what AVS said?
with latest as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
    from evidence_packs ep order by ep.dispute_id, ep.created_at desc),
sec as (select l.dispute_id, s.value as section from latest l,
         lateral jsonb_array_elements(l.pack_json->'sections') s
   where jsonb_typeof(l.pack_json->'sections')='array'),
per as (select dispute_id,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'avs_cvv_match'))[1]      as avs,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'order_confirmation'))[1] as ord
  from sec group by dispute_id)
select upper(coalesce(p.avs->>'avsResultCode','(none)')) as avs_code,
       (p.ord #>> '{billingAddress,city}' = p.ord #>> '{shippingAddress,city}'
        and p.ord #>> '{billingAddress,zipPrefix}' = p.ord #>> '{shippingAddress,zipPrefix}') as bill_ship_same,
       count(*) as cases,
       count(*) filter (where p.avs->>'cvvResultCode'='M') as cvv_match
  from per p join disputes d on d.id=p.dispute_id join shops s on s.id=d.shop_id
 where s.shop_domain='blume-box.myshopify.com'
   and upper(coalesce(p.avs->>'avsResultCode','')) in ('N','Y')
 group by 1,2 order by 1,3 desc;
