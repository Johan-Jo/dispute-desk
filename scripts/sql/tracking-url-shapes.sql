-- What tracking URLs do we actually print into defence PDFs?
-- Groups live shopify_fulfillment_trackings rows by URL host + query-param
-- shape, so we can see every distinct link format the bank receives.
select
  coalesce(nullif(carrier_normalized, ''), '(unknown)') as carrier,
  coalesce(nullif(company_raw, ''), '(no company)') as company,
  split_part(split_part(tracking_url, '://', 2), '/', 1) as host,
  case
    when tracking_url like '%?%'
      then regexp_replace(split_part(tracking_url, '?', 2), '=[^&]*', '=', 'g')
    else '(no query)'
  end as param_shape,
  count(*) as n,
  min(tracking_url) as example
from shopify_fulfillment_trackings
where tracking_url is not null and tracking_url <> ''
group by 1, 2, 3, 4
order by n desc
limit 60;
