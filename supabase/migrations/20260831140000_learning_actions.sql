-- Learning actions: reviewed findings → a scoped, measurable change (plan §11, §15.8).
--
-- WHAT THIS IS FOR. The analyzer produces hypotheses. A reviewer confirms some.
-- This is where a confirmed pattern becomes a change someone owns, with a frozen
-- baseline to measure it against and a way to undo it. Nothing here mutates a
-- rule, template or weight — deployment is an explicit, authorised step
-- elsewhere, and this table records WHICH release did it.
--
-- WHY THE CONSTRAINTS ARE THIS TIGHT. Every one of them exists because the
-- alternative is a plausible-sounding shortcut:
--
--   * An action may only be APPROVED when every finding backing it has been
--     REVIEWED. Otherwise an automated hypothesis drives a production change,
--     which is the single thing plan §17 forbids. A check constraint cannot
--     subquery, so this is a trigger.
--
--   * A PLATFORM-scoped action needs more than one backing finding. One case is
--     an anecdote; plan §15.8 allows a single finding to open a DRAFT and
--     refuses to let it justify a fleet-wide change.
--
--   * DEPLOYED requires a deployment_ref and an effective_from. An action
--     recorded as deployed with no pointer to the release that deployed it
--     cannot be evaluated later and cannot be rolled back.
--
--   * APPROVED requires approved_by and approved_at. "Who said yes" is the
--     whole audit value.
--
-- NOTHING WRITES HERE YET. No finding has been reviewed, so no action can be
-- approved. The tables ship ahead of that so the contract is fixed before the
-- first reviewer arrives, not negotiated around them.

create table if not exists learning_actions (
  id                          uuid primary key default gen_random_uuid(),
  title                       text not null,
  problem_statement           text not null,
  /** Expected observable change. Never guaranteed-win language (plan §9). */
  hypothesis                  text not null,
  action_class                text not null,
  scope_type                  text not null,
  scope_definition            jsonb not null default '{}'::jsonb,
  change_spec                 jsonb not null default '{}'::jsonb,

  -- Frozen before the change ships, so the comparison is against a fixed
  -- target rather than a moving one.
  baseline_cohort_definition  jsonb,
  baseline_metrics            jsonb,
  guardrail_metrics           jsonb,

  owner_user_id               uuid,
  status                      text not null default 'DRAFT',
  approved_by                 uuid,
  approved_at                 timestamptz,
  effective_from              timestamptz,
  effective_to                timestamptz,
  deployment_ref              text,
  rollback_ref                text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint learning_action_status_valid
    check (status in ('DRAFT','READY_FOR_REVIEW','APPROVED','DEPLOYED','MEASURING',
                      'KEEP','REVISE','ROLL_BACK','CLOSED_INDETERMINATE')),
  constraint learning_action_scope_valid
    check (scope_type in ('MERCHANT','NICHE','PROVIDER','REASON_NETWORK','PLATFORM')),
  constraint learning_action_class_valid
    check (action_class in ('EVIDENCE_ACQUISITION','PIPELINE_RELIABILITY','RULE_ENGINE',
                            'EVIDENCE_MAPPING','NARRATIVE_TEMPLATE','MERCHANT_OPERATIONS',
                            'DATA_QUALITY','STRENGTH_CALIBRATION')),
  -- "Who approved this, and when" is the audit value; an approval without it is
  -- indistinguishable from a status someone typed.
  constraint learning_action_approved_has_approver
    check (
      status not in ('APPROVED','DEPLOYED','MEASURING','KEEP','REVISE','ROLL_BACK')
      or (approved_by is not null and approved_at is not null)
    ),
  -- A deployment with no pointer to the release that performed it cannot be
  -- evaluated or reversed.
  constraint learning_action_deployed_has_ref
    check (
      status not in ('DEPLOYED','MEASURING','KEEP','REVISE','ROLL_BACK')
      or (deployment_ref is not null and effective_from is not null)
    ),
  -- Measuring anything requires the baseline to have been frozen first.
  constraint learning_action_measuring_has_baseline
    check (
      status not in ('MEASURING','KEEP','REVISE')
      or (baseline_cohort_definition is not null and baseline_metrics is not null)
    ),
  -- A rollback that cannot say how to reverse itself is a note, not a plan.
  constraint learning_action_rollback_has_ref
    check (status <> 'ROLL_BACK' or rollback_ref is not null)
);

create index if not exists learning_actions_status_idx
  on learning_actions (status, effective_from desc);

alter table learning_actions enable row level security;
-- No policies: service-role only.

-- ─────────────────────────────────────────────────────────────────────────
-- What a learning action is built on.
--
-- The analyzer version and snapshot hash are stored ALONGSIDE the reference:
-- a later reclassification must not silently rewrite the justification for a
-- change that already shipped. The action was approved on the strength of what
-- the analysis said at the time, and that is what the record has to preserve.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists learning_action_evidence (
  id                     uuid primary key default gen_random_uuid(),
  learning_action_id     uuid not null references learning_actions(id) on delete cascade,
  analysis_id            uuid not null references post_outcome_analyses(id) on delete restrict,
  finding_id             uuid references post_outcome_findings(id) on delete set null,
  analyzer_version_at_link integer not null,
  snapshot_sha256_at_link  text not null,
  created_at             timestamptz not null default now(),
  unique (learning_action_id, analysis_id, finding_id)
);

create index if not exists learning_action_evidence_action_idx
  on learning_action_evidence (learning_action_id);

alter table learning_action_evidence enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Measuring an action after it shipped.
--
-- `sample_quality` and `result` are separate on purpose. A change can be
-- measured on too small a cohort to conclude anything, and that is a real
-- outcome — INSUFFICIENT_SAMPLE — not a missing row. PROMISING means the
-- post-change cohort improved without a guardrail regression; it never means
-- the change caused it.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists learning_action_evaluations (
  id                          uuid primary key default gen_random_uuid(),
  learning_action_id          uuid not null references learning_actions(id) on delete cascade,
  evaluation_version          integer not null default 1,
  comparison_cohort_definition jsonb not null,
  baseline_metrics_snapshot   jsonb not null,
  post_change_metrics_snapshot jsonb not null,
  sample_quality              text not null,
  result                      text not null,
  guardrail_regression        boolean not null default false,
  reviewer_notes              text,
  created_at                  timestamptz not null default now(),

  constraint evaluation_sample_quality_valid
    check (sample_quality in ('SUFFICIENT','DIRECTIONAL','INSUFFICIENT')),
  constraint evaluation_result_valid
    check (result in ('PROMISING','NO_CLEAR_CHANGE','ADVERSE_GUARDRAIL',
                      'INDETERMINATE','INSUFFICIENT_SAMPLE')),
  -- An insufficient sample cannot yield a directional verdict. Plan §18 forbids
  -- percentage differences below the sample thresholds, and PROMISING off four
  -- cases is exactly that claim wearing a different word.
  constraint evaluation_insufficient_has_no_verdict
    check (
      sample_quality <> 'INSUFFICIENT'
      or result in ('INSUFFICIENT_SAMPLE','INDETERMINATE')
    ),
  -- A guardrail regression cannot be reported as promising.
  constraint evaluation_guardrail_blocks_promising
    check (not guardrail_regression or result <> 'PROMISING')
);

create index if not exists learning_action_evaluations_action_idx
  on learning_action_evaluations (learning_action_id, created_at desc);

alter table learning_action_evaluations enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- Approval gate: every backing finding must have been reviewed.
--
-- A check constraint cannot subquery, and this is the invariant that matters
-- most — it is the difference between "a human confirmed this pattern" and "an
-- automated hypothesis changed production". So it is a trigger, and it fires on
-- the transition INTO an approved-or-later state rather than on every update.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function assert_learning_action_evidence_reviewed()
returns trigger
language plpgsql
as $$
declare
  v_total    integer;
  v_reviewed integer;
begin
  if new.status not in ('APPROVED','DEPLOYED','MEASURING','KEEP','REVISE','ROLL_BACK') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('APPROVED','DEPLOYED','MEASURING','KEEP','REVISE','ROLL_BACK') then
    return new;  -- already past the gate; re-checking would block a rollback
  end if;

  select count(*) into v_total
    from learning_action_evidence e
   where e.learning_action_id = new.id;

  if v_total = 0 then
    raise exception 'learning action % cannot be approved with no supporting findings', new.id
      using errcode = 'check_violation';
  end if;

  -- One case is an anecdote. Plan §15.8 lets a single finding open a DRAFT and
  -- refuses to let it justify a fleet-wide change.
  if new.scope_type = 'PLATFORM' and v_total < 2 then
    raise exception 'a PLATFORM-scoped learning action needs more than one supporting finding (has %)', v_total
      using errcode = 'check_violation';
  end if;

  -- "Reviewed" means a human recorded a disposition. REJECTED counts as
  -- reviewed but cannot support an action, so it is excluded here.
  select count(*) into v_reviewed
    from learning_action_evidence e
   where e.learning_action_id = new.id
     and exists (
       select 1
         from post_outcome_analysis_reviews r
        where r.analysis_id = e.analysis_id
          and r.disposition in ('CONFIRMED','EDITED')
     );

  if v_reviewed < v_total then
    raise exception 'learning action % has % supporting finding(s), only % reviewed and confirmed',
      new.id, v_total, v_reviewed
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists learning_action_evidence_reviewed on learning_actions;
create trigger learning_action_evidence_reviewed
  before insert or update of status on learning_actions
  for each row execute function assert_learning_action_evidence_reviewed();

comment on table learning_actions is
  'Reviewed findings converted into a scoped, owned, measurable change (plan §15.8). Records what was approved and which release deployed it; never mutates a rule, template or weight itself.';
comment on table learning_action_evidence is
  'What an action is built on. Stores the analyzer version and snapshot hash at link time so a later reclassification cannot silently rewrite the justification for a change that already shipped.';
comment on table learning_action_evaluations is
  'Post-change measurement. INSUFFICIENT sample cannot carry a directional verdict, and a guardrail regression cannot be reported as promising — both enforced by constraint.';
comment on function assert_learning_action_evidence_reviewed() is
  'Approval gate: every backing finding must carry a CONFIRMED or EDITED review, and a PLATFORM-scoped action needs more than one. A trigger rather than a check constraint because the rule requires a subquery.';
