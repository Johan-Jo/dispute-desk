-- CP-0 §3 — pin the pre-activation rebuild population.
--
-- Kickoff decision (2026-08-09): "Rebuild only current open, unsubmitted cases
-- through an authorised writer, before wave two. Do not grandfather legacy
-- packages." This census records the exact predicate and count so CP-D §9.3
-- reconciles against a number taken here, not one re-derived at cutover.
--
-- READ-ONLY. Run via `npm run db:query:prod -- --file scripts/sql/cp0-rebuild-population-census.sql`.
--
-- "Unsubmitted" is deliberately conjunctive: submission_state, the saved-at
-- timestamp and submitted_at are three independent writers and a case is only
-- safe to rebuild when none of them has fired.

with open_unsubmitted as (
  select d.id, d.shop_id, d.reason, d.normalized_status
    from disputes d
   where d.final_outcome is null
     and coalesce(d.submission_state, 'not_saved') = 'not_saved'
     and d.evidence_saved_to_shopify_at is null
     and d.submitted_at is null
)
select
  coalesce(s.shop_domain, '(unknown)')                     as shop,
  count(*)                                                 as open_unsubmitted_disputes,
  count(*) filter (where ep.id is not null)                as with_evidence_pack,
  count(*) filter (where dp.id is not null)                as with_defence_package,
  count(*) filter (where ep.id is null and dp.id is null)  as with_neither
from open_unsubmitted ou
left join shops s
       on s.id = ou.shop_id
left join lateral (
  select ep.id
    from evidence_packs ep
   where ep.dispute_id = ou.id
   order by ep.created_at desc
   limit 1
) ep on true
left join lateral (
  select dp.id
    from defence_packages dp
   where dp.dispute_id = ou.id
   order by dp.created_at desc
   limit 1
) dp on true
group by rollup (s.shop_domain)
order by shop;
