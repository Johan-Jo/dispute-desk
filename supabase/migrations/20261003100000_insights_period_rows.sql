-- Insights PR2: correctable per-shop calendar-month rows with a revision log
-- and ONE transactional writer (docs/plans/insights-single-source.plan.md §2.6).
--
-- Why: on 2026-10-02 four code paths computed "the chargeback rate" for one
-- merchant and none agreed (5.31% / 0.90% / 0.1% / 0.15%). From this change
-- `ratio_snapshots` is the single record every surface reads; it is written
-- only by `persist_shop_month`, which locks, hashes, logs and upserts in one
-- transaction, so the row and its log can never disagree.
--
-- Additive. Existing columns keep their names; their meaning from now on is
-- the v2 definition (card-rail chargebacks initiated in the month, inquiries
-- excluded), documented in docs/technical.md.

-- ── ratio_snapshots: v2 columns ───────────────────────────────────────
alter table public.ratio_snapshots
  add column if not exists card_chargeback_count int,
  add column if not exists visa_chargeback_count int,
  add column if not exists mc_chargeback_count int,
  add column if not exists unknown_network_chargeback_count int,
  add column if not exists unresolved_rail_dispute_count int,
  add column if not exists unknown_settled_count int,
  add column if not exists ecm_denominator_count int,
  add column if not exists card_dispute_ratio numeric(8, 5),
  add column if not exists card_dispute_share numeric(8, 5),
  add column if not exists vamp_floor_met boolean,
  add column if not exists ecm_floor_met boolean,
  add column if not exists card_framing_applies boolean,
  add column if not exists coverage text,
  add column if not exists stable_at timestamptz,
  add column if not exists revised_at timestamptz,
  add column if not exists revision int not null default 0,
  add column if not exists revision_reason text,
  add column if not exists metrics_version smallint not null default 1,
  add column if not exists thresholds_version text,
  add column if not exists operational_metrics jsonb,
  add column if not exists checkpoints jsonb,
  add column if not exists values_hash text;

alter table public.ratio_snapshots
  drop constraint if exists ratio_snapshots_coverage_check;
alter table public.ratio_snapshots
  add constraint ratio_snapshots_coverage_check
  check (coverage is null or coverage in ('full', 'partial'));

comment on column public.ratio_snapshots.card_dispute_ratio is
  'Card-rail chargebacks initiated in the month (inquiries excluded) / card-rail settled orders created in the month, rounded once to 5 dp. NULL below 50 settled orders. The headline every Insights surface shows.';
comment on column public.ratio_snapshots.stable_at is
  'Set when the month became final (8th of the next month, import complete, full coverage). Eligible for email and the default view; NOT immutable — later corrections are logged revisions.';
comment on column public.ratio_snapshots.revision is
  'Current revision. ratio_snapshot_revisions holds every state, including this one (same values_hash).';

-- ── ratio_snapshot_revisions ─────────────────────────────────────────
create table if not exists public.ratio_snapshot_revisions (
  id bigserial primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  period_month date not null,
  revision int not null,
  "values" jsonb not null,
  values_hash text not null,
  reason text not null,
  metrics_version smallint not null,
  thresholds_version text,
  created_at timestamptz not null default now(),
  unique (shop_id, period_month, revision)
);

comment on table public.ratio_snapshot_revisions is
  'Every state of every ratio_snapshots row. Revision 0 = the pre-v2 backup taken by migration 20261003100000. Written only by persist_shop_month.';

-- Revision 0: back up every existing row, then stamp its hash on the row.
-- Insert first, while values_hash is still NULL, so the backup hash and the
-- row hash are computed from the same bytes.
insert into public.ratio_snapshot_revisions
  (shop_id, period_month, revision, "values", values_hash, reason, metrics_version, thresholds_version)
select r.shop_id, r.period_month, 0, to_jsonb(r), md5(to_jsonb(r)::text), 'pre_v2_backup', 1, null
from public.ratio_snapshots r
on conflict (shop_id, period_month, revision) do nothing;

update public.ratio_snapshots r
   set values_hash = v.values_hash
  from public.ratio_snapshot_revisions v
 where v.shop_id = r.shop_id
   and v.period_month = r.period_month
   and v.revision = 0
   and r.values_hash is null;

-- ── insights_ops_alerts ──────────────────────────────────────────────
create table if not exists public.insights_ops_alerts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  alert_key text not null,
  period_month date not null,
  created_at timestamptz not null default now(),
  unique (shop_id, alert_key, period_month)
);

comment on table public.insights_ops_alerts is
  'Dedup for internal Insights alerts (e.g. m1_not_stable): one email per (shop, key, month).';

-- Server-only tables: RLS on, no policies, no client grants.
alter table public.ratio_snapshot_revisions enable row level security;
alter table public.insights_ops_alerts enable row level security;
revoke all on public.ratio_snapshot_revisions from public, anon, authenticated;
revoke all on public.insights_ops_alerts from public, anon, authenticated;
grant all on public.ratio_snapshot_revisions to service_role;
grant all on public.insights_ops_alerts to service_role;
grant usage, select on sequence public.ratio_snapshot_revisions_id_seq to service_role;

-- ── persist_shop_month: the only writer ──────────────────────────────
--
-- p_values: the month's v2 payload, keys = ratio_snapshots column names.
-- Ratios must already be rounded to 5 dp (computeProgrammeBlock does it);
-- anything finer raises, so the row and the log hold one representation.
-- Returns {changed, revision, stable_at}.
create or replace function public.persist_shop_month(
  p_shop_id uuid,
  p_period_month date,
  p_values jsonb,
  p_reason text,
  p_mark_stable boolean,
  p_metrics_version smallint,
  p_thresholds_version text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := md5(p_values::text);
  v_row public.ratio_snapshots%rowtype;
  v_found boolean;
  v_rev int;
  v_key text;
  v_num numeric;
begin
  -- Serialise every writer of this (shop, month), including the first
  -- insert, which FOR UPDATE alone cannot lock.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_period_month::text, 0));

  if coalesce(p_values->>'coverage', '') not in ('full', 'partial') then
    raise exception 'persist_shop_month: coverage must be full|partial, got %', p_values->>'coverage';
  end if;

  foreach v_key in array array['card_dispute_ratio', 'vamp_ratio_calculated', 'vamp_ratio_without_dd', 'mc_ecm_ratio', 'card_dispute_share'] loop
    if p_values ? v_key and jsonb_typeof(p_values->v_key) = 'number' then
      v_num := (p_values->>v_key)::numeric;
      if round(v_num, 5) <> v_num then
        raise exception 'persist_shop_month: % has more than 5 decimals (%)', v_key, v_num;
      end if;
    end if;
  end loop;

  select * into v_row
    from public.ratio_snapshots
   where shop_id = p_shop_id and period_month = p_period_month
   for update;
  v_found := found;

  if v_found and v_row.values_hash = v_hash then
    if p_mark_stable and v_row.stable_at is null then
      update public.ratio_snapshots set stable_at = now()
       where shop_id = p_shop_id and period_month = p_period_month;
      return jsonb_build_object('changed', false, 'revision', v_row.revision, 'stable_at', now());
    end if;
    return jsonb_build_object('changed', false, 'revision', v_row.revision, 'stable_at', v_row.stable_at);
  end if;

  select coalesce(max(revision), -1) + 1 into v_rev
    from public.ratio_snapshot_revisions
   where shop_id = p_shop_id and period_month = p_period_month;
  if v_rev = 0 and v_found then v_rev := 1; end if;

  insert into public.ratio_snapshot_revisions
    (shop_id, period_month, revision, "values", values_hash, reason, metrics_version, thresholds_version)
  values
    (p_shop_id, p_period_month, v_rev, p_values, v_hash, p_reason, p_metrics_version, p_thresholds_version);

  insert into public.ratio_snapshots as r (
    shop_id, period_month,
    settled_count, tc40_count, tc15_count,
    vamp_ratio_calculated, vamp_ratio_without_dd,
    ce30_excluded_count, fpt_excluded_count, rdr_excluded_count,
    mc_settled_count, mc_ecm_chargeback_count, mc_ecm_ratio, mc_efm_fraud_count, mc_efm_ratio,
    estimated_fees_avoided_usd, estimated_revenue_recovered_usd,
    card_chargeback_count, visa_chargeback_count, mc_chargeback_count,
    unknown_network_chargeback_count, unresolved_rail_dispute_count,
    unknown_settled_count, ecm_denominator_count,
    card_dispute_ratio, card_dispute_share,
    vamp_floor_met, ecm_floor_met, card_framing_applies, coverage,
    stable_at, revised_at, revision, revision_reason,
    metrics_version, thresholds_version, operational_metrics, checkpoints, values_hash,
    calculated_at
  ) values (
    p_shop_id, p_period_month,
    coalesce((p_values->>'settled_count')::int, 0),
    coalesce((p_values->>'tc40_count')::int, 0),
    coalesce((p_values->>'tc15_count')::int, 0),
    (p_values->>'vamp_ratio_calculated')::numeric,
    (p_values->>'vamp_ratio_without_dd')::numeric,
    coalesce((p_values->>'ce30_excluded_count')::int, 0),
    coalesce((p_values->>'fpt_excluded_count')::int, 0),
    0,
    coalesce((p_values->>'mc_settled_count')::int, 0),
    coalesce((p_values->>'mc_ecm_chargeback_count')::int, 0),
    (p_values->>'mc_ecm_ratio')::numeric,
    coalesce((p_values->>'mc_efm_fraud_count')::int, 0),
    null,
    coalesce((p_values->>'estimated_fees_avoided_usd')::numeric, 0),
    coalesce((p_values->>'estimated_revenue_recovered_usd')::numeric, 0),
    (p_values->>'card_chargeback_count')::int,
    (p_values->>'visa_chargeback_count')::int,
    (p_values->>'mc_chargeback_count')::int,
    (p_values->>'unknown_network_chargeback_count')::int,
    (p_values->>'unresolved_rail_dispute_count')::int,
    (p_values->>'unknown_settled_count')::int,
    (p_values->>'ecm_denominator_count')::int,
    (p_values->>'card_dispute_ratio')::numeric,
    (p_values->>'card_dispute_share')::numeric,
    (p_values->>'vamp_floor_met')::boolean,
    (p_values->>'ecm_floor_met')::boolean,
    (p_values->>'card_framing_applies')::boolean,
    p_values->>'coverage',
    case when p_mark_stable then now() else null end,
    case when v_found then now() else null end,
    v_rev,
    p_reason,
    p_metrics_version,
    p_thresholds_version,
    p_values->'operational_metrics',
    p_values->'checkpoints',
    v_hash,
    now()
  )
  on conflict (shop_id, period_month) do update set
    settled_count = excluded.settled_count,
    tc40_count = excluded.tc40_count,
    tc15_count = excluded.tc15_count,
    vamp_ratio_calculated = excluded.vamp_ratio_calculated,
    vamp_ratio_without_dd = excluded.vamp_ratio_without_dd,
    ce30_excluded_count = excluded.ce30_excluded_count,
    fpt_excluded_count = excluded.fpt_excluded_count,
    rdr_excluded_count = excluded.rdr_excluded_count,
    mc_settled_count = excluded.mc_settled_count,
    mc_ecm_chargeback_count = excluded.mc_ecm_chargeback_count,
    mc_ecm_ratio = excluded.mc_ecm_ratio,
    mc_efm_fraud_count = excluded.mc_efm_fraud_count,
    mc_efm_ratio = excluded.mc_efm_ratio,
    estimated_fees_avoided_usd = excluded.estimated_fees_avoided_usd,
    estimated_revenue_recovered_usd = excluded.estimated_revenue_recovered_usd,
    card_chargeback_count = excluded.card_chargeback_count,
    visa_chargeback_count = excluded.visa_chargeback_count,
    mc_chargeback_count = excluded.mc_chargeback_count,
    unknown_network_chargeback_count = excluded.unknown_network_chargeback_count,
    unresolved_rail_dispute_count = excluded.unresolved_rail_dispute_count,
    unknown_settled_count = excluded.unknown_settled_count,
    ecm_denominator_count = excluded.ecm_denominator_count,
    card_dispute_ratio = excluded.card_dispute_ratio,
    card_dispute_share = excluded.card_dispute_share,
    vamp_floor_met = excluded.vamp_floor_met,
    ecm_floor_met = excluded.ecm_floor_met,
    card_framing_applies = excluded.card_framing_applies,
    coverage = excluded.coverage,
    stable_at = case when p_mark_stable then coalesce(r.stable_at, now()) else r.stable_at end,
    revised_at = now(),
    revision = excluded.revision,
    revision_reason = excluded.revision_reason,
    metrics_version = excluded.metrics_version,
    thresholds_version = excluded.thresholds_version,
    operational_metrics = excluded.operational_metrics,
    checkpoints = excluded.checkpoints,
    values_hash = excluded.values_hash,
    calculated_at = excluded.calculated_at;

  return jsonb_build_object(
    'changed', true,
    'revision', v_rev,
    'stable_at', (select stable_at from public.ratio_snapshots where shop_id = p_shop_id and period_month = p_period_month)
  );
end;
$$;

revoke execute on function public.persist_shop_month(uuid, date, jsonb, text, boolean, smallint, text) from public, anon, authenticated;
grant execute on function public.persist_shop_month(uuid, date, jsonb, text, boolean, smallint, text) to service_role;
