-- 20260509140000: RPC for E2E fixture cleanup.
--
-- Companion to `20260509130000_audit_events_cleanup_guc_and_orphan_wipe.sql`,
-- which relaxed the audit-immutability triggers to honour an
-- `app.allow_audit_mutation` GUC. PostgREST clients (supabase-js, used
-- by `e2e/helpers/dbFixtures.ts`) cannot set session GUCs from the
-- client side — each REST call borrows a fresh pooler connection, so
-- any GUC set there is gone before the next call. The fix: a SECURITY
-- DEFINER function that atomically (a) flips the GUC inside its own
-- transaction, (b) deletes audit/jobs/pack/dispute rows for one
-- fixture, and (c) returns the row counts.
--
-- Scope guard
-- -----------
-- Refuses any dispute_gid that doesn't match the E2E fixture pattern
-- (`gid://shopify/ShopifyPaymentsDispute/test-<uuid>`). Even with EXECUTE
-- granted to `service_role`, the function can never be turned on real
-- Shopify-mirrored disputes — the LIKE check is the structural guard.
--
-- Privilege model
-- ---------------
-- - Owned by `postgres` (the migration runner). `SECURITY DEFINER` ⇒
--   runs with owner privileges, bypassing the audit-events trigger via
--   the GUC.
-- - REVOKE from public/anon/authenticated; GRANT EXECUTE to
--   service_role only. Production app paths use service_role too, but
--   the dispute_gid pattern guard ensures they can't accidentally
--   delete real disputes — a safety net.

create or replace function delete_e2e_fixture_dispute(p_dispute_id uuid)
returns table (
  audits_deleted   int,
  jobs_deleted     int,
  packs_deleted    int,
  disputes_deleted int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_ids       uuid[];
  v_audits_deleted int := 0;
  v_jobs_deleted   int := 0;
  v_packs_deleted  int := 0;
  v_disp_deleted   int := 0;
  v_step           int;
  v_gid            text;
begin
  select dispute_gid into v_gid from disputes where id = p_dispute_id;
  if v_gid is null then
    -- Idempotent: caller's afterEach can run twice without erroring.
    return query select 0, 0, 0, 0;
    return;
  end if;
  if v_gid not like 'gid://shopify/ShopifyPaymentsDispute/test-%' then
    raise exception 'delete_e2e_fixture_dispute: refusing to delete non-fixture dispute %', v_gid;
  end if;

  select array_agg(id) into v_pack_ids
    from evidence_packs
    where dispute_id = p_dispute_id;

  perform set_config('app.allow_audit_mutation', 'on', true);

  delete from audit_events where dispute_id = p_dispute_id;
  get diagnostics v_step = row_count;
  v_audits_deleted := v_audits_deleted + v_step;

  if v_pack_ids is not null and array_length(v_pack_ids, 1) is not null then
    delete from audit_events where pack_id = any(v_pack_ids);
    get diagnostics v_step = row_count;
    v_audits_deleted := v_audits_deleted + v_step;

    -- jobs.entity_id is text, not uuid.
    delete from jobs where entity_id = any(v_pack_ids::text[]);
    get diagnostics v_jobs_deleted = row_count;

    delete from evidence_packs where id = any(v_pack_ids);
    get diagnostics v_packs_deleted = row_count;
  end if;

  delete from disputes where id = p_dispute_id;
  get diagnostics v_disp_deleted = row_count;

  return query select v_audits_deleted, v_jobs_deleted, v_packs_deleted, v_disp_deleted;
end;
$$;

revoke all on function delete_e2e_fixture_dispute(uuid) from public;
revoke all on function delete_e2e_fixture_dispute(uuid) from anon;
revoke all on function delete_e2e_fixture_dispute(uuid) from authenticated;
grant execute on function delete_e2e_fixture_dispute(uuid) to service_role;
