-- Evidence queries for docs/plans/non-receipt-delivery-evidence.plan.md
-- Read-only. Run one at a time:
--   npm run db:query:prod -- --file <a file holding one of these>
-- All figures in the plan were produced by these on prod
-- (aokhplydttxtebvbeuzc) on 2026-09-22.
--
-- Case A = blume-box 4576ee51-53ec-4ed2-8c66-65b04bb31d72, order #360980
--          (Visa 13.1 chargeback, GOFO parcel still in transit)
-- Case B = cay-collective f0036694-fe57-41a0-9cf0-1e9dc94c0232, order #14784
--          (Klarna inquiry, PostNord parcel collected at a pickup point)

-- Q1 — the two trigger disputes, with the fields that drive scheduling.
select d.id, s.shop_domain, d.order_name, d.reason, d.network_reason_code,
       d.phase, d.amount, d.currency_code, d.initiated_at, d.due_at,
       d.status, d.normalized_status, d.review_state, d.submission_state
  from disputes d join shops s on s.id = d.shop_id
 where d.id in ('4576ee51-53ec-4ed2-8c66-65b04bb31d72',
                'f0036694-fe57-41a0-9cf0-1e9dc94c0232');

-- Q2 — the collapsed per-order delivery signal. Case A: all null.
select shopify_order_number, created_at_shopify, fulfilled_at, fulfillment_status,
       delivery_status, delivered_at_tracking, signed_by_name, tracking_source,
       payment_gateway, payment_method, updated_at
  from shopify_orders
 where shopify_order_id in ('gid://shopify/Order/7549174841537',
                            'gid://shopify/Order/8397714325770');

-- Q3 — per-shipment rows. Case A has TWO legs (GOFO international + a
-- USPS-labelled last-mile reference); carrier_normalized is null on both and
-- no carrier lookup has ever run.
select company_raw, tracking_number, carrier_normalized, carrier_adapter,
       fulfillment_status, shipment_status, terminal_at, tracking_source,
       last_carrier_lookup_at, last_carrier_lookup_result, updated_at
  from shopify_fulfillment_trackings
 where shopify_order_id in ('gid://shopify/Order/7549174841537',
                            'gid://shopify/Order/8397714325770');

-- Q4 — package versions + the approved fact set behind each letter.
-- Case A v1/v2 share evidence_hash AND plan_input_hash: the "rebuild" changed
-- nothing. Its fact set is one row, no_return_initiated.
select dp.dispute_id, dp.version, dp.status, dp.generated_at,
       dp.reason_code_module, dp.validation_status, dp.document_validation_passed,
       dp.evidence_hash, dp.plan_input_hash,
       jsonb_array_length(dp.facts_json) as n_facts,
       (select string_agg(distinct f->'value'->>'fieldKey', ', ')
          from jsonb_array_elements(dp.facts_json) f) as fact_keys
  from defence_packages dp
 where dp.dispute_id in ('4576ee51-53ec-4ed2-8c66-65b04bb31d72',
                         'f0036694-fe57-41a0-9cf0-1e9dc94c0232')
 order by dp.dispute_id, dp.version;

-- Q5 — the argument plan authorises MORE than the letter ever cited.
-- Case A: 8 included records (incl. shipping_tracking x2, delivery_proof x2,
-- customer_communication) against a 1-fact letter.
select plan_json->>'noSafeArgument' as no_safe,
       (select string_agg(x->>'fieldKey', ', ')
          from jsonb_array_elements(plan_json->'included') x) as included,
       (select string_agg((x->>'fieldKey') || ':' || (x->>'reason'), ' | ')
          from jsonb_array_elements(plan_json->'excluded') x) as excluded
  from defence_packages
 where id = '1ae01792-8f46-45d6-a3eb-61470ce6bbbe';

-- Q6 — the bank-facing text, verbatim. Case A: executive summary and
-- conclusion argue from the absence of a return; every other section is "".
select dispute_id, version,
       narrative_json->'executiveSummary'->>'text' as exec_summary,
       narrative_json->'fulfillmentArgument'->>'text' as fulfillment_arg,
       narrative_json->'chronologyArgument'->>'text' as chronology_arg,
       narrative_json->'conclusion'->>'text' as conclusion
  from defence_packages
 where id in ('1ae01792-8f46-45d6-a3eb-61470ce6bbbe',
              '540110a7-b703-42f8-b7b6-4b32baed6df9');

-- Q7 — completeness disagrees with the letter. Case A scores 100 / ready /
-- no blockers on a one-fact package.
select dispute_id, status, completeness_score, submission_readiness, blockers,
       rebuild_pending, last_rebuild_at, last_rebuild_outcome, last_rebuild_reason,
       approved_for_save_at, created_at, updated_at
  from evidence_packs
 where dispute_id in ('4576ee51-53ec-4ed2-8c66-65b04bb31d72',
                      'f0036694-fe57-41a0-9cf0-1e9dc94c0232');

-- Q8 — every checklist row reads "available", including delivery_proof on a
-- parcel that has never been delivered.
select item->>'field' as field, item->>'status' as status, item->>'priority' as prio
  from evidence_packs, jsonb_array_elements(checklist_v2) as item
 where dispute_id = '4576ee51-53ec-4ed2-8c66-65b04bb31d72';

-- Q9 — the automation decision. Case A: rule mode auto, verdict
-- hold_for_deadline / strength_insufficient — i.e. the deadline path files
-- this letter unless something changes.
select dispute_id, event_type, actor_type, created_at, event_payload
  from audit_events
 where dispute_id in ('4576ee51-53ec-4ed2-8c66-65b04bb31d72',
                      'f0036694-fe57-41a0-9cf0-1e9dc94c0232')
   and event_type in ('auto_save_blocked','parked_for_review','rule_applied',
                      'defence_package_draft_generated')
 order by created_at desc limit 20;

-- Q10 — the support thread, and how the analyzer labelled it. Case A: the
-- cardholder's own non-receipt complaint is `contradiction`, confidence 72.
select sender_type, sender_name, sent_at, evidence_category, confidence_score,
       review_status, relevance_explanation, left(message_text, 200) as snippet
  from gorgias_evidence_messages
 where dispute_id = '4576ee51-53ec-4ed2-8c66-65b04bb31d72'
 order by sent_at;

-- Q11 — THE exposure figure. Non-receipt disputes since 2026-06-01 by the
-- delivery state we hold, and how many carry a signature. 0 of 287 do, so
-- signature_confirmed — the only route to `strong` on this family — has never
-- fired, and every one of these cases is capped at `weak`.
select o.delivery_status,
       count(*) as disputes,
       count(*) filter (where o.signed_by_name is not null) as with_signature,
       count(*) filter (where d.status in ('needs_response','new','in_progress','under_review')) as still_open
  from disputes d
  join shopify_orders o on o.shopify_order_id = d.order_gid
 where d.reason = 'PRODUCT_NOT_RECEIVED'
   and d.initiated_at > '2026-06-01'
 group by o.delivery_status
 order by disputes desc;

-- Q12 — how often no_return_initiated is the ONLY approved fact on a
-- non-receipt package. Run before and after the fix in plan section 4; the
-- count must fall to zero and stay there.
select count(*) as inr_packages_arguing_only_no_return
  from defence_packages dp
 where dp.reason_code_module = 'inr_product_not_received'
   and dp.status in ('draft','final')
   and jsonb_array_length(dp.facts_json) = 1
   and dp.facts_json->0->'value'->>'fieldKey' = 'no_return_initiated';

-- Q13 — open non-receipt disputes whose parcel is moving but unclassified:
-- fulfilled, tracking present, no delivery state, deadline still ahead. This
-- is the population the in-transit state exists to serve.
select d.id, s.shop_domain, d.order_name, d.amount, d.currency_code, d.due_at,
       o.fulfilled_at, t.company_raw, t.tracking_number, t.fulfillment_status
  from disputes d
  join shops s on s.id = d.shop_id
  join shopify_orders o on o.shopify_order_id = d.order_gid
  join shopify_fulfillment_trackings t on t.shopify_order_id = d.order_gid
 where d.reason = 'PRODUCT_NOT_RECEIVED'
   and d.status in ('needs_response','new','in_progress','under_review')
   and o.delivery_status is null
   and o.fulfilled_at is not null
   and d.due_at > now()
 order by d.due_at;

-- Q14 — carrier identification coverage across live tracking rows. Anything
-- with carrier_normalized null has no adapter and therefore no event source.
select coalesce(carrier_normalized, '(unidentified)') as carrier,
       count(*) as tracking_rows,
       count(*) filter (where last_carrier_lookup_at is not null) as ever_looked_up
  from shopify_fulfillment_trackings
 group by 1 order by tracking_rows desc limit 20;

-- Q15 — the re-check. Run this BEFORE acting on any deadline claim in the plan;
-- its §0 figures were last verified 2026-09-23 01:27 UTC and the nightly
-- re-ingest runs at 02:30 UTC.
select d.id, s.shop_domain, d.order_name, d.status, d.normalized_status,
       d.review_state, d.submission_state, d.submitted_at,
       d.evidence_saved_to_shopify_at, d.final_outcome, d.due_at, d.closed_at,
       o.delivery_status, o.delivered_at_tracking, o.updated_at as order_updated
  from disputes d
  join shops s on s.id = d.shop_id
  left join shopify_orders o on o.shopify_order_id = d.order_gid
 where d.id in ('4576ee51-53ec-4ed2-8c66-65b04bb31d72',
                'f0036694-fe57-41a0-9cf0-1e9dc94c0232');

-- Q16 — every dispute in Case B's position: parked for review, merchant already
-- approved, nothing saved, deadline ahead. `review_state = 'approved'` re-admits
-- these to the deadline submit cron (route.ts:144-170), so each one WILL file as
-- written. Read the letter before the deadline, not after.
select d.id, s.shop_domain, d.order_name, d.reason, d.amount, d.currency_code,
       d.due_at, d.normalized_status, d.review_state,
       dp.version, dp.status as package_status,
       jsonb_array_length(dp.facts_json) as n_facts,
       (select string_agg(distinct f->'value'->>'fieldKey', ', ')
          from jsonb_array_elements(dp.facts_json) f) as fact_keys
  from disputes d
  join shops s on s.id = d.shop_id
  left join defence_packages dp
         on dp.dispute_id = d.id and dp.status in ('draft','final')
 where d.review_state = 'approved'
   and d.evidence_saved_to_shopify_at is null
   and d.submitted_at is null
   and d.normalized_status not in ('submitted', 'submitted_to_bank')
   and d.due_at > now()
 order by d.due_at;
