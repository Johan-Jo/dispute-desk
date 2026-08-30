-- If AVS 'N' were real, blume-box would be shipping to addresses the issuer
-- rejects. Cross-check against independent signals on the SAME cases.
with latest as (
  select distinct on (ep.dispute_id) ep.dispute_id, ep.pack_json
    from evidence_packs ep
   order by ep.dispute_id, ep.created_at desc
),
sec as (
  select l.dispute_id, s.value as section
    from latest l, lateral jsonb_array_elements(l.pack_json->'sections') s
   where jsonb_typeof(l.pack_json->'sections')='array'
),
per as (
  select dispute_id,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'avs_cvv_match'))[1]     as avs,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'fraud_risk_screening'))[1] as fraud,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'ip_location_check'))[1]  as ip,
    (array_agg(section->'data') filter (where section->'fieldsProvided' ? 'delivery_proof'))[1]     as deliv
  from sec group by dispute_id
)
select upper(coalesce(p.avs->>'avsResultCode','(none)')) as avs_code,
       count(*)                                                             as cases,
       count(*) filter (where p.avs->>'cvvResultCode' = 'M')                as cvv_matched,
       count(*) filter (where p.fraud->>'riskLevel' = 'LOW')                as shopify_risk_low,
       count(*) filter (where p.fraud->>'recommendation' = 'ACCEPT')        as shopify_accept,
       count(*) filter (where p.ip->>'locationMatch' = 'same_country')      as ip_same_country,
       count(*) filter (where p.deliv->>'proofType' = 'delivered_confirmed') as delivered
  from per p
  join disputes d on d.id = p.dispute_id
  join shops   s on s.id = d.shop_id
 where s.shop_domain = 'blume-box.myshopify.com'
 group by 1 order by 2 desc;
