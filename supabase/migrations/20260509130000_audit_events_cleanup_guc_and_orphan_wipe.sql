-- 20260509130000: audit_events cleanup escape-hatch + one-shot orphan wipe.
--
-- Why this exists
-- ---------------
-- `004_audit_events.sql` made `audit_events` strictly append-only via two
-- BEFORE triggers (`trg_audit_no_update`, `trg_audit_no_delete`). Combined
-- with NO ACTION FKs from `audit_events.dispute_id` and
-- `audit_events.pack_id`, this means once *any* audit event references a
-- dispute or pack, that dispute/pack is undeletable too. The E2E fixture
-- helper at `e2e/helpers/dbFixtures.ts` could not honour its own cleanup
-- contract, so every E2E run that exercises `POST /api/packs/:id/save-to-
-- shopify` (which writes audit events) leaked rows into the production
-- Supabase project — visible on the merchant dashboard as ghost disputes.
--
-- This migration does two things:
--
-- 1. Replaces the immutability function with one that respects a session-
--    level GUC: `app.allow_audit_mutation = 'on'`. Normal app traffic
--    never sets the GUC, so the immutability guarantee is preserved.
--    Privileged cleanup paths (E2E `cleanup()`, ops scripts) set it for
--    the lifetime of their connection and can then DELETE/UPDATE audit
--    rows. This is the same pattern Supabase itself uses for
--    `auth.users.is_super_admin` style escape hatches.
--
-- 2. Performs a one-shot wipe of the 29 orphan E2E-fixture disputes
--    currently polluting the dashboard. Targets ONLY dispute_gid values
--    matching the E2E fixture pattern (`gid://shopify/ShopifyPaymentsDispute/test-<uuid>`)
--    — never touches real Shopify-mirrored disputes (`-{numeric}`) or
--    synthetic-seeder rows (`-seed-*`). Runs inside this migration's
--    implicit transaction so a wipe failure rolls back the trigger
--    change too.
--
-- What this does NOT do
-- ---------------------
-- - It does not change the FK ON DELETE behaviour. We still want NO ACTION
--   so accidental delete attempts fail loudly under normal operation.
-- - It does not weaken the trigger for arbitrary callers — only sessions
--   that explicitly opt in via the GUC, which the service role can set
--   but anon/authenticated cannot meaningfully use (RLS blocks them long
--   before the trigger fires).
-- - It does not add ON DELETE CASCADE; cascading deletes would silently
--   wipe audit history when the parent dispute is deleted by ordinary
--   code, which would defeat the audit guarantee.

-- ── Step 1: Relax the immutability trigger to honour the session GUC ───

create or replace function reject_audit_mutation()
returns trigger as $$
begin
  -- Privileged cleanup paths (E2E fixture teardown, ops wipe scripts)
  -- set this GUC at the start of their connection. Everything else
  -- (app code, user requests via PostgREST) leaves it unset and the
  -- immutability invariant holds.
  if current_setting('app.allow_audit_mutation', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception 'audit_events is append-only: % not allowed', tg_op;
  return null;
end;
$$ language plpgsql;

-- Triggers themselves don't change — they already point at this function.

-- ── Step 2: One-shot wipe of orphan E2E fixture rows ───────────────────
-- Scope: dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/test-%'
-- The `test-<uuid>` pattern is hardcoded in `e2e/helpers/dbFixtures.ts`
-- and never overlaps with Shopify's real GIDs (which are numeric).

do $$
declare
  v_dispute_ids uuid[];
  v_pack_ids    uuid[];
  v_disputes_deleted int := 0;
  v_packs_deleted    int := 0;
  v_audits_deleted   int := 0;
  v_jobs_deleted     int := 0;
  v_step_count       int;
begin
  select array_agg(id) into v_dispute_ids
    from disputes
    where dispute_gid like 'gid://shopify/ShopifyPaymentsDispute/test-%';

  if v_dispute_ids is null or array_length(v_dispute_ids, 1) is null then
    raise notice 'no orphan E2E fixture disputes — wipe skipped';
    return;
  end if;

  select array_agg(id) into v_pack_ids
    from evidence_packs
    where dispute_id = any(v_dispute_ids);

  -- Allow audit mutation only for the duration of this DO block.
  perform set_config('app.allow_audit_mutation', 'on', true); -- true = local to txn

  -- 1. Audit events that reference the orphan disputes/packs. Run as
  --    two separate statements; GET DIAGNOSTICS only accepts a bare
  --    column on the right-hand side, so we accumulate via a step var.
  delete from audit_events where dispute_id = any(v_dispute_ids);
  get diagnostics v_step_count = row_count;
  v_audits_deleted := v_audits_deleted + v_step_count;

  if v_pack_ids is not null and array_length(v_pack_ids, 1) is not null then
    delete from audit_events where pack_id = any(v_pack_ids);
    get diagnostics v_step_count = row_count;
    v_audits_deleted := v_audits_deleted + v_step_count;
  end if;

  -- 2. Jobs that reference the orphan packs (entity_id is the pack id
  --    for build_pack / save_to_shopify job types). `jobs.entity_id` is
  --    `text` (it can hold non-UUID identifiers for some job types), so
  --    we cast the uuid array to text[] before the lookup.
  if v_pack_ids is not null and array_length(v_pack_ids, 1) is not null then
    delete from jobs where entity_id = any(v_pack_ids::text[]);
    get diagnostics v_jobs_deleted = row_count;
  end if;

  -- 3. Evidence packs.
  if v_pack_ids is not null and array_length(v_pack_ids, 1) is not null then
    delete from evidence_packs where id = any(v_pack_ids);
    get diagnostics v_packs_deleted = row_count;
  end if;

  -- 4. Disputes.
  delete from disputes where id = any(v_dispute_ids);
  get diagnostics v_disputes_deleted = row_count;

  raise notice 'orphan wipe — disputes=% packs=% jobs=% audit_events=%',
    v_disputes_deleted, v_packs_deleted, v_jobs_deleted, v_audits_deleted;

  -- GUC scoped to txn (third arg = true), so it auto-resets on commit.
end $$;
