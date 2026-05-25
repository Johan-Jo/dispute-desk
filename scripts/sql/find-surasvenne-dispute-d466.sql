-- Locate the defence_packages row(s) for dispute d466544f-d8ed-4e29-b04d-34834ab3c6b5
-- so we can target the regenerate endpoint at the right package id.
select
  dp.id              as package_id,
  dp.dispute_id,
  dp.version,
  dp.status,
  dp.pdf_path,
  dp.pdf_storage_bucket,
  dp.created_at,
  dp.updated_at,
  d.shop_id,
  s.shop_domain
from defence_packages dp
join disputes d on d.id = dp.dispute_id
join shops s on s.id = d.shop_id
where dp.dispute_id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5'
order by dp.version desc, dp.created_at desc;
