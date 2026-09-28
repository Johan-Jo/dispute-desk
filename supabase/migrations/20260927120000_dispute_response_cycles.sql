-- Response cycles: a reopened dispute (or an inquiry escalated to a
-- chargeback) needs a NEW response. Until now the "sent" state from the
-- first response survived the reopen, so the dispute sat as "Under review"
-- with a live deadline and nothing acted on it (Mein Maison #99142/#99348,
-- 2026-09-27). Plan: docs/plans/mein-maison-status-and-no-return.plan.md, Fix B.
--
-- Model:
--   dispute_response_cycles  one row per cycle AFTER the first, keyed by the
--                            prior response it follows (anchor_key). The live
--                            sync, the history reconstruction and the live
--                            repair all write through reconcile_response_cycle,
--                            so the same cycle is never counted twice.
--   disputes.response_cycle  = 1 + count(ledger rows). Derived, never incremented.
--   disputes.reopened_at     = max(ledger.started_at).
--   evidence_packs / defence_packages.response_cycle
--                            stamped at insert from the dispute's current
--                            cycle (trigger below). A cycle-N artifact can
--                            never be filed once the dispute is on N+1.

-- ── Ledger ────────────────────────────────────────────────────────────
create table if not exists dispute_response_cycles (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  cycle int not null check (cycle >= 2),
  started_at timestamptz not null,
  trigger text not null check (trigger in ('reopen','escalation')),
  source text not null check (source in ('live','webhook_history','event_history','live_repair')),
  anchor_key text not null,
  created_at timestamptz not null default now(),
  unique (dispute_id, anchor_key)
);

create index if not exists idx_dispute_response_cycles_dispute
  on dispute_response_cycles (dispute_id, started_at);

alter table dispute_response_cycles enable row level security;
drop policy if exists service_role_full_access_dispute_response_cycles on dispute_response_cycles;
create policy service_role_full_access_dispute_response_cycles
  on dispute_response_cycles for all
  using (true)
  with check (true);

-- ── Columns ───────────────────────────────────────────────────────────
-- `add column … not null default 1` fills every existing row with 1 in the
-- same statement, so no row is ever null when a cycle check reads it. Every
-- dispute and every artifact starts on cycle 1; until a ledger row exists
-- the cycle checks compare 1 with 1 and refuse nothing.
alter table disputes
  add column if not exists response_cycle int not null default 1,
  add column if not exists reopened_at timestamptz,
  add column if not exists escalated_from_inquiry_at timestamptz;

alter table evidence_packs
  add column if not exists response_cycle int not null default 1;

alter table defence_packages
  add column if not exists response_cycle int not null default 1;

comment on column disputes.response_cycle is
  'Current response cycle: 1 + rows in dispute_response_cycles. Written only by reconcile_response_cycle.';
comment on column disputes.reopened_at is
  'Start of the latest response cycle (max dispute_response_cycles.started_at), Shopify''s time.';
comment on column disputes.escalated_from_inquiry_at is
  'When Shopify moved this dispute from inquiry to chargeback.';

-- ── Stamp artifacts at insert ─────────────────────────────────────────
-- Every insert path (pipeline, manual create, regenerate, defence builder)
-- gets the dispute's current cycle without having to remember to pass it.
create or replace function stamp_response_cycle_from_dispute()
returns trigger as $$
begin
  if new.dispute_id is not null then
    select d.response_cycle into new.response_cycle
      from disputes d where d.id = new.dispute_id;
    if new.response_cycle is null then
      new.response_cycle := 1;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists evidence_packs_stamp_response_cycle on evidence_packs;
create trigger evidence_packs_stamp_response_cycle
before insert on evidence_packs
for each row execute function stamp_response_cycle_from_dispute();

drop trigger if exists defence_packages_stamp_response_cycle on defence_packages;
create trigger defence_packages_stamp_response_cycle
before insert on defence_packages
for each row execute function stamp_response_cycle_from_dispute();

-- ── The one writer of cycle state ─────────────────────────────────────
-- Idempotent by construction: the ledger insert is `on conflict do nothing`,
-- the derived columns are recomputed from the ledger, and the reset +
-- retirement run only when this call inserted a row. Re-running with a
-- known anchor, from any path, in any order, changes nothing.
--
-- Artifacts are bounded by p_started_at (Shopify's time, never "now"):
--   created before it  -> previous cycle: packs archived + approval cleared,
--                          open defence packages superseded.
--   created at/after   -> built for this cycle: re-stamped, never retired.
create or replace function reconcile_response_cycle(
  p_dispute_id uuid,
  p_anchor_key text,
  p_started_at timestamptz,
  p_trigger text,
  p_source text
) returns jsonb as $$
declare
  v_inserted boolean := false;
  v_cycle int;
  v_reopened_at timestamptz;
  v_prev record;
  v_retired_packs uuid[] := '{}';
  v_retired_approvals jsonb := '[]'::jsonb;
  v_superseded_defence uuid[] := '{}';
  v_restamped_packs uuid[] := '{}';
begin
  -- Serialise concurrent reconciles of the same dispute (webhook + cron).
  perform 1 from disputes where id = p_dispute_id for update;
  if not found then
    raise exception 'reconcile_response_cycle: dispute % not found', p_dispute_id;
  end if;

  select submitted_at, submission_state, review_state, evidence_saved_to_shopify_at, closed_at, status
    into v_prev
    from disputes where id = p_dispute_id;

  insert into dispute_response_cycles (dispute_id, cycle, started_at, trigger, source, anchor_key)
  values (
    p_dispute_id,
    2 + (select count(*) from dispute_response_cycles where dispute_id = p_dispute_id),
    p_started_at, p_trigger, p_source, p_anchor_key
  )
  on conflict (dispute_id, anchor_key) do nothing;
  v_inserted := found;

  -- Renumber by start time so a cycle discovered late (history run after
  -- live) still lands in chronological order.
  update dispute_response_cycles c
     set cycle = r.rn + 1
    from (
      select id, row_number() over (order by started_at, anchor_key) as rn
        from dispute_response_cycles where dispute_id = p_dispute_id
    ) r
   where c.id = r.id and c.cycle is distinct from r.rn + 1;

  select 1 + count(*), max(started_at)
    into v_cycle, v_reopened_at
    from dispute_response_cycles where dispute_id = p_dispute_id;

  -- Only the count is corrected (no reset, nothing retired) when:
  --   * the anchor was already known;
  --   * the cycle is OLDER than the current one (history reconstruction
  --     after a later cycle was opened) — the dispute's state belongs to the
  --     later cycle, whose artifacts were bounded when it opened;
  --   * the dispute is closed — its record of what was sent is history;
  --   * Shopify is not CURRENTLY asking for a response (status is not
  --     needs_response) — an old reopen that has since been answered or
  --     decided must not flip the dispute back to "needs a response";
  --   * a response was already recorded AFTER this cycle began — the new
  --     round was answered, and clearing that would lose a real filing.
  if not v_inserted
     or p_started_at < v_reopened_at
     or v_prev.closed_at is not null
     or v_prev.status is distinct from 'needs_response'
     or greatest(v_prev.submitted_at, v_prev.evidence_saved_to_shopify_at) > p_started_at
  then
    update disputes
       set response_cycle = v_cycle, reopened_at = v_reopened_at
     where id = p_dispute_id
       and (response_cycle is distinct from v_cycle or reopened_at is distinct from v_reopened_at);
    return jsonb_build_object(
      'inserted', v_inserted, 'reset', false, 'cycle', v_cycle, 'reopened_at', v_reopened_at
    );
  end if;

  -- Artifacts built at/after the latest cycle start belong to it.
  with s as (
    update evidence_packs
       set response_cycle = v_cycle
     where dispute_id = p_dispute_id
       and created_at >= v_reopened_at
       and response_cycle <> v_cycle
    returning id
  ) select coalesce(array_agg(id), '{}') into v_restamped_packs from s;

  update defence_packages
     set response_cycle = v_cycle
   where dispute_id = p_dispute_id
     and generated_at >= v_reopened_at
     and response_cycle <> v_cycle;

  -- Retire the previous cycle's artifacts (created before this cycle began).
  select coalesce(jsonb_agg(jsonb_build_object('pack_id', id, 'approved_for_save_at', approved_for_save_at))
                    filter (where approved_for_save_at is not null), '[]'::jsonb)
    into v_retired_approvals
    from evidence_packs
   where dispute_id = p_dispute_id
     and created_at < p_started_at
     and status not in ('archived', 'failed');

  with r as (
    update evidence_packs
       set status = 'archived',
           approved_for_save_at = null,
           updated_at = now()
     where dispute_id = p_dispute_id
       and created_at < p_started_at
       and status not in ('archived', 'failed')
    returning id
  ) select coalesce(array_agg(id), '{}') into v_retired_packs from r;

  with r as (
    update defence_packages
       set status = 'superseded'
     where dispute_id = p_dispute_id
       and generated_at < p_started_at
       and status in ('draft', 'stale', 'final')
    returning id
  ) select coalesce(array_agg(id), '{}') into v_superseded_defence from r;

  -- Reset the "sent" state. This is the one sanctioned override of the
  -- evidence_sent_on walk-back guard in applyDisputeSnapshot; the previous
  -- values are returned for the event metadata.
  update disputes
     set response_cycle = v_cycle,
         reopened_at = v_reopened_at,
         submitted_at = null,
         submission_state = 'not_saved',
         evidence_saved_to_shopify_at = null,
         reminder_sent_at = null,
         review_state = null,
         review_due_at = null,
         updated_at = now()
   where id = p_dispute_id;

  return jsonb_build_object(
    'inserted', true,
    'reset', true,
    'cycle', v_cycle,
    'reopened_at', v_reopened_at,
    'previous', jsonb_build_object(
      'submitted_at', v_prev.submitted_at,
      'submission_state', v_prev.submission_state,
      'review_state', v_prev.review_state,
      'evidence_saved_to_shopify_at', v_prev.evidence_saved_to_shopify_at
    ),
    'retired_pack_ids', to_jsonb(v_retired_packs),
    'retired_approvals', v_retired_approvals,
    'superseded_defence_package_ids', to_jsonb(v_superseded_defence),
    'restamped_pack_ids', to_jsonb(v_restamped_packs)
  );
end;
$$ language plpgsql;

revoke all on function reconcile_response_cycle(uuid, text, timestamptz, text, text) from public, anon, authenticated;
