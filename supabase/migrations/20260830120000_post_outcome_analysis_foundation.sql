-- Post-outcome evidence analysis — schema foundation.
--
-- Plan: docs/plans/post-outcome-evidence-analysis.plan.md §11 (data model),
-- §23 step 2. Internal-admin only; merchants never read these tables.
--
-- WHY THESE COLUMNS LOOK PARANOID. The feature's only value is that its claims
-- are bounded by what the record proves. The Phase 0 audit (plan §25, run
-- against prod 2026-08-30) found that two of the sources the plan assumed do
-- not exist, and that the most natural reading of a third is wrong:
--
--   * `submission_logs` and `submission_attempts`: ZERO rows platform-wide.
--     There is no provider-side submission log to key confirmed transmission
--     off. Their absence is NOT disqualifying — provenance of a timestamp
--     matters more than a separate log id — so nothing here references them.
--
--   * `defence_evidence_facts`: ZERO rows for all 50 analyzable disputes. The
--     evidence inventory is reconstructed from `defence_packages.facts_json`
--     instead, which is strictly better: it is already frozen at build time.
--
--   * `defence_packages.shopify_response`: proves Shopify STORED the evidence
--     and read it back (`verified`, `finalStatus: saved_to_shopify_verified`,
--     `evidenceGid`, `fileGid`). It does NOT prove Shopify forwarded anything
--     to the issuer or the card network. Measured: 4 packages carry
--     `verified = true` AND `defence_packages.status = 'submitted'` while
--     `submission_state` is still `saved_to_shopify` with a NULL `submitted_at`.
--     Hence `platform_save_confirmation` is a SEPARATE column from
--     `submission_confirmation_source`, and a check constraint forbids the one
--     being satisfied by the other.
--
-- One of those four saved-but-never-forwarded packages is the platform's only
-- decided win. Under a looser reading it would have become the sole "effective
-- configuration" — a winning tactic learned from a package no adjudicator saw.

-- ─────────────────────────────────────────────────────────────────────────
-- Merchant niche: table only, no UI (plan §25.6).
--
-- Benchmarking needs >= 3 peer merchants in a matched cohort; prod has 8
-- installed shops, 3 with any analyzable decided case, one holding 92% of them.
-- The benchmark panel is deferred, but classification can start accumulating
-- now so the cohort machinery has history when it is finally buildable.
-- Append-only: a reclassification supersedes, it never rewrites, so historical
-- analyses keep the niche that was in force when they ran.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists merchant_niche_classifications (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references shops(id) on delete cascade,
  niche           text not null,
  source          text not null,
  confidence      text not null default 'MODERATE',
  reviewer_user_id uuid,
  effective_from  timestamptz not null default now(),
  superseded_at   timestamptz,
  created_at      timestamptz not null default now(),
  constraint merchant_niche_confidence_valid
    check (confidence in ('DEFINITE','HIGH','MODERATE','LOW'))
);

alter table merchant_niche_classifications enable row level security;
-- No policies: service-role only (internal admin analytics).

create index if not exists merchant_niche_current_idx
  on merchant_niche_classifications (shop_id, effective_from desc)
  where superseded_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- One analysis per (dispute, analyzer version, source snapshot).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists post_outcome_analyses (
  id                              uuid primary key default gen_random_uuid(),
  shop_id                         uuid not null references shops(id) on delete cascade,
  dispute_id                      uuid not null references disputes(id) on delete cascade,

  -- Provider identity, snapshotted. Never inferred from the card network.
  payment_provider_snapshot       text not null,
  provider_account_ref_snapshot   text,
  provider_access_level_snapshot  text not null,
  provider_capabilities_snapshot  jsonb not null default '{}'::jsonb,

  -- Storage confirmation. Storage ONLY. See the check constraint below.
  platform_save_confirmation      boolean not null default false,
  -- Provenance of any FORWARDING claim.
  submission_confirmation_source  text not null default 'NONE',
  -- How the package was tied to the saved platform evidence.
  package_evidence_tie            text not null default 'NONE',

  analyzer_version                integer not null,
  source_snapshot_uri             text,
  source_snapshot_sha256          text not null,

  submitted_package_id            uuid references defence_packages(id) on delete set null,
  submitted_package_sha256        text,
  submission_state_snapshot       text,
  -- Confirmed FORWARDING time. Null unless platform-originated.
  submitted_at_snapshot           timestamptz,

  final_outcome_snapshot          text not null,
  finalized_at_snapshot           timestamptz,
  reason_snapshot                 text,
  network_reason_code_snapshot    text,
  network_snapshot                text,

  merchant_niche_snapshot         text,
  merchant_niche_source           text,

  analysis_level                  text not null,
  analysis_status                 text not null default 'PENDING',
  reason_specific_status          text not null default 'NOT_YET_SUPPORTED',
  -- True when the package could not be tied to the submission (plan §4.4).
  data_integrity_limitation       boolean not null default false,

  primary_category                text,
  primary_confidence              text,
  actionable                      boolean not null default false,
  summary                         jsonb,

  superseded_by_id                uuid references post_outcome_analyses(id) on delete set null,
  completed_at                    timestamptz,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint post_outcome_outcome_analyzable
    check (final_outcome_snapshot in ('won','lost')),
  constraint post_outcome_level_valid
    check (analysis_level in (
      'FULL_POST_OUTCOME','PACKAGE_INTEGRITY_ONLY',
      'OUTCOME_METADATA_ONLY','NOT_ANALYZABLE')),
  constraint post_outcome_provider_valid
    check (payment_provider_snapshot in (
      'SHOPIFY_PAYMENTS','KLARNA','PAYPAL','OTHER','UNKNOWN')),
  constraint post_outcome_access_level_valid
    check (provider_access_level_snapshot in (
      'FULL_CASE_FILE','PARTIAL_CASE_FILE','OUTCOME_ONLY',
      'NO_PROVIDER_CASE_ACCESS','UNKNOWN')),
  constraint post_outcome_confirmation_source_valid
    check (submission_confirmation_source in (
      'SHOPIFY_EVIDENCE_SENT_ON','PROVIDER_LOG',
      'MANUAL_MERCHANT_REPORT','PLATFORM_SAVE_ONLY','NONE')),
  constraint post_outcome_evidence_tie_valid
    check (package_evidence_tie in (
      'EVIDENCE_GID_MATCH','AMBIGUOUS_MULTIPLE_PACKAGES','NONE')),
  constraint post_outcome_reason_specific_valid
    check (reason_specific_status in (
      'SUPPORTED','NOT_YET_SUPPORTED','NOT_RECONSTRUCTABLE','BLOCKED')),

  -- THE LOAD-BEARING CONSTRAINT (plan §4.4, decision 2026-08-30).
  -- FULL_POST_OUTCOME requires real forwarding confirmation. A verified save,
  -- a merchant's word, or nothing at all can never reach it. Enforced in the
  -- database because this is the invariant a future analyzer change is most
  -- likely to erode by accident, and the erosion would be silent.
  constraint post_outcome_full_requires_forwarding
    check (
      analysis_level <> 'FULL_POST_OUTCOME'
      or submission_confirmation_source in ('SHOPIFY_EVIDENCE_SENT_ON','PROVIDER_LOG')
    ),
  -- FULL_POST_OUTCOME also requires the package to be tied to the submission.
  constraint post_outcome_full_requires_package_tie
    check (
      analysis_level <> 'FULL_POST_OUTCOME'
      or package_evidence_tie = 'EVIDENCE_GID_MATCH'
    ),
  -- An untieable package must be recorded as a limitation, not passed over.
  constraint post_outcome_ambiguous_tie_is_flagged
    check (
      package_evidence_tie <> 'AMBIGUOUS_MULTIPLE_PACKAGES'
      or data_integrity_limitation
    )
);

-- Idempotency: same dispute + same analyzer + same inputs = one analysis.
-- A retry resumes; a new analyzer version creates a new row; a genuine source
-- repair (which moves the hash) creates a new row. Nothing overwrites.
create unique index if not exists post_outcome_analyses_identity_idx
  on post_outcome_analyses (dispute_id, analyzer_version, source_snapshot_sha256);

create index if not exists post_outcome_analyses_finalized_idx
  on post_outcome_analyses (finalized_at_snapshot desc);
create index if not exists post_outcome_analyses_shop_finalized_idx
  on post_outcome_analyses (shop_id, finalized_at_snapshot desc);
create index if not exists post_outcome_analyses_provider_idx
  on post_outcome_analyses (payment_provider_snapshot, provider_access_level_snapshot, finalized_at_snapshot desc);
create index if not exists post_outcome_analyses_niche_reason_idx
  on post_outcome_analyses (merchant_niche_snapshot, reason_snapshot, finalized_at_snapshot desc);
create index if not exists post_outcome_analyses_category_idx
  on post_outcome_analyses (primary_category, primary_confidence);
create index if not exists post_outcome_analyses_status_idx
  on post_outcome_analyses (analysis_status, completed_at);

alter table post_outcome_analyses enable row level security;
-- No policies: service-role only. Internal admin surface; merchants have no access.

-- ─────────────────────────────────────────────────────────────────────────
-- Findings. At most one primary per analysis, enforced by a partial unique index.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists post_outcome_findings (
  id                          uuid primary key default gen_random_uuid(),
  analysis_id                 uuid not null references post_outcome_analyses(id) on delete cascade,
  is_primary                  boolean not null default false,
  category                    text not null,
  confidence                  text not null,
  severity                    text not null,
  title                       text not null,
  description                 text not null,
  -- What the retained record PROVES. Distinct from the improvement below.
  observed_fact               text not null,
  -- What could be improved. Never phrased as "this would have won".
  counterfactual_improvement  text,
  action_class                text not null,
  evidence_refs               jsonb not null default '[]'::jsonb,
  rule_refs                   jsonb not null default '[]'::jsonb,
  created_at                  timestamptz not null default now(),

  constraint post_outcome_finding_category_valid
    check (category in (
      'EFFECTIVE_CONFIGURATION_CANDIDATE','WIN_WITH_INTEGRITY_DEFECT',
      'UNWINNABLE_OR_ADVERSE_FACTS','MISSING_ACQUIRABLE_EVIDENCE',
      'AVAILABLE_EVIDENCE_OMITTED','INCORRECT_EVIDENCE_INTERPRETATION',
      'UNSUPPORTED_OR_OVERSTATED_ASSERTION','WRONG_NETWORK_OR_REASON_LOGIC',
      'WEAK_OR_IRRELEVANT_PRESENTATION','PROCEDURAL_OR_SUBMISSION_FAILURE',
      'DATA_INTEGRITY_FAILURE','NO_MATERIAL_GAP_OBSERVED','INDETERMINATE')),
  constraint post_outcome_finding_confidence_valid
    check (confidence in ('DEFINITE','HIGH','MODERATE','LOW')),
  constraint post_outcome_finding_severity_valid
    check (severity in ('CRITICAL','HIGH','MEDIUM','LOW')),
  constraint post_outcome_finding_action_valid
    check (action_class in (
      'EVIDENCE_ACQUISITION','PIPELINE_RELIABILITY','RULE_ENGINE',
      'EVIDENCE_MAPPING','NARRATIVE_TEMPLATE','MERCHANT_OPERATIONS',
      'DATA_QUALITY','NO_ACTION')),
  -- Plan §9: a DEFINITE or HIGH finding must carry its provenance. A confident
  -- claim with nothing to chase is exactly the output this feature must not
  -- produce, so the database refuses to store one.
  constraint post_outcome_finding_high_confidence_has_provenance
    check (
      confidence not in ('DEFINITE','HIGH')
      or jsonb_array_length(evidence_refs) > 0
      or jsonb_array_length(rule_refs) > 0
    )
);

create unique index if not exists post_outcome_findings_one_primary_idx
  on post_outcome_findings (analysis_id) where is_primary;
create index if not exists post_outcome_findings_analysis_idx
  on post_outcome_findings (analysis_id, is_primary);
create index if not exists post_outcome_findings_action_idx
  on post_outcome_findings (action_class, category);

alter table post_outcome_findings enable row level security;
-- No policies: service-role only.

-- ─────────────────────────────────────────────────────────────────────────
-- Reviews. Append-only; current state is the latest row (plan §11, §17).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists post_outcome_analysis_reviews (
  id                  uuid primary key default gen_random_uuid(),
  analysis_id         uuid not null references post_outcome_analyses(id) on delete cascade,
  reviewer_user_id    uuid not null,
  disposition         text not null,
  category_override   text,
  confidence_override text,
  notes               text,
  created_at          timestamptz not null default now(),

  constraint post_outcome_review_disposition_valid
    check (disposition in ('CONFIRMED','EDITED','REJECTED','INDETERMINATE')),
  -- An edit or rejection without a stated reason is not reviewable evidence.
  constraint post_outcome_review_edit_has_notes
    check (disposition not in ('EDITED','REJECTED') or coalesce(notes,'') <> '')
);

create index if not exists post_outcome_reviews_latest_idx
  on post_outcome_analysis_reviews (analysis_id, created_at desc);

alter table post_outcome_analysis_reviews enable row level security;
-- No policies: service-role only.

-- ─────────────────────────────────────────────────────────────────────────
-- Documentation
-- ─────────────────────────────────────────────────────────────────────────
comment on table post_outcome_analyses is
  'One immutable, versioned post-outcome analysis per (dispute, analyzer_version, source_snapshot_sha256). Internal admin only. See docs/plans/post-outcome-evidence-analysis.plan.md.';
comment on column post_outcome_analyses.platform_save_confirmation is
  'Platform confirmed the evidence was STORED and read back (Shopify: shopify_response.verified + evidenceGid/fileGid). Storage only — proves NOTHING about forwarding to the issuer or card network. Never derive submission_confirmation_source from this.';
comment on column post_outcome_analyses.submission_confirmation_source is
  'Provenance of the FORWARDING claim. Only SHOPIFY_EVIDENCE_SENT_ON and PROVIDER_LOG constitute forwarding confirmation. PLATFORM_SAVE_ONLY means saved-and-verified but never reported forwarded (4 such packages in prod as of 2026-08-30). MANUAL_MERCHANT_REPORT is a merchant assertion, not provider confirmation.';
comment on column post_outcome_analyses.package_evidence_tie is
  'How the package was associated with the saved platform evidence. EVIDENCE_GID_MATCH = shopify_response.evidenceGid equals disputes.dispute_evidence_gid (holds for 53/53 prod packages). AMBIGUOUS_MULTIPLE_PACKAGES = several submitted packages, forwarded one not identifiable (2 prod disputes).';
comment on column post_outcome_analyses.analysis_level is
  'How much the analyzer may conclude. FULL_POST_OUTCOME requires all four plan §4.4 conditions and is enforced by check constraints, not just application code.';
comment on column post_outcome_analyses.reason_specific_status is
  'NOT_YET_SUPPORTED = no module for this reason. NOT_RECONSTRUCTABLE = module exists but this case''s facts are absent from the snapshot. Different statements; only the first is fixed by shipping code.';
comment on column post_outcome_analyses.source_snapshot_sha256 is
  'SHA-256 over the canonicalised immutable snapshot (lib/postOutcome/snapshotContract.ts). Half of the idempotency key: a retry resumes, a source repair creates a new analysis.';
comment on table post_outcome_findings is
  'Findings for one analysis. At most one primary. DEFINITE/HIGH findings must carry evidence or rule references — enforced by check constraint.';
comment on column post_outcome_findings.observed_fact is
  'What the retained record PROVES. Kept separate from counterfactual_improvement so a hypothesis can never be stored as an observation.';
comment on table post_outcome_analysis_reviews is
  'Append-only review events. Current reviewed state = latest row. Previous decisions are preserved, never updated in place.';
comment on table merchant_niche_classifications is
  'Append-only merchant niche history for cohort construction (plan §4.5). Table only — no UI in the first release (plan §25.6): benchmarking needs 3+ peer merchants per matched cohort and prod has 3 shops with analyzable decided cases.';
