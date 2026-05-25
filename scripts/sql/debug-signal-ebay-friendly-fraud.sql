-- Look for the r/chargebacks post: "$1K lost to friendly fraud on eBay this month"
-- Posted ~5 days ago (2026-05-18 give or take).

select
  s.id,
  s.platform,
  s.subreddit,
  s.title,
  s.posted_at,
  s.ingested_at,
  s.analysis_status,
  s.analysis_last_error,
  s.author,
  s.url
from signal_sources s
where s.platform = 'reddit'
  and s.subreddit ilike 'r/chargebacks'
  and (
    s.title ilike '%friendly fraud%'
    or s.title ilike '%eBay%'
    or s.title ilike '%$1K%'
    or s.title ilike '%1k lost%'
  )
order by s.posted_at desc
limit 20;
