-- Gorgias evidence core (PRD "evidence core" MVP).
--
-- Upgrades the Phase-1 Gorgias integration (email-match + snapshot-everything
-- collector) to scored ticket matching, persisted per-dispute enrichment and
-- merchant-reviewed evidence. Four tables:
--
--   gorgias_matched_tickets   scored candidate tickets per dispute
--   gorgias_evidence_messages snapshotted public messages + review state
--   gorgias_enrichment_runs   run ledger (explicit state machine, LLM caps)
--   gorgias_match_reports     merchant "bad match" feedback for score tuning
--
-- Safety contract (see docs/technical.md § Gorgias evidence core):
--   - No message reaches an evidence pack without merchant approval once a
--     shop is in integrations.meta.evidence_mode = 'merchant_review_required'.
--   - Approvals capture approved_excerpt + approved_content_hash; the
--     collector only includes messages whose current content_hash equals the
--     hash captured at approval (source-drift guard).
--   - Runs are append-only history: retries resume the active row; a later
--     legitimate trigger inserts run_number+1. A partial unique index allows
--     at most ONE active run per (dispute, integration).
--
-- Server-only access via service role; RLS enabled with no policies
-- (deny-all for anon/authenticated), same posture as integrations/app_events.

-- ── Matched tickets ─────────────────────────────────────────────────────────

create table gorgias_matched_tickets (
  id                          uuid primary key default gen_random_uuid(),
  shop_id                     uuid not null references shops(id) on delete cascade,
  dispute_id                  uuid not null references disputes(id) on delete cascade,
  integration_id              uuid not null references integrations(id) on delete cascade,
  gorgias_ticket_id           bigint not null,
  gorgias_customer_id         bigint,
  match_score                 int not null,
  confidence                  text not null check (confidence in ('high','medium','low')),
  -- [{signal, points, detail?}] — the exact signals that produced the score
  match_reasons               jsonb not null default '[]'::jsonb,
  matching_algorithm_version  int not null,
  -- high tier is inserted as confirmed_match (auto-matched per PRD §11);
  -- medium + low arrive as proposed_match (medium needs merchant confirmation,
  -- low is the hidden "other possible conversations" tier).
  match_status                text not null default 'proposed_match'
                                check (match_status in ('proposed_match','confirmed_match','rejected_match')),
  analyzed_at                 timestamptz,
  -- subject/status/channel/created/csat frozen at enrichment time — Gorgias
  -- permanently purges trashed tickets and GDPR-deletes customers.
  ticket_snapshot             jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (shop_id, dispute_id, gorgias_ticket_id)
);

create index idx_gorgias_matched_tickets_dispute on gorgias_matched_tickets(dispute_id);
create index idx_gorgias_matched_tickets_shop on gorgias_matched_tickets(shop_id);
create index idx_gorgias_matched_tickets_pending
  on gorgias_matched_tickets(dispute_id)
  where match_status = 'proposed_match';

alter table gorgias_matched_tickets enable row level security;

-- ── Evidence messages ───────────────────────────────────────────────────────

create table gorgias_evidence_messages (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references shops(id) on delete cascade,
  dispute_id               uuid not null references disputes(id) on delete cascade,
  matched_ticket_id        uuid not null references gorgias_matched_tickets(id) on delete cascade,
  gorgias_message_id       bigint not null,
  sender_type              text not null check (sender_type in ('customer','merchant')),
  sender_name              text,
  channel                  text,
  sent_at                  timestamptz,
  -- Display snapshot (bounded at persist time). content_hash is computed
  -- over the FULL original text so post-approval source edits are detectable
  -- even when the display copy is truncated.
  message_text             text not null,
  content_truncated        boolean not null default false,
  original_character_count int,
  content_hash             text not null,
  evidence_category        text check (evidence_category in
                             ('transaction_recognition','delivery_recognition','product_usage',
                              'refund_history','cancellation_history','resolution_attempt','contradiction')),
  confidence_score         int check (confidence_score between 0 and 100),
  -- AI-generated, merchant-editable. Provenance stamped per row.
  relevance_explanation    text,
  explanation_edited       boolean not null default false,
  analyzer_model           text,
  analyzer_prompt_version  int,
  -- candidate = snapshotted only; proposed = AI-flagged, awaiting merchant;
  -- approved / manual = included in future pack snapshots; excluded = out.
  review_status            text not null default 'candidate'
                             check (review_status in ('candidate','proposed','approved','excluded','manual')),
  approved_at              timestamptz,
  approved_by              text,
  -- The exact passage the merchant approved (never the full body in a PDF).
  approved_excerpt         text,
  -- Hash captured at the moment of approval/manual selection. Collector
  -- includes a message only while content_hash = approved_content_hash.
  approved_content_hash    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (matched_ticket_id, gorgias_message_id)
);

create index idx_gorgias_evidence_messages_dispute on gorgias_evidence_messages(dispute_id);
create index idx_gorgias_evidence_messages_ticket on gorgias_evidence_messages(matched_ticket_id);
create index idx_gorgias_evidence_messages_shop on gorgias_evidence_messages(shop_id);
create index idx_gorgias_evidence_messages_proposed
  on gorgias_evidence_messages(dispute_id)
  where review_status = 'proposed';

alter table gorgias_evidence_messages enable row level security;

-- ── Enrichment runs (append-only ledger) ────────────────────────────────────

create table gorgias_enrichment_runs (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references shops(id) on delete cascade,
  dispute_id         uuid not null references disputes(id) on delete cascade,
  integration_id     uuid not null references integrations(id) on delete cascade,
  -- max+1 per (dispute, integration). Completed rows are never reset/reused:
  -- manual refresh / new messages / reconnect / no_matches retry each insert
  -- a new run, preserving history and event dedup.
  run_number         int not null,
  status             text not null default 'queued'
                       check (status in
                         ('queued','resolving_customer','searching_tickets','fetching_messages',
                          'analyzing','analysis_deferred','ready_for_review','completed',
                          'no_matches','failed_retryable','failed_terminal','cancelled')),
  trigger_source     text not null
                       check (trigger_source in ('dispute_opened','manual','ticket_confirmed','retry')),
  attempt_count      int not null default 0,
  next_retry_at      timestamptz,
  tickets_scanned    int not null default 0,
  tickets_high       int not null default 0,
  tickets_medium     int not null default 0,
  tickets_low        int not null default 0,
  messages_stored    int not null default 0,
  proposal_count     int not null default 0,
  approved_count     int not null default 0,
  analyzer_model     text,
  analyzer_version   int,
  prompt_tokens      int not null default 0,
  completion_tokens  int not null default 0,
  duration_ms        int not null default 0,
  -- Per-shop daily LLM cap accounting (narrativeWriter pattern).
  daily_bucket       date not null default (now()::date),
  error_code         text,
  error_message_safe text,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  unique (dispute_id, integration_id, run_number)
);

-- At most ONE active run per dispute+integration; terminal states free the slot.
create unique index idx_gorgias_enrichment_runs_active
  on gorgias_enrichment_runs(dispute_id, integration_id)
  where status in
    ('queued','resolving_customer','searching_tickets','fetching_messages','analyzing');

create index idx_gorgias_enrichment_runs_shop_dispute
  on gorgias_enrichment_runs(shop_id, dispute_id, started_at desc);
create index idx_gorgias_enrichment_runs_shop_bucket
  on gorgias_enrichment_runs(shop_id, daily_bucket);
create index idx_gorgias_enrichment_runs_status on gorgias_enrichment_runs(status);

alter table gorgias_enrichment_runs enable row level security;

-- ── Bad-match feedback (scoring tuning loop) ────────────────────────────────

create table gorgias_match_reports (
  id                          uuid primary key default gen_random_uuid(),
  shop_id                     uuid not null references shops(id) on delete cascade,
  dispute_id                  uuid not null references disputes(id) on delete cascade,
  matched_ticket_id           uuid not null references gorgias_matched_tickets(id) on delete cascade,
  message_id                  uuid references gorgias_evidence_messages(id) on delete set null,
  scope                       text not null check (scope in ('ticket','message')),
  merchant_reason             text,
  match_score_at_report       int not null,
  match_reasons_at_report     jsonb not null default '[]'::jsonb,
  matching_algorithm_version  int not null,
  created_at                  timestamptz not null default now()
);

create index idx_gorgias_match_reports_shop on gorgias_match_reports(shop_id);
create index idx_gorgias_match_reports_ticket on gorgias_match_reports(matched_ticket_id);

alter table gorgias_match_reports enable row level security;
