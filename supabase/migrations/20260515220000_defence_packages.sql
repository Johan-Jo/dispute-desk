-- Grounded Defence Package PDF Builder
--
-- Adds the data foundation for `ENABLE_DEFENCE_PACKAGE_BUILDER`. Five tables:
--   defence_packages         — one row per (dispute, version); status machine.
--   defence_evidence_facts   — normalized facts that crossed the system→LLM boundary.
--   defence_manual_evidence  — manual uploads promoted into a package.
--   defence_prompt_modules   — admin-managed reason-code modules (versioned, never overwritten).
--   defence_package_runs     — per-attempt LLM call telemetry (powers admin dashboard + cap).
--
-- Immutability: a status-transition trigger on defence_packages is the last line of
-- defence. Job/route logic enforces these invariants first; the trigger guarantees
-- they cannot be bypassed by accident.
--
-- See docs/technical.md (Grounded Defence Package section), and the plan at
-- C:\Users\johan\.claude\plans\cozy-zooming-popcorn.md.

-- ── defence_packages ─────────────────────────────────────────────────
create table if not exists defence_packages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  source_pack_id uuid not null references evidence_packs(id) on delete cascade,
  order_id text,

  version int not null check (version >= 1),

  status text not null check (
    status in ('draft','stale','final','submitted','superseded','failed','skipped')
  ),
  -- Null for skipped/failed rows that never ran the LLM. Otherwise 'full' or 'narrow'.
  package_mode text check (package_mode is null or package_mode in ('full','narrow')),

  generated_at timestamptz not null default now(),
  generated_by text not null check (generated_by in ('system','merchant','admin')),

  pdf_path text,
  pdf_storage_bucket text not null default 'evidence-packs',

  evidence_hash text not null,

  llm_model text,
  prompt_family text,
  prompt_version int,
  reason_code_module text,
  output_schema_version int not null default 1,

  validation_status text check (validation_status is null or validation_status in ('ok','failed','skipped')),
  validation_errors jsonb not null default '[]'::jsonb,

  narrative_json jsonb,
  facts_json jsonb,

  submitted_at timestamptz,
  submitted_by text,
  shopify_response jsonb,

  -- Set ONLY by the finalize route when a NEW row at version=N+1 reaches 'final'.
  -- The trigger validates that the referenced row exists and is itself 'final'.
  superseded_by_id uuid references defence_packages(id),

  failure_code text,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (dispute_id, version)
);

create index if not exists defence_packages_dispute_version_idx
  on defence_packages (dispute_id, version desc);

create index if not exists defence_packages_source_pack_idx
  on defence_packages (source_pack_id);

create index if not exists defence_packages_status_idx
  on defence_packages (status);

create index if not exists defence_packages_shop_idx
  on defence_packages (shop_id);

-- ── defence_evidence_facts ───────────────────────────────────────────
create table if not exists defence_evidence_facts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references defence_packages(id) on delete cascade,
  -- Optional pointer back to evidence_items so admins can trace a fact to its
  -- collector output. Nullable because some classifier outputs (e.g. derived
  -- facts) don't map 1:1 to a single section row.
  source_section_id uuid references evidence_items(id) on delete set null,

  category text not null,
  label text not null,
  value jsonb not null default '{}'::jsonb,
  source text not null,
  source_ref text,

  strength text check (strength is null or strength in ('strong','moderate','supporting','invalid')),

  bank_eligible boolean not null default false,
  merchant_visible boolean not null default true,
  internal_only boolean not null default false,
  include_in_bank_narrative boolean not null default false,
  -- Renamed from negative_or_weakening for clarity (plan §"Terminology"). Means:
  -- "this fact may exist for merchant-side decisions, but MUST NOT appear in the
  -- bank-facing PDF or LLM narrative unless includeInBankNarrative is set."
  submission_risk boolean not null default false,

  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  created_at timestamptz not null default now()
);

create index if not exists defence_evidence_facts_package_idx
  on defence_evidence_facts (package_id);

create index if not exists defence_evidence_facts_bank_eligible_idx
  on defence_evidence_facts (package_id, bank_eligible);

create index if not exists defence_evidence_facts_category_idx
  on defence_evidence_facts (package_id, category);

-- ── defence_manual_evidence ──────────────────────────────────────────
create table if not exists defence_manual_evidence (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references defence_packages(id) on delete cascade,
  evidence_item_id uuid not null references evidence_items(id) on delete cascade,

  filename text not null,
  file_url text,
  file_type text,

  uploaded_by text,
  uploaded_at timestamptz not null default now(),

  description text,

  bank_eligible boolean not null default false,
  include_in_package boolean not null default true,
  include_in_bank_narrative boolean not null default false,

  evidence_category text,

  unique (package_id, evidence_item_id)
);

create index if not exists defence_manual_evidence_package_idx
  on defence_manual_evidence (package_id);

-- ── defence_prompt_modules ───────────────────────────────────────────
-- Admin-managed. Each "edit" inserts a new row at (key, version+1) — old rows
-- are never overwritten. Latest active row per key wins.
create table if not exists defence_prompt_modules (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  display_name text not null,
  reason_code_keys text[] not null default '{}',
  prompt_body text not null,
  guidance_json jsonb not null default '{}'::jsonb,
  -- Override default model selection. Null = inherit DEFENCE_PACKAGE_DEFAULT_MODEL.
  model text,
  is_active boolean not null default true,
  version int not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (key, version)
);

create index if not exists defence_prompt_modules_key_version_idx
  on defence_prompt_modules (key, version desc);

-- ── defence_package_runs ─────────────────────────────────────────────
-- Per-attempt LLM call log. Powers admin dashboard widgets and the per-shop
-- daily cap query (count where daily_bucket = CURRENT_DATE AND shop_id = …).
create table if not exists defence_package_runs (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references defence_packages(id) on delete cascade,
  shop_id uuid references shops(id) on delete cascade,

  prompt_version int,
  model text,
  package_mode text check (package_mode is null or package_mode in ('full','narrow')),

  prompt_tokens int,
  completion_tokens int,
  duration_ms int,

  validation_status text check (validation_status is null or validation_status in ('ok','failed','skipped','error')),

  -- Daily bucket for the per-shop cap query (avoids a range scan per dispatch).
  daily_bucket date not null default current_date,

  created_at timestamptz not null default now()
);

create index if not exists defence_package_runs_package_idx
  on defence_package_runs (package_id);

create index if not exists defence_package_runs_shop_day_idx
  on defence_package_runs (shop_id, daily_bucket);

create index if not exists defence_package_runs_created_idx
  on defence_package_runs (created_at desc);

-- ── Updated-at triggers ──────────────────────────────────────────────
create or replace function defence_packages_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists defence_packages_updated_at on defence_packages;
create trigger defence_packages_updated_at
before update on defence_packages
for each row execute function defence_packages_set_updated_at();

create or replace function defence_prompt_modules_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists defence_prompt_modules_updated_at on defence_prompt_modules;
create trigger defence_prompt_modules_updated_at
before update on defence_prompt_modules
for each row execute function defence_prompt_modules_set_updated_at();

-- ── Immutability trigger on defence_packages ─────────────────────────
-- DB is the last line of defence. Job/route logic enforces these first.
--
-- Allowed transitions:
--   draft      → stale, failed, final, superseded
--   stale      → draft (regen creates new row instead; this state is informational),
--                 superseded
--   final      → superseded (set ONLY when a new row at version=N+1 reaches 'final')
--   submitted  → superseded (linkage only — status stays submitted forever as
--                            the historical artifact of what went to the bank)
--   skipped    → superseded (linkage; row remains explanatory)
--   failed     → superseded (linkage; row remains explanatory)
--   superseded → terminal
--
-- Column-level lock once status is final or submitted: only the explicitly
-- enumerated columns may change.
create or replace function defence_packages_enforce_immutability()
returns trigger as $$
declare
  v_supersedor_status text;
begin
  -- Reject status regressions.
  if old.status = 'final' and new.status not in ('final','superseded') then
    raise exception 'defence_packages: status final may only transition to superseded (attempted: %)', new.status;
  end if;

  if old.status = 'submitted' and new.status <> 'submitted' then
    raise exception 'defence_packages: submitted is terminal — status may not change (attempted: %)', new.status;
  end if;

  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'defence_packages: superseded is terminal — status may not change (attempted: %)', new.status;
  end if;

  if old.status = 'skipped' and new.status not in ('skipped','superseded') then
    raise exception 'defence_packages: skipped may only transition to superseded (attempted: %)', new.status;
  end if;

  if old.status = 'failed' and new.status not in ('failed','superseded') then
    raise exception 'defence_packages: failed may only transition to superseded (attempted: %)', new.status;
  end if;

  -- Once final: lock all columns except superseded_by_id, status, updated_at.
  if old.status = 'final' then
    if new.narrative_json is distinct from old.narrative_json
       or new.facts_json is distinct from old.facts_json
       or new.pdf_path is distinct from old.pdf_path
       or new.evidence_hash is distinct from old.evidence_hash
       or new.package_mode is distinct from old.package_mode
       or new.validation_status is distinct from old.validation_status
       or new.validation_errors is distinct from old.validation_errors
       or new.llm_model is distinct from old.llm_model
       or new.prompt_family is distinct from old.prompt_family
       or new.prompt_version is distinct from old.prompt_version
       or new.reason_code_module is distinct from old.reason_code_module
       or new.version is distinct from old.version
       or new.dispute_id is distinct from old.dispute_id
       or new.source_pack_id is distinct from old.source_pack_id
       or new.generated_by is distinct from old.generated_by
       or new.generated_at is distinct from old.generated_at
    then
      raise exception 'defence_packages: row is final and immutable except for status→superseded + superseded_by_id';
    end if;
  end if;

  -- Once submitted: lock all columns except shopify_response, submitted_at,
  -- submitted_by, superseded_by_id, updated_at.
  if old.status = 'submitted' then
    if new.narrative_json is distinct from old.narrative_json
       or new.facts_json is distinct from old.facts_json
       or new.pdf_path is distinct from old.pdf_path
       or new.evidence_hash is distinct from old.evidence_hash
       or new.package_mode is distinct from old.package_mode
       or new.validation_status is distinct from old.validation_status
       or new.validation_errors is distinct from old.validation_errors
       or new.llm_model is distinct from old.llm_model
       or new.prompt_family is distinct from old.prompt_family
       or new.prompt_version is distinct from old.prompt_version
       or new.reason_code_module is distinct from old.reason_code_module
       or new.version is distinct from old.version
       or new.dispute_id is distinct from old.dispute_id
       or new.source_pack_id is distinct from old.source_pack_id
       or new.generated_by is distinct from old.generated_by
       or new.generated_at is distinct from old.generated_at
    then
      raise exception 'defence_packages: row is submitted and immutable except for shopify_response/submitted_at/submitted_by/superseded_by_id';
    end if;
  end if;

  -- When setting superseded_by_id, validate the supersedor exists and is itself
  -- 'final'. This prevents accidental forward references to a draft.
  if new.superseded_by_id is not null
     and (old.superseded_by_id is null or new.superseded_by_id <> old.superseded_by_id)
  then
    select status into v_supersedor_status
      from defence_packages
      where id = new.superseded_by_id;
    if v_supersedor_status is null then
      raise exception 'defence_packages: superseded_by_id refers to non-existent row';
    end if;
    if v_supersedor_status <> 'final' then
      raise exception 'defence_packages: superseded_by_id must point to a row in status=final (got %)', v_supersedor_status;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists defence_packages_immutability on defence_packages;
create trigger defence_packages_immutability
before update on defence_packages
for each row execute function defence_packages_enforce_immutability();

-- ── RLS: server-only access ──────────────────────────────────────────
alter table defence_packages enable row level security;
alter table defence_evidence_facts enable row level security;
alter table defence_manual_evidence enable row level security;
alter table defence_prompt_modules enable row level security;
alter table defence_package_runs enable row level security;

drop policy if exists service_role_full_access_defence_packages on defence_packages;
create policy service_role_full_access_defence_packages
  on defence_packages for all
  using (true)
  with check (true);

drop policy if exists service_role_full_access_defence_evidence_facts on defence_evidence_facts;
create policy service_role_full_access_defence_evidence_facts
  on defence_evidence_facts for all
  using (true)
  with check (true);

drop policy if exists service_role_full_access_defence_manual_evidence on defence_manual_evidence;
create policy service_role_full_access_defence_manual_evidence
  on defence_manual_evidence for all
  using (true)
  with check (true);

drop policy if exists service_role_full_access_defence_prompt_modules on defence_prompt_modules;
create policy service_role_full_access_defence_prompt_modules
  on defence_prompt_modules for all
  using (true)
  with check (true);

drop policy if exists service_role_full_access_defence_package_runs on defence_package_runs;
create policy service_role_full_access_defence_package_runs
  on defence_package_runs for all
  using (true)
  with check (true);

-- ── Comments ──────────────────────────────────────────────────────────
comment on table defence_packages is
  'Grounded Defence Package PDF Builder — one row per (dispute, version). Status machine: draft|stale|final|submitted|superseded|failed|skipped. final and submitted rows are immutable (enforced by defence_packages_immutability trigger). superseded_by_id points at a row in status=final; never set directly without a valid replacement.';

comment on column defence_packages.status is
  'draft = LLM-generated, awaiting merchant finalization; stale = a newer version was created before this one was finalized; final = merchant-finalized, ready for submission; submitted = sent to Shopify, historical artifact; superseded = replaced by a newer final version (set in same transaction as new row reaches final); failed = validation/render failed; skipped = ineligible (coverage gate or no bank-eligible facts), no LLM call made.';

comment on column defence_packages.package_mode is
  'full = standard 15-section document with firm framing; narrow = shorter, hedged framing, omitted sections without facts. Null when status in (skipped, failed) and no LLM call was made.';

comment on column defence_packages.evidence_hash is
  'SHA-256 over canonicalised approved-facts + manual-evidence + reason-code. Powers stale detection: enqueue compares latest pack hash against latest final row; mismatch triggers new draft creation.';

comment on column defence_packages.superseded_by_id is
  'Pointer to the row that replaced this one. Set ONLY when the replacement reaches final, enforced by the immutability trigger. submitted rows keep their submitted status forever — superseded_by_id is the audit link.';

comment on column defence_evidence_facts.submission_risk is
  'When true, this fact must not appear in the bank-facing PDF or LLM narrative unless include_in_bank_narrative is explicitly true (ops override). Set automatically by classifyFacts for things like IP mismatch, fraud-risk HIGH/MEDIUM, AVS/CVV failure, missing delivery on fulfilled order, proxy/VPN flags.';

comment on table defence_prompt_modules is
  'Admin-managed reason-code prompt guidance. Each save inserts a new row at (key, version+1); previous versions are preserved for audit and rollback. Latest active row per key wins at runtime.';

comment on table defence_package_runs is
  'Per-attempt LLM call telemetry. Powers admin dashboard widgets (success rate, avg tokens, avg duration) and the per-shop daily cap query (100 generations / 50k tokens default).';
