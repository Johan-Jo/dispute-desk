-- 20260523111400: shopify_order_risk_signals — structured Shopify
-- pre-authorization risk signals, broken out of the free-text
-- facts_json into queryable columns.
--
-- PR-D of "Structured Capture of Shopify Pre-Authorization Risk Signals".
--
-- Architectural contracts:
--   1. Latest-snapshot semantics. One row per (shop_id, shopify_order_id).
--      Historical raw assessments stay in shopify_order_risk_assessments
--      (hash-gated append). Re-parses overwrite this row;
--      source_assessment_id points at the assessment that produced the
--      current snapshot.
--   2. Structured-from-GraphQL fields (avs_*, cvv_*, card_*, wallet_*,
--      client_ip) ALWAYS win over parser-extracted equivalents. The
--      writer enforces this; tested explicitly in PR-D.
--   3. NULL means "Shopify didn't report this for this order" (e.g.
--      wallet checkouts where AVS isn't applicable, offline POS with no
--      clientIp). PR-E surfaces these as explicit `unknown` buckets —
--      missing signals are meaningful for friendly-fraud correlation.
--   4. parse_miss_reason names "parser attempted but failed" vs NULL =
--      "data genuinely absent". Distinguishes a Shopify rewording event
--      from a wallet checkout.
--   5. PII: client_ip is INET-typed. GDPR scrubber wipes both
--      client_ip and ip_country on customers/redact (see PR-D scrub
--      extension in lib/webhooks/scrubCustomerData usage).

create table shopify_order_risk_signals (
  id                          uuid        primary key default gen_random_uuid(),
  shop_id                     uuid        not null references shops(id) on delete cascade,
  shopify_order_id            text        not null,

  -- ── Structured-from-GraphQL (always preferred) ───────────────────
  client_ip                   inet,
  avs_address_result          text,
  avs_zip_result              text,
  cvv_result                  text,
  card_bin                    text,
  card_brand                  text,
  wallet_type                 text,

  -- ── Parsed-from-facts (only when no structured equivalent) ───────
  payment_attempt_count       int,
  proxy_detected              boolean,
  multiple_cards_tried        boolean,
  billing_country_matches_ip  boolean,
  ip_country                  text,
  ip_ship_distance_km         int,
  fraud_cluster_match         boolean,

  -- ── Provenance / audit ──────────────────────────────────────────
  source_assessment_id        uuid        references shopify_order_risk_assessments(id) on delete set null,
  source_assessment_created_at timestamptz,
  parser_version              int         not null,
  parsed_at                   timestamptz not null default now(),
  parse_miss_reason           text,

  unique (shop_id, shopify_order_id)
);

-- Signal-filter hot paths for PR-E intelligence cuts.
create index shopify_order_risk_signals_proxy_idx
  on shopify_order_risk_signals (shop_id, proxy_detected)
  where proxy_detected is not null;

create index shopify_order_risk_signals_attempts_idx
  on shopify_order_risk_signals (shop_id, payment_attempt_count)
  where payment_attempt_count is not null;

create index shopify_order_risk_signals_distance_idx
  on shopify_order_risk_signals (shop_id, ip_ship_distance_km)
  where ip_ship_distance_km is not null;

create index shopify_order_risk_signals_avs_idx
  on shopify_order_risk_signals (shop_id, avs_address_result)
  where avs_address_result is not null;

alter table shopify_order_risk_signals enable row level security;
-- No policies — service-role only (matches shopify_orders).

comment on table shopify_order_risk_signals is
  'Latest parsed/structured Shopify pre-auth risk signals per order. 1:1 with shopify_orders. PR-D of fraud-intelligence Phase 2 — see docs/technical.md.';
comment on column shopify_order_risk_signals.client_ip is
  'Customer IP from Order.clientIp (GraphQL). PII — wiped by customers/redact scrubber.';
comment on column shopify_order_risk_signals.parse_miss_reason is
  'Free-text reason set when parser was invoked but produced no signal (e.g. unmatched_phrase, locale_drift). NULL when data was genuinely absent (no Shopify risk assessment for the order).';

-- ── fraud_intel_parse_misses ─────────────────────────────────────────
-- Surface table for fact strings the parser didn't match. Drives the
-- /admin/fraud-intel ops widget (PR-E) so we can monitor parser drift
-- when Shopify rewords a signal.
create table fraud_intel_parse_misses (
  id              uuid        primary key default gen_random_uuid(),
  shop_id         uuid        not null references shops(id) on delete cascade,
  fact_text       text        not null,
  fact_sentiment  text,
  observed_at     timestamptz not null default now(),
  parser_version  int         not null
);

create index fraud_intel_parse_misses_recent_idx
  on fraud_intel_parse_misses (observed_at desc);

create index fraud_intel_parse_misses_text_idx
  on fraud_intel_parse_misses (fact_text);

alter table fraud_intel_parse_misses enable row level security;
-- No policies — service-role only.

comment on table fraud_intel_parse_misses is
  'Unmatched Shopify risk fact strings. Populated by the writer in lib/fraudIntel/factParser.ts. Watched by /admin/fraud-intel for parser-drift alerts.';
