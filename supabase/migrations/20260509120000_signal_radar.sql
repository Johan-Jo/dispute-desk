-- Signal Radar (M1)
-- Admin-only merchant-intelligence layer: ingests public discussions
-- (Reddit submissions + top-level comments for M1; Shopify Community
-- and App Store reviews in later milestones), classifies each item with
-- an LLM, and surfaces synthesis (why_this_matters, recurring phrases,
-- merchant_type, week-over-week trends) in /admin/signal-radar.
--
-- All three tables are service-role-only — never accessed from
-- merchant-facing surfaces.

-- ─── signal_sources ────────────────────────────────────────────────────────
-- Raw ingested items. Doubles as the classifier work-queue
-- (analysis_status = 'pending' → claim → 'classified'/'failed').
create table signal_sources (
  id                  uuid        primary key default gen_random_uuid(),
  platform            text        not null check (platform in ('reddit','shopify_community','app_store')),
  content_type        text        not null default 'submission' check (content_type in ('submission','comment')),
  external_id         text        not null,
  parent_external_id  text,
  subreddit           text,
  url                 text        not null,
  author              text,
  title               text,
  content             text        not null default '',
  raw_payload         jsonb       not null,
  posted_at           timestamptz not null,
  ingested_at         timestamptz not null default now(),
  cluster_key         text,
  analysis_status     text        not null default 'pending'
                        check (analysis_status in ('pending','classified','failed','skipped')),
  analysis_attempts   smallint    not null default 0,
  analysis_last_error text,
  analysis_locked_at  timestamptz,
  unique (platform, external_id)
);

create index idx_signal_sources_pending
  on signal_sources (posted_at desc)
  where analysis_status = 'pending';

create index idx_signal_sources_platform_posted
  on signal_sources (platform, posted_at desc);

create index idx_signal_sources_cluster
  on signal_sources (cluster_key, posted_at desc)
  where cluster_key is not null;

create index idx_signal_sources_parent
  on signal_sources (parent_external_id)
  where parent_external_id is not null;

alter table signal_sources enable row level security;

create policy service_role_all_signal_sources
  on signal_sources for all
  using (true)
  with check (true);

-- ─── signal_analysis ───────────────────────────────────────────────────────
-- 1:1 with signal_sources after classification. Holds all synthesis
-- fields: why_this_matters, merchant_type, scale signals, separate
-- frustration vs emotional intensity, source_confidence_score,
-- and snapshot cluster trend metrics for future trend-velocity views.
create table signal_analysis (
  id                          uuid        primary key default gen_random_uuid(),
  source_id                   uuid        not null unique
                                references signal_sources(id) on delete cascade,
  merchant_relevance          boolean     not null,
  frustration_score           smallint    not null check (frustration_score between 0 and 10),
  emotional_intensity_score   smallint    not null check (emotional_intensity_score between 0 and 10),
  signal_score                smallint    not null check (signal_score between 0 and 10),
  source_confidence_score     smallint    not null check (source_confidence_score between 0 and 10),
  category                    text        not null check (category in (
                                'migration_intent',
                                'transparency_frustration',
                                'operational_overload',
                                'reserve_fear',
                                'evidence_confusion',
                                'support_failure',
                                'competitor_frustration',
                                'general_discussion',
                                'spam',
                                'trolling'
                              )),
  competitor                  text,
  merchant_stage              text        check (merchant_stage in (
                                'small','scaling','distressed','high_risk','unknown'
                              )),
  merchant_type               text        not null check (merchant_type in (
                                'dropshipping','digital_goods','subscription',
                                'high_ticket_physical','pod','supplements','unknown'
                              )),
  merchant_scale_signals      jsonb       not null default '[]'::jsonb,
  suggested_angle             text,
  why_this_matters            text        not null,
  summary                     text        not null,
  cluster_size_24h            smallint,
  cluster_growth_rate         numeric(5,2),
  model                       text        not null,
  llm_raw                     jsonb       not null,
  created_at                  timestamptz not null default now()
);

create index idx_signal_analysis_category_score
  on signal_analysis (category, signal_score desc, created_at desc);

create index idx_signal_analysis_merchant_type
  on signal_analysis (merchant_type, created_at desc);

create index idx_signal_analysis_quality
  on signal_analysis (source_confidence_score desc, signal_score desc);

create index idx_signal_analysis_emotion
  on signal_analysis (emotional_intensity_score desc, created_at desc);

alter table signal_analysis enable row level security;

create policy service_role_all_signal_analysis
  on signal_analysis for all
  using (true)
  with check (true);

-- ─── signal_alerts ─────────────────────────────────────────────────────────
-- Sent-alert ledger. Powers two dedup paths (category-keyed and
-- cluster-keyed) plus a global circuit breaker.
create table signal_alerts (
  id                 uuid        primary key default gen_random_uuid(),
  source_id          uuid        references signal_sources(id) on delete cascade,
  alert_type         text        not null check (alert_type in ('immediate','digest')),
  category           text        not null,
  dedup_key          text        not null,
  cluster_dedup_key  text,
  recipient          text        not null,
  sent_at            timestamptz not null default now(),
  status             text        not null default 'sent'
);

create index idx_signal_alerts_dedup
  on signal_alerts (dedup_key, sent_at desc);

create index idx_signal_alerts_cluster_dedup
  on signal_alerts (cluster_dedup_key, sent_at desc)
  where cluster_dedup_key is not null;

create index idx_signal_alerts_sent_at
  on signal_alerts (sent_at desc);

alter table signal_alerts enable row level security;

create policy service_role_all_signal_alerts
  on signal_alerts for all
  using (true)
  with check (true);
