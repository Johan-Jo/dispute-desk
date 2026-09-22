-- Frozen comparable-cohort definitions and their results (plan §11, §23 step 11).
--
-- RENUMBERED from 20260831090000, which collided with
-- `20260831090000_shops_onboarding_digest_sent_at` on another branch. The
-- collision is worth naming because it fails silently in the worst direction:
-- dev had already recorded that version, so a later `db push` would have seen
-- 20260831090000 as applied and SKIPPED this file entirely. The table exists on
-- dev only because its DDL was run by hand — prod would never have received it,
-- and nothing would have complained.
--
-- WHY FREEZE A COHORT AT ALL. A benchmark computed live re-answers itself every
-- time the underlying data moves, so a number quoted on Monday cannot be
-- reproduced on Friday and a learning action evaluated against "the cohort"
-- is evaluated against a moving target. Plan §15.8 requires a learning action's
-- baseline to be frozen before the change ships; this table is where that
-- freeze lives, and it stores the QUERY as well as the numbers so a later
-- reader can see what was asked, not just what came back.
--
-- WHY IT STORES REFUSALS TOO. `status` may be INSUFFICIENT_SAMPLE or
-- NO_COMPARABLE_COHORT, and those rows are the point rather than an error case.
-- Production has 8 installed shops, 3 with any analyzable decided case, and one
-- merchant holding 92% of them — so every benchmark today correctly refuses.
-- Recording the refusal with its blocking dimensions is what lets someone ask
-- later "when did this become answerable?" instead of guessing.
--
-- No UI reads this yet (plan §25.6 defers the benchmark panel). The gates ship
-- now because they are what stops a misleading average the day the data arrives.

create table if not exists outcome_cohort_snapshots (
  id                      uuid primary key default gen_random_uuid(),

  -- Who the cohort was built for. NICHE and PLATFORM scopes carry a null owner.
  scope_owner_type        text not null,
  scope_owner_id          uuid,

  -- Stable identity, so two snapshots of the same question can be compared.
  cohort_key              text not null,
  cohort_definition       jsonb not null,

  -- Every gate dimension, denormalised for filtering without parsing the jsonb.
  payment_provider        text not null,
  provider_access_level   text not null,
  merchant_niche          text,
  phase                   text not null,
  reason_family           text not null,
  network_reason_code     text,
  card_network            text not null,
  window_start            timestamptz not null,
  window_end              timestamptz not null,
  analyzer_versions       integer[],

  -- Raw counts. Numerators and denominators, never a bare percentage: plan §15.6
  -- requires both to be displayed, and a stored rate without its denominator is
  -- how "4 of 5 = 80%" becomes a headline.
  peer_merchants          integer not null,
  peer_cases              integer not null,
  peer_won                integer not null,
  subject_cases           integer not null,
  subject_won             integer not null,

  status                  text not null,
  blockers                text[] not null default '{}',

  query_version           integer not null default 1,
  created_at              timestamptz not null default now(),

  constraint cohort_status_valid
    check (status in ('SUFFICIENT','INSUFFICIENT_SAMPLE','NO_COMPARABLE_COHORT')),
  constraint cohort_scope_valid
    check (scope_owner_type in ('MERCHANT','NICHE','PROVIDER','REASON_NETWORK','PLATFORM')),
  -- A SUFFICIENT snapshot must actually clear the floors it claims to have
  -- cleared. Enforced here because the thresholds are a product promise, and an
  -- application-layer typo that relaxes them would otherwise be invisible.
  constraint cohort_sufficient_meets_thresholds
    check (
      status <> 'SUFFICIENT'
      or (peer_merchants >= 3 and peer_cases >= 30 and subject_cases >= 10)
    ),
  -- A refusal must say why.
  constraint cohort_refusal_has_blockers
    check (status = 'SUFFICIENT' or cardinality(blockers) > 0),
  constraint cohort_counts_coherent
    check (peer_won <= peer_cases and subject_won <= subject_cases)
);

create index if not exists outcome_cohort_snapshots_owner_idx
  on outcome_cohort_snapshots (scope_owner_type, scope_owner_id, created_at desc);
create index if not exists outcome_cohort_snapshots_key_idx
  on outcome_cohort_snapshots (cohort_key, created_at desc);

alter table outcome_cohort_snapshots enable row level security;
-- No policies: service-role only. Internal admin analytics.

comment on table outcome_cohort_snapshots is
  'Frozen comparable-cohort definitions and results (plan §11). Stores refusals as well as answers: with 3 merchants holding analyzable cases, every benchmark currently refuses, and recording that is what makes "when did this become answerable?" a query rather than a guess.';
comment on column outcome_cohort_snapshots.cohort_definition is
  'The full predicate set as asked, so a later reader can see the question and not only the answer.';
comment on column outcome_cohort_snapshots.blockers is
  'Which sufficiency gates failed. Required non-empty on any non-SUFFICIENT row.';
comment on constraint cohort_sufficient_meets_thresholds on outcome_cohort_snapshots is
  'Plan §15.6 floors: 3 peer merchants, 30 peer cases, 10 subject cases. In the database because a relaxed threshold in application code would otherwise ship silently.';
