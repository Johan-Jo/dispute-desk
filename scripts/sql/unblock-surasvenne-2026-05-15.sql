-- One-shot unblock for surasvenne.myshopify.com (shop_id e5da0042-…)
--
-- Background
--   The shop's `plan_entitlements.billing_cycle_ends_at` rolled over on
--   2026-05-04 and was never renewed (no renewal cron exists). All
--   `monthly_included` + topup credits expired; `pack_balance.remaining_packs`
--   went to 0. The 13:10:25 cron sync at 2026-05-15 detected the new dispute
--   bd425f70-e62e-42ce-8cfc-44375aa34a6b (FRAUDULENT, mode=auto), but
--   `runAutomationPipeline` returned `quota_exceeded` and silently exited
--   — no pack, no build_pack job, no merchant notification.
--
-- This script restores the merchant to a working state for the current
-- cycle and replays the pipeline side-effects that would have fired at
-- 2026-05-15 13:10:41 if quota had been available. The Vercel worker
-- (`/api/jobs/worker`, every 2 min) will pick up the build_pack job.
--
-- IMPORTANT: this is an emergency hand-rolled equivalent of what
-- `runAutomationPipeline` would have done at sync time. Once the real
-- renewal logic + visibility fixes ship (see docs/prd/billing-lifecycle-prd.md),
-- this script should never need to run again.

do $$
declare
  v_shop_id     uuid := 'e5da0042-a3d4-48f4-88f3-33632a0e12d3';
  v_dispute_id  uuid := 'bd425f70-e62e-42ce-8cfc-44375aa34a6b';
  v_template_id uuid := 'a0000000-0000-0000-0000-000000000001';
  -- Growth plan: 75 packs/month. Cycle: 2026-05-15 → 2026-06-15.
  v_cycle_start timestamptz := '2026-05-15 00:00:00+00';
  v_cycle_end   timestamptz := '2026-06-15 00:00:00+00';
  v_now         timestamptz := now();
  v_pack_id     uuid;
  v_existing_pack uuid;
begin
  -- ── Guard rails ────────────────────────────────────────────
  perform 1 from shops where id = v_shop_id and shop_domain = 'surasvenne.myshopify.com';
  if not found then
    raise exception 'refusing: shop_id % is not surasvenne.myshopify.com', v_shop_id;
  end if;

  perform 1 from disputes
    where id = v_dispute_id
      and shop_id = v_shop_id
      and reason = 'FRAUDULENT'
      and submission_state = 'not_saved';
  if not found then
    raise exception 'refusing: dispute % is not in the expected stranded state', v_dispute_id;
  end if;

  select id into v_existing_pack
    from evidence_packs
    where dispute_id = v_dispute_id
      and status not in ('failed', 'archived')
    limit 1;
  if v_existing_pack is not null then
    raise notice 'pack % already exists for dispute %; skipping pack creation', v_existing_pack, v_dispute_id;
  end if;

  -- ── 1. Grant 75 monthly_included credits for the current cycle ─
  insert into pack_credits_ledger (shop_id, source, packs, expires_at, reference)
  values (
    v_shop_id,
    'monthly_included',
    75,
    v_cycle_end,
    'manual_unblock_2026-05-15_cycle_renewal'
  );
  raise notice 'granted 75 monthly_included credits expiring %', v_cycle_end;

  -- ── 2. Bump plan_entitlements to the current cycle ─────────────
  update plan_entitlements
     set billing_cycle_started_at = v_cycle_start,
         billing_cycle_ends_at    = v_cycle_end,
         updated_at               = v_now
   where shop_id = v_shop_id;
  raise notice 'rolled entitlement cycle to % → %', v_cycle_start, v_cycle_end;

  -- ── 3. Replay runAutomationPipeline side-effects ───────────────
  if v_existing_pack is null then
    insert into evidence_packs (shop_id, dispute_id, status, created_by, pack_template_id)
    values (v_shop_id, v_dispute_id, 'queued', 'automation', v_template_id)
    returning id into v_pack_id;
    raise notice 'created queued pack %', v_pack_id;

    insert into jobs (shop_id, job_type, entity_id)
    values (v_shop_id, 'build_pack', v_pack_id::text);
    raise notice 'enqueued build_pack job for pack %', v_pack_id;

    insert into audit_events (shop_id, dispute_id, pack_id, actor_type, event_type, event_payload)
    values (
      v_shop_id,
      v_dispute_id,
      v_pack_id,
      'system',
      'auto_build_enqueued',
      jsonb_build_object('trigger', 'manual_unblock_2026-05-15')
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
      jsonb_build_object('pack_id', v_pack_id, 'trigger', 'manual_unblock_2026-05-15'),
      v_dispute_id::text || ':auto_build_triggered:' || v_pack_id::text
    )
    on conflict (dedupe_key) do nothing;

    update disputes
       set last_event_at = v_now,
           updated_at    = v_now
     where id = v_dispute_id;
  end if;

  -- ── 4. Verification snapshot (logged via NOTICE) ───────────────
  declare
    v_remaining bigint;
    v_jobs_pending int;
  begin
    select remaining_packs into v_remaining from pack_balance where shop_id = v_shop_id;
    select count(*) into v_jobs_pending
      from jobs
      where shop_id = v_shop_id
        and job_type = 'build_pack'
        and status = 'pending';
    raise notice 'post-unblock state: remaining_packs=%, pending build_pack jobs=%',
      v_remaining, v_jobs_pending;
  end;
end $$;
