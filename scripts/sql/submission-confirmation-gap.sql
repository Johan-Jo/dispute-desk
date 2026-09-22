-- Evidence queries for docs/plans/submission-confirmation-gap.plan.md
-- Run: npm run db:query:prod -- --file scripts/sql/submission-confirmation-gap.sql --output table
-- Each block is labelled Q<n> and is referenced by number from the plan.

-- Q1 — Prod-wide submission_state distribution.
--      `saved_to_shopify` is the stuck state: we wrote, Shopify never confirmed.
select d.submission_state, count(*) n, min(d.due_at)::text earliest_due
from disputes d
group by 1
order by 2 desc;

-- Q2 — THE EXPOSURE. Packs we marked saved+verified that Shopify still
--      reports as NEEDS_RESPONSE with evidenceSentOn null. Ordered by
--      deadline: the top rows are the ones that expire first.
select s.shop_domain,
       d.id,
       d.amount,
       d.currency_code,
       d.reason,
       d.due_at::text,
       ep.saved_to_shopify_at::text  as saved_at,
       ep.status                     as pack_status,
       d.submission_state,
       d.raw_snapshot->>'status'         as shopify_status,
       d.raw_snapshot->>'evidenceSentOn' as shopify_evidence_sent_on
from disputes d
join shops s          on s.id = d.shop_id
join evidence_packs ep on ep.dispute_id = d.id
where d.submission_state = 'saved_to_shopify'
  and d.raw_snapshot->>'status' = 'NEEDS_RESPONSE'
order by d.due_at;

-- Q3 — Landing rate for every save DisputeDesk has ever made.
--      Denominator = packs with saved_to_shopify_at set.
select s.shop_domain,
       d.raw_snapshot->>'type' as dispute_type,
       case when d.raw_snapshot->>'evidenceSentOn' is null
            then 'SHOPIFY_SAYS_NOT_SENT' else 'shopify_says_sent' end as shopify_view,
       count(*) n
from evidence_packs ep
join disputes d on d.id = ep.dispute_id
join shops s    on s.id = d.shop_id
where ep.saved_to_shopify_at is not null
group by 1, 2, 3
order by 1, 2, 3;

-- Q4 — Deadline-hour distribution vs the 06:00 / 08:00 UTC deadline crons.
--      Any dispute due before 06:00 UTC is missed by BOTH crons.
select case
         when extract(hour from d.due_at at time zone 'UTC') < 6 then 'before 06:00 UTC (both crons late)'
         when extract(hour from d.due_at at time zone 'UTC') < 8 then '06:00-07:59 UTC (submit cron late)'
         else '08:00+ UTC (ok)'
       end as bucket,
       count(*) n
from disputes d
where d.due_at is not null
  and d.due_at >= '2026-06-01'
group by 1
order by 2 desc;

-- Q5 — Same, restricted to still-open disputes (the live exposure).
select s.shop_domain,
       case
         when extract(hour from d.due_at at time zone 'UTC') < 6 then 'before 06:00 UTC (both crons late)'
         when extract(hour from d.due_at at time zone 'UTC') < 8 then '06:00-07:59 UTC (submit cron late)'
         else '08:00+ UTC (ok)'
       end as bucket,
       count(*) n
from disputes d
join shops s on s.id = d.shop_id
where d.due_at is not null
  and d.normalized_status in ('needs_response', 'needs_review')
group by 1, 2
order by 1, 3 desc;

-- Q6 — Backlog left behind when auto_build_enabled flips false -> true.
--      Open disputes, and how many have no pack at all.
select s.shop_domain,
       ss.auto_build_enabled,
       count(*) n,
       count(*) filter (where ep.id is null) as no_pack,
       min(d.due_at)::text as earliest_due
from disputes d
join shops s           on s.id = d.shop_id
join shop_settings ss  on ss.shop_id = d.shop_id
left join evidence_packs ep on ep.dispute_id = d.id
where d.normalized_status in ('needs_response', 'needs_review')
group by 1, 2
order by 3 desc;

-- Q7 — Actor-channel pollution: scripts writing actor_type='merchant'.
--      Any row whose payload names a script is NOT a merchant action.
select s.shop_domain,
       ae.event_type,
       ae.actor_id,
       count(*) n,
       max(ae.created_at) last_at
from audit_events ae
left join shops s on s.id = ae.shop_id
where ae.actor_type = 'merchant'
  and ae.event_payload::text ilike '%scripts/%'
group by 1, 2, 3
order by 5 desc;

-- Q8 — Inquiry evidence by payment rail. Establishes that inquiries DO
--      accept evidence on card and Klarna, and that PayPal-wallet
--      inquiries have never been attempted by anyone.
select s.shop_domain,
       coalesce(o.payment_method, '(null)') as rail,
       case when d.raw_snapshot->>'evidenceSentOn' is null then 'no_ev' else 'ev_sent' end as ev,
       count(*) n
from disputes d
join shops s on s.id = d.shop_id
left join shopify_orders o
       on o.shop_id = d.shop_id
      and o.shopify_order_id = d.raw_snapshot->'order'->>'id'
where d.raw_snapshot->>'type' = 'INQUIRY'
group by 1, 2, 3
order by 1, 3 desc, 4 desc;

-- Q9 — Gorgias enrichment loop (plan §6.5). Shows the terminal `no_matches`
--      outcome immediately followed by a fresh `gorgias_enrichment_queued`
--      for the same dispute. Widen the interval to catch a past occurrence.
select ae.created_at, ae.name, ae.payload
from app_events ae
where ae.name like 'gorgias_enrichment%'
  and ae.created_at >= now() - interval '2 hours'
order by ae.created_at desc;

-- Q9b — corroboration: the enrichment wrote no rows for the looping dispute.
select d.id,
       (select count(*) from gorgias_evidence_messages g where g.dispute_id = d.id) as msgs
from disputes d
where d.id = '4f4c8560-5ead-4477-8869-4a1b2567905e';

-- Q9c — the queue was NOT backlogged, contradicting the "waiting behind
--        other work" copy. Expect zero rows besides the loop's own job.
select j.job_type, j.status, count(*) n
from jobs j
where j.shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
  and j.status in ('queued', 'running')
group by 1, 2;

-- Q9d — THE PRIMARY SOURCE for §6.5. app_events alone cannot tell a loop from
--       a merchant clicking Refresh; the run table records trigger_source and
--       the terminal status. Check this BEFORE claiming a loop.
select r.id, r.status, r.trigger_source, r.tickets_scanned, r.messages_stored,
       coalesce(r.error_code, '-') as err_code,
       r.started_at::text, r.completed_at::text
from gorgias_enrichment_runs r
where r.dispute_id = '4f4c8560-5ead-4477-8869-4a1b2567905e'
order by r.started_at desc nulls last;
