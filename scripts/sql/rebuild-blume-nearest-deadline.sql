-- Rebuild the four blume-box disputes nearest their deadline that show no case
-- strength in the list: #352537, #352538, #346159, #350318.
--
-- They render "—" because pack_json lacks `case_assessment_gates`, the
-- fingerprint the workspace needs to project a verdict (written only from
-- 2026-08-11). Their defence packages are already draft / validation ok, so
-- this restores the strength display rather than repairing a broken package.
--
-- Same chain as the merchant's Regenerate button: build_pack ->
-- maybeEnqueueDefencePackage. Selected by ORDER NAME, and only the latest
-- ready pack per dispute.
insert into jobs (shop_id, job_type, entity_id)
select p.shop_id, 'build_pack', p.id
from evidence_packs p
join disputes d on d.id = p.dispute_id
join shops s on s.id = d.shop_id
where s.shop_domain = 'blume-box.myshopify.com'
  and d.order_name in ('#352537', '#352538', '#346159', '#350318')
  and d.evidence_saved_to_shopify_at is null
  and p.status = 'ready'
  and p.created_at = (
    select max(p2.created_at) from evidence_packs p2 where p2.dispute_id = d.id
  )
returning id, entity_id, job_type, status, created_at;
