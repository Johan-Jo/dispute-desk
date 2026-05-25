-- Dev: enqueue a build_pack job for dispute d466544f's source pack.
-- The pack job will run every source collector and then chain to
-- maybeEnqueueDefencePackage, producing a fresh v3 draft against the
-- updated renderer (caption removed + cells capitalized).
-- Submitted v2 row stays untouched as the historical record of what
-- was previously pushed to Shopify.
insert into jobs (shop_id, job_type, entity_id)
values (
  'e5da0042-a3d4-48f4-88f3-33632a0e12d3',
  'build_pack',
  '8e4b7921-8f01-46a8-8790-69de49e7e5c8'
)
returning id, job_type, entity_id, run_at, created_at;
