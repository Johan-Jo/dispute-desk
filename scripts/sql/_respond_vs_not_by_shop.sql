-- Win rate by responded (submitted evidence) vs not, per shop, adjudicated only
select s.shop_domain,
  (d.submitted_at is not null or d.evidence_saved_to_shopify_at is not null
    or d.submission_state in ('saved_to_shopify','submitted_confirmed','manual_submission_reported')) as responded,
  count(*) as n,
  count(*) filter (where d.final_outcome = 'won') as won,
  round(100.0 * count(*) filter (where d.final_outcome = 'won') / count(*), 1) as win_pct,
  round(avg(d.amount)::numeric, 0) as avg_amt
from disputes d
join shops s on s.id = d.shop_id
where d.final_outcome in ('won','lost')
group by 1, 2
order by 1, 2;
