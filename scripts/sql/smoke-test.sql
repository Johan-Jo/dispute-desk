-- E2E smoke test (canonical path).
-- Equivalent of scripts/smoke-test.mjs but runs via `supabase db query --linked`
-- so it does not depend on SUPABASE_URL_POSTGRES (which rots on password rotation).
--
-- Run: npx supabase db query --linked --file scripts/sql/smoke-test.sql
-- Any failed assertion raises an exception; success returns a summary row.

BEGIN;

DO $smoke$
DECLARE
  v_shop_id            uuid;
  v_dispute_id         uuid;
  v_pack_id            uuid;
  v_job_id             uuid;
  v_audit_id           uuid;
  v_settings           record;
  v_disputes           record;
  v_pack               record;
  v_blockers_len       int;
  v_status_count       int;
  v_min_score          int;
  v_immutability_held  boolean := false;
  v_now                timestamptz := now();
BEGIN
  RAISE NOTICE '=== DisputeDesk Smoke Test (SQL via Management API) ===';

  -- 1. Test shop exists (upsert)
  RAISE NOTICE 'Step 1: Ensure test shop exists';
  INSERT INTO shops (shop_domain, shop_id, plan)
  VALUES ('smoke-test.myshopify.com', 'smoke-test-001', 'starter')
  ON CONFLICT (shop_domain) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_shop_id;
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 1: shop id null';
  END IF;
  RAISE NOTICE '  shop_id = %', v_shop_id;

  -- 2. shop_settings upsert + defaults
  RAISE NOTICE 'Step 2: shop_settings upsert + defaults';
  PERFORM ensure_shop_settings(v_shop_id);
  SELECT * INTO v_settings FROM shop_settings WHERE shop_id = v_shop_id;
  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 2: shop_settings row missing';
  END IF;
  IF v_settings.auto_build_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL step 2: auto_build_enabled expected true, got %', v_settings.auto_build_enabled;
  END IF;
  IF v_settings.auto_save_min_score <> 80 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 2: auto_save_min_score expected 80, got %', v_settings.auto_save_min_score;
  END IF;
  -- Reset auto_save_enabled to false (in case row existed from prior run)
  UPDATE shop_settings SET auto_save_enabled = false WHERE shop_id = v_shop_id;
  SELECT * INTO v_settings FROM shop_settings WHERE shop_id = v_shop_id;
  IF v_settings.auto_save_enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'SMOKE FAIL step 2: auto_save_enabled expected false after reset, got %', v_settings.auto_save_enabled;
  END IF;

  -- 3. Seed dispute
  RAISE NOTICE 'Step 3: Seed test dispute';
  INSERT INTO disputes (shop_id, dispute_gid, reason, status, amount, currency_code, due_at)
  VALUES (v_shop_id, 'gid://shopify/Dispute/smoke-001', 'PRODUCT_NOT_RECEIVED', 'needs_response', 145.00, 'USD', now() + interval '7 days')
  ON CONFLICT (shop_id, dispute_gid) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_dispute_id;
  IF v_dispute_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 3: dispute id null';
  END IF;
  RAISE NOTICE '  dispute_id = %', v_dispute_id;

  -- 4. Verify dispute round-trip
  RAISE NOTICE 'Step 4: Verify dispute in DB';
  SELECT * INTO v_disputes FROM disputes
  WHERE shop_id = v_shop_id AND dispute_gid = 'gid://shopify/Dispute/smoke-001';
  IF v_disputes.reason <> 'PRODUCT_NOT_RECEIVED' THEN
    RAISE EXCEPTION 'SMOKE FAIL step 4: reason mismatch, got %', v_disputes.reason;
  END IF;
  IF v_disputes.amount::numeric <> 145 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 4: amount mismatch, got %', v_disputes.amount;
  END IF;

  -- 5. Create evidence pack + enqueue job
  RAISE NOTICE 'Step 5: Create evidence pack + enqueue job';
  INSERT INTO evidence_packs (shop_id, dispute_id, status, created_by)
  VALUES (v_shop_id, v_dispute_id, 'queued', 'smoke-test')
  RETURNING id INTO v_pack_id;
  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 5: pack id null';
  END IF;
  INSERT INTO jobs (shop_id, job_type, entity_id)
  VALUES (v_shop_id, 'build_pack', v_pack_id)
  RETURNING id INTO v_job_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 5: job id null';
  END IF;
  RAISE NOTICE '  pack_id=%  job_id=%', v_pack_id, v_job_id;

  -- 6. Simulate low-completeness build → blocked
  RAISE NOTICE 'Step 6: Simulate pack build (blocked, score=20)';
  UPDATE evidence_packs SET
    status = 'blocked',
    completeness_score = 20,
    blockers = '["Shipping Tracking","Delivery Proof"]'::jsonb,
    recommended_actions = '["Add Shipping Policy","Add Customer Communication"]'::jsonb,
    pack_json = '{"version":1}'::jsonb,
    updated_at = now()
  WHERE id = v_pack_id;
  SELECT * INTO v_pack FROM evidence_packs WHERE id = v_pack_id;
  IF v_pack.status <> 'blocked' THEN
    RAISE EXCEPTION 'SMOKE FAIL step 6: status expected blocked, got %', v_pack.status;
  END IF;
  IF v_pack.completeness_score <> 20 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 6: score expected 20, got %', v_pack.completeness_score;
  END IF;
  v_blockers_len := jsonb_array_length(v_pack.blockers);
  IF v_blockers_len <> 2 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 6: blockers len expected 2, got %', v_blockers_len;
  END IF;

  -- 7. Auto-save gate: score below threshold → blocks
  RAISE NOTICE 'Step 7: Auto-save gate (score < threshold)';
  UPDATE shop_settings SET auto_save_enabled = true WHERE shop_id = v_shop_id;
  SELECT auto_save_min_score INTO v_min_score FROM shop_settings WHERE shop_id = v_shop_id;
  IF NOT (v_pack.completeness_score < v_min_score) THEN
    RAISE EXCEPTION 'SMOKE FAIL step 7: gate logic — score % should be < threshold %', v_pack.completeness_score, v_min_score;
  END IF;

  -- 8. High-score pack → ready, passes gate
  RAISE NOTICE 'Step 8: Simulate complete pack (ready, score=95)';
  UPDATE evidence_packs SET
    status = 'ready',
    completeness_score = 95,
    blockers = '[]'::jsonb,
    updated_at = now()
  WHERE id = v_pack_id;
  SELECT * INTO v_pack FROM evidence_packs WHERE id = v_pack_id;
  IF v_pack.status <> 'ready' THEN
    RAISE EXCEPTION 'SMOKE FAIL step 8: status expected ready, got %', v_pack.status;
  END IF;
  IF jsonb_array_length(v_pack.blockers) <> 0 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 8: blockers should be empty';
  END IF;
  IF NOT (v_pack.completeness_score >= v_min_score) THEN
    RAISE EXCEPTION 'SMOKE FAIL step 8: gate logic — score % should be >= threshold %', v_pack.completeness_score, v_min_score;
  END IF;

  -- 9. Save to Shopify
  RAISE NOTICE 'Step 9: Simulate save to Shopify';
  UPDATE evidence_packs SET
    status = 'saved_to_shopify',
    saved_to_shopify_at = v_now,
    updated_at = now()
  WHERE id = v_pack_id;
  SELECT * INTO v_pack FROM evidence_packs WHERE id = v_pack_id;
  IF v_pack.status <> 'saved_to_shopify' THEN
    RAISE EXCEPTION 'SMOKE FAIL step 9: status expected saved_to_shopify, got %', v_pack.status;
  END IF;
  IF v_pack.saved_to_shopify_at IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 9: saved_to_shopify_at not set';
  END IF;

  -- 10. Audit event recorded
  RAISE NOTICE 'Step 10: Audit log recording';
  INSERT INTO audit_events (shop_id, dispute_id, pack_id, actor_type, event_type, event_payload)
  VALUES (v_shop_id, v_dispute_id, v_pack_id, 'system', 'evidence_saved_to_shopify', '{"test":true}'::jsonb)
  RETURNING id INTO v_audit_id;
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'SMOKE FAIL step 10: audit id null';
  END IF;

  -- 11. Audit immutability: UPDATE must raise
  RAISE NOTICE 'Step 11: Audit log immutability (UPDATE must fail)';
  BEGIN
    UPDATE audit_events SET event_type = 'hacked' WHERE id = v_audit_id;
    -- If we get here, the trigger did not fire — that is a failure
    v_immutability_held := false;
  EXCEPTION WHEN OTHERS THEN
    v_immutability_held := true;
    RAISE NOTICE '  UPDATE correctly rejected: %', SQLERRM;
  END;
  IF NOT v_immutability_held THEN
    RAISE EXCEPTION 'SMOKE FAIL step 11: UPDATE on audit_events did not raise';
  END IF;

  -- 12. Extended status enum values accepted
  RAISE NOTICE 'Step 12: Extended status enum';
  INSERT INTO evidence_packs (shop_id, dispute_id, status, created_by)
  VALUES (v_shop_id, v_dispute_id, 'draft', 'enum-test'),
         (v_shop_id, v_dispute_id, 'blocked', 'enum-test'),
         (v_shop_id, v_dispute_id, 'saved_to_shopify', 'enum-test');
  SELECT count(*) INTO v_status_count FROM evidence_packs
  WHERE shop_id = v_shop_id AND created_by = 'enum-test';
  IF v_status_count <> 3 THEN
    RAISE EXCEPTION 'SMOKE FAIL step 12: expected 3 enum-test packs, got %', v_status_count;
  END IF;

  -- 13. Cleanup (disable audit triggers, scrub all test data)
  RAISE NOTICE 'Step 13: Cleanup';
  ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_delete;
  DELETE FROM audit_events WHERE shop_id = v_shop_id;
  ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_delete;
  DELETE FROM evidence_packs WHERE shop_id = v_shop_id;
  DELETE FROM jobs WHERE shop_id = v_shop_id;
  DELETE FROM disputes WHERE shop_id = v_shop_id;
  DELETE FROM shop_settings WHERE shop_id = v_shop_id;
  DELETE FROM shops WHERE id = v_shop_id;

  RAISE NOTICE '=== SMOKE PASS: all 13 steps verified ===';
END
$smoke$;

COMMIT;

-- Final sanity confirmation row.
SELECT 'smoke-pass'::text AS result, now() AS at;
