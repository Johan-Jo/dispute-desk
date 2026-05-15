-- Retry the build_pack for dispute bd425f70-e62e-42ce-8cfc-44375aa34a6b.
--
-- Context: after the 2026-05-15 billing-quota unblock fired, the first
-- build_pack job ran against the OLD code and emitted pack_build_failed
-- because `Order.cartToken` and `Fulfillment.metafields` had been removed
-- in Shopify Admin API 2026-01. The fix is in
-- lib/shopify/queries/orders.ts + customerOrdersForCE30.ts, locked in by
-- lib/shopify/queries/__tests__/schemaDriftGuard.test.ts.
--
-- Run this AFTER the schema-drift fix is deployed to Vercel (push
-- master → wait for green deploy). The script:
--   1. archives the stuck pack (status 'building' from the failed
--      first attempt) so the pipeline's existing-pack guard does
--      not skip the retry.
--   2. creates a fresh queued pack + build_pack job using the same
--      pack_template_id the rule originally matched.
--
-- Re-running this on an already-successful retry is harmless — the
-- archived pack stays archived, a duplicate fresh pack is created.
-- Inspect the disputes/packs tables before re-running if unsure.

do $$
declare
  v_shop_id     uuid := 'e5da0042-a3d4-48f4-88f3-33632a0e12d3';
  v_dispute_id  uuid := 'bd425f70-e62e-42ce-8cfc-44375aa34a6b';
  v_template_id uuid := 'a0000000-0000-0000-0000-000000000001';
  v_now         timestamptz := now();
  v_new_pack_id uuid;
  v_stuck       int;
begin
  perform 1 from disputes where id = v_dispute_id and shop_id = v_shop_id;
  if not found then
    raise exception 'refusing: dispute % not on expected shop %', v_dispute_id, v_shop_id;
  end if;

  update evidence_packs
     set status = 'archived',
         updated_at = v_now,
         failure_reason = coalesce(failure_reason,
           'Auto-archived 2026-05-15: pack failed due to Order.cartToken / Fulfillment.metafields schema drift; superseded by retry pack.')
   where dispute_id = v_dispute_id
     and status in ('building', 'queued');
  get diagnostics v_stuck = row_count;
  raise notice 'archived % stuck pack(s) for dispute %', v_stuck, v_dispute_id;

  insert into evidence_packs (shop_id, dispute_id, status, created_by, pack_template_id)
  values (v_shop_id, v_dispute_id, 'queued', 'automation', v_template_id)
  returning id into v_new_pack_id;

  insert into jobs (shop_id, job_type, entity_id)
  values (v_shop_id, 'build_pack', v_new_pack_id::text);

  insert into audit_events (shop_id, dispute_id, pack_id, actor_type, event_type, event_payload)
  values (
    v_shop_id,
    v_dispute_id,
    v_new_pack_id,
    'system',
    'auto_build_enqueued',
    jsonb_build_object(
      'trigger', 'manual_retry_2026-05-15_after_schema_drift_fix',
      'archived_count', v_stuck
    )
  );

  insert into dispute_events (
    dispute_id, shop_id, event_type, event_at, actor_type, source_type,
    visibility, metadata_json, dedupe_key
  ) values (
    v_dispute_id,
    v_shop_id,
    'auto_build_triggered',
    v_now,
    'disputedesk_system',
    'pack_engine',
    'merchant_and_internal',
    jsonb_build_object('pack_id', v_new_pack_id, 'trigger', 'manual_retry_2026-05-15'),
    v_dispute_id::text || ':auto_build_triggered:' || v_new_pack_id::text
  )
  on conflict (dedupe_key) do nothing;

  update disputes
     set last_event_at = v_now,
         updated_at    = v_now
   where id = v_dispute_id;

  raise notice 'enqueued retry pack % for dispute %', v_new_pack_id, v_dispute_id;
end $$;
