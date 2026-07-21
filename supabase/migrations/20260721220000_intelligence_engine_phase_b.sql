-- Historical Intelligence Engine — Phase B schema.
--
-- Adds the recommendation store + decision/outcome log deferred from Phase A
-- (design §4, §11, §23). The decision log FK-references recommendations, which
-- is why both land together. All shop_id-scoped, RLS enabled/no-policy
-- (service-role only), reached only via the tenant-scoped DAL. Money as integer
-- minor units (bigint) + currency (no float).

-- Baseline descriptive report is stored on the run alongside data_quality.
alter table intelligence_analysis_runs
  add column if not exists baseline jsonb;

create table if not exists intelligence_recommendations (
  id                            uuid primary key default gen_random_uuid(),
  analysis_run_id               uuid not null references intelligence_analysis_runs(id) on delete cascade,
  shop_id                       uuid not null references shops(id) on delete cascade,
  category                      text not null
                                  check (category in ('prevention','response','automation','economic_non_response')),
  title                         text not null,
  summary                       text not null,
  suggested_action              text not null,
  affected_order_count          int not null default 0,
  affected_dispute_count        int not null default 0,
  affected_revenue_minor        bigint,
  affected_disputed_minor       bigint,
  currency                      text,
  baseline_metric               jsonb not null default '{}'::jsonb,   -- {name,value,numerator?,denominator?}
  estimate_lower_minor          bigint,
  estimate_point_minor          bigint,
  estimate_upper_minor          bigint,
  estimate_period               text check (estimate_period in ('historical_total','annualized')),
  evidence_grade                text not null
                                  check (evidence_grade in ('descriptive','adjusted_observational','prospectively_validated')),
  confidence                    text not null
                                  check (confidence in ('insufficient','low','moderate','high')),
  confidence_kind               text,   -- which rubric kind produced it
  implementation_effort         text check (implementation_effort in ('low','medium','high')),
  customer_friction_risk        text check (customer_friction_risk in ('low','medium','high')),
  limitations                   jsonb not null default '[]'::jsonb,
  assumptions                   jsonb not null default '[]'::jsonb,
  required_data_quality_checks  jsonb not null default '[]'::jsonb,
  supporting_segment_ids        jsonb not null default '[]'::jsonb,
  created_at                    timestamptz not null default now()
);

create index if not exists intelligence_recs_run_idx
  on intelligence_recommendations(analysis_run_id);
create index if not exists intelligence_recs_shop_idx
  on intelligence_recommendations(shop_id, created_at desc);

alter table intelligence_recommendations enable row level security;

create table if not exists intelligence_decision_log (
  id                    uuid primary key default gen_random_uuid(),
  shop_id               uuid not null references shops(id) on delete cascade,
  recommendation_id     uuid references intelligence_recommendations(id) on delete set null,
  analysis_run_id       uuid references intelligence_analysis_runs(id) on delete set null,
  actor                 text,
  action                text not null
                          check (action in ('shown','accepted','rejected','marked_later','modified','activated','overridden')),
  reason                text,
  outcome               jsonb not null default '{}'::jsonb,
  methodology_version   text,
  created_at            timestamptz not null default now()
);

create index if not exists intelligence_decision_log_shop_idx
  on intelligence_decision_log(shop_id, created_at desc);
create index if not exists intelligence_decision_log_rec_idx
  on intelligence_decision_log(recommendation_id);

alter table intelligence_decision_log enable row level security;

comment on table intelligence_recommendations is
  'Historical Intelligence Engine §11 recommendation objects, persisted per run. Never silently replaced. Phase B.';
comment on table intelligence_decision_log is
  'Merchant/admin actions on recommendations + later outcomes — foundation for prospective validation (§23). Phase B.';
