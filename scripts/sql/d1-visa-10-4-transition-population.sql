-- D-1 population context — how many open, unsubmitted Visa 10.4 cases sit in a
-- cell that `visa_10_4_fraud.criticalCategories` removal would move narrow -> full.
--
-- Agent B's replay (docs/evidence-model/p4/d1-billing-match-replay.md) enumerates
-- WHICH cells transition; this says HOW MANY packages are in them. The four
-- conditions are the replay's: strength in {strong, moderate}, no fatal loss,
-- >= 2 distinct approved fact categories, and a payment_authentication fact.
--
-- READ-ONLY. `npm run db:query:prod -- --file scripts/sql/d1-visa-10-4-transition-population.sql`
-- Population predicate is identical to scripts/sql/cp0-rebuild-population-census.sql.

with open_unsubmitted as (
  select d.id, d.shop_id, d.network_reason_code
    from disputes d
   where d.final_outcome is null
     and coalesce(d.submission_state, 'not_saved') = 'not_saved'
     and d.evidence_saved_to_shopify_at is null
     and d.submitted_at is null
),
-- Strength lives on evidence_packs.pack_json; the facts live on
-- defence_packages.facts_json. Two tables, joined per dispute on their newest row.
latest_pkg as (
  select distinct on (dp.dispute_id)
         dp.dispute_id,
         dp.facts_json
    from defence_packages dp
    join open_unsubmitted ou on ou.id = dp.dispute_id
   order by dp.dispute_id, dp.created_at desc
),
latest_pack as (
  select distinct on (ep.dispute_id)
         ep.dispute_id,
         ep.pack_json
    from evidence_packs ep
    join open_unsubmitted ou on ou.id = ep.dispute_id
   order by ep.dispute_id, ep.created_at desc
),
scored as (
  select
    ou.id,
    coalesce(s.shop_domain, '(unknown)')                      as shop,
    ou.network_reason_code like '10.4%'                       as is_visa_10_4,
    coalesce(lk.pack_json -> 'case_strength' ->> 'overall', '(none)') as strength,
    coalesce(
      (lk.pack_json -> 'case_strength' -> 'fatalLoss' ->> 'triggered')::boolean,
      false
    )                                                          as fatal_loss,
    (
      select count(distinct f ->> 'category')
        from jsonb_array_elements(coalesce(lp.facts_json, '[]'::jsonb)) f
       where coalesce(f ->> 'grade', '') <> 'invalid'
    )                                                          as approved_categories,
    exists (
      select 1
        from jsonb_array_elements(coalesce(lp.facts_json, '[]'::jsonb)) f
       where f ->> 'category' = 'payment_authentication'
    )                                                          as has_payment_auth
  from open_unsubmitted ou
  left join shops s     on s.id = ou.shop_id
  left join latest_pkg  lp on lp.dispute_id = ou.id
  left join latest_pack lk on lk.dispute_id = ou.id
)
select
  shop,
  count(*)                                             as open_unsubmitted,
  count(*) filter (where is_visa_10_4)                 as visa_10_4,
  count(*) filter (
    where is_visa_10_4
      and strength in ('strong', 'moderate')
      and not fatal_loss
      and approved_categories >= 2
      and has_payment_auth
  )                                                    as in_transitioning_cell
from scored
group by rollup (shop)
order by shop;
