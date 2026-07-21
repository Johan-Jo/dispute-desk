# Historical Intelligence Engine & Policy Simulator — Design & Phase Plan

Status: **Phase A shipped to prod** (PRs #349→develop, #351→master; first in-prod run succeeded). **Phases B–E built on branch `feat/intelligence-engine-phases-b-e`** (approved 2026-07-21); migrations applied to **dev** (`vrpkgu`); pending PR → develop → master. §14 gate probes run (risk confirmed retrospective: `assessed_at` backfill-stamped from order date; 0 refund-timestamp columns). Surface decision: **internal `/admin/intelligence` first** (Tailwind, passkey auth, no 6-locale i18n); promote to embedded merchant tab only after validation. First production/validation case: **Blume Box** (resolved via its normal `shops` row — zero hardcoded identifiers).

This document is the §28 deliverable set. It is the source of truth for architecture, the analytical field map, the feature-availability matrix, the statistical methodology, and the honest Blume Box data assessment. It is versioned alongside the code.

### Revision log
- **v4 (2026-07-21) — final pre-Phase-A amendments.** (1) Response-win model target-population warning: it estimates `P(win | historically contested and adjudicated)`, not an unbiased win prob for all disputes — historical response-selection bias + transportability added to Phase-D gates and printed on predictions (§12, §7.2 model confidence). (2) Order-time fields (`order_total`/`currency`/`country`/cross-border) marked **UNVERIFIED for modeling** until immutability-at-order-time is proven (§6, §14.10). (3) Evidence availability no longer inferred from the item timestamp — underlying-event vs ingestion vs generation time separated; model-eligible only when the underlying event is proven `≤ scored_at` (§5.3, §14.11). (4) Raw response-rate denominator given an exact, provider-aware, unit-tested definition + disclosed excluded count (§7.1, §14.12). (5) Effectiveness multipliers are **integer basis points** (`3500`), not floats; all monetary math is `bigint` with a versioned rounding rule (§1.4). (6) Confidence split into four kinds — descriptive-data / statistical-estimate / recommendation / model — so confounder-availability & FDR never cap simple portfolio totals (§7.2). (7) `intelligence_decision_log` deferred to Phase B with `intelligence_recommendations` (no FK to a non-existent table) (§4, §12). (8) Job-plan label fixed: `intel_baseline` is **(Phase B+)**. Implementation remains blocked pending Johan's approval.
- **v3 (2026-07-21) — statistical-validity + isolation hardening.** (1) Win metrics split into four separate figures — full-win rate & any-recovery rate (Wilson binary) vs monetary recovery rate & avg recovery/response (bootstrap); partial wins get **no fractional credit inside a binomial**. (2) Customer tenure can no longer claim `new` — states are `returning` / `first_seen_in_observed_history` / `unknown`. (3) Response-win cutoff is an explicit per-row `scored_at` (instant before submission / recorded review time), **never `min(submitted_at, due_at)`**; unanswered disputes are excluded from win modeling (no outcome to train on); deadline snapshots are a separate labeled hypothetical. (4) `available_at` for payment_gateway / carrier / raw & normalized reason / network code marked **UNVERIFIED → descriptive-only** pending §14, distinguishing source-event vs ingestion vs classification-generation time. (5) Tenant isolation reworded — service role bypasses RLS, so `.eq(shop_id)` is app-level; require a tenant-scoped DAL, lint guard, and missing/wrong/cross-tenant tests, plus a DB-enforced boundary before merchant exposure. (6) Raw vs actionable response rate, each exclusion deterministic/counted/disclosed. (7) `amountMinor` is `bigint`/decimal-string, never JS `number`. (8) Confidence is a versioned cap-based rubric (`confidence_rubric_v1`, §7.2). (9) `unknown` outcome renamed `workflow_closed_but_outcome_unknown`. (10) Recommendation table deferred to Phase B. (11) Wording conflict resolved: **implementation remains blocked until Johan explicitly authorizes it.**
- **v2 (2026-07-21) — temporal-correctness hardening.** Reviewer flagged that coarse per-feature stage labels would permit leakage. Every model-eligible feature now requires an explicit `available_at` timestamp (or deterministic derivation rule), not just a stage. Delivery/signature/evidence-completeness/submission-timing are reclassified as **later observations / retrospective-analysis outcomes**, not automatic model features. Added: left-censored customer-history handling (`unknown` tenure), precise refund/return/support-event provenance (Available/Partial/Absent), analytical-view security-invoker design, conditional Phase-D model-feasibility gates, currency-aware minor units, outcome-terminal-set definitions, and multi-factor confidence. Open verification tasks (esp. the true provenance of `risk_level_initial`) are tracked in §14 and **block any modeling work**.

---

## 0. Prime directive (PRD §2, §3, §29)

This is **not** an LLM scoring system. It is: deterministic data-prep → statistics → deterministic recommendation + safety → *optional* LLM explanation → decision/outcome logging. Every number comes from reproducible SQL/app code. The engine **consumes** DisputeDesk's classification outputs and **never reclassifies**. It optimizes for a *small number of trustworthy, financially-meaningful, honestly-uncertain conclusions* — not a maximal insight count. Release 1 is decision **support**: no automatic cancellation, submission, or non-response.

---

## 1. Repository & schema findings

### 1.1 There is no normalized warehouse
DisputeDesk has **no** `customers` / `transactions` / `fulfillments` / `returns` / `refunds` tables — that data is fetched live from Shopify at pack-build time. Historical analytics must be built from what is persisted locally:

| Analytical entity | Backing table(s) | Key columns available |
|---|---|---|
| Orders (historical) | `shopify_orders` | `order_total numeric(14,2)`, `currency`, `country`, `is_cross_border`, `distance_bucket`, `payment_gateway`, `financial_status`, `fulfillment_status`, `cancel_reason`, `risk_level_initial`/`risk_recommendation_initial`/`risk_provider_initial` (**immutable after first ingest**), `fraud_protection_level`, `has_chargeback`, `chargeback_type`, `processed_at`, `created_at_shopify`, `fulfilled_at`, `cancelled_at`, `first_ingested_at`, `delivery_status`, `delivered_at_tracking`, `signed_by_name`, `tracking_source`, `customer_email`, `customer_shopify_id` |
| Risk history | `shopify_order_risk_assessments` | per-provider `risk_level`, `recommendation`, `facts_json`, `fact_sentiments`, `assessed_at`, `snapshot_at` |
| Tracking | `shopify_fulfillment_trackings` | `shipment_status` (Delivered/DeliveredToPickup/Returned), `terminal_at`, `carrier_normalized`, `line_item_coverage` |
| Disputes | `disputes` | `reason`, `phase`, `network_reason_code`+`network_reason_code_confidence`, `normalized_status`, `submission_state`, `submitted_at`, `final_outcome`, `outcome_amount_recovered/lost`, `outcome_source/confidence`, `closed_at`, `due_at`, `initiated_at`, `amount numeric`, `currency_code`, `order_gid`, `raw_snapshot` |
| Evidence | `evidence_packs` (`completeness_score`, `checklist`, `pack_json`, `package_type`), `evidence_items` (`type`, `source`, `payload`, `confidence`), `defence_evidence_facts` (`category` strong/moderate/supporting/invalid, `strength`, `bank_eligible`, `confidence`) |
| Qualification | `dispute_qualifications` | `ce30_status`, `ce30_branch`, `card_network`, `confidence` high/med/low, `missing_evidence[]` |
| Submission/outcome | `submission_logs` | `channel`, `final_outcome` (pending/won/lost/withdrawn/unknown), `outcome_recorded_at`, `retry_count` |
| Rollups | `shop_daily_metrics` (order/dispute/chargeback/inquiry counts), `shop_fraud_daily_metrics` (risk-bucket counts, `fully_protected_value`, `eligible_protected_value`) |

### 1.2 Classification is single-source — consume, never duplicate
Reliable inputs (already persisted/derived): `disputes.reason` (canonical `ALL_DISPUTE_REASONS`, 14 codes, `lib/rules/disputeReasons.ts`), `disputes.phase` (`inquiry`/`chargeback`/null, `lib/disputes/phaseUtils.ts`), `disputes.network_reason_code` + confidence (`lib/disputes/networkReasonCode.ts`), reason family via `resolveReasonFamily()` (`lib/argument/reasonFamily.ts`), evidence category via canonical `lib/argument/canonicalEvidence.ts` + `calculateCaseStrength()`, and the deterministic gates `summarizeCoverage()` (`lib/packs/sources/coverageSource.ts`, Shopify Protect) + `detectFatalLoss()` (`lib/automation/fatalLoss.ts`). **Caveat:** `lib/rules/disputeTypes.ts` is mid-rollback in the working tree — treat `ALL_DISPUTE_REASONS` as canonical, ignore `helpers.ts` `FAMILY_TO_DISPUTE_TYPE` aliases.

**Evidence-strength labels are upstream outputs, not the engine's to assign.** The stored categories `strong`/`moderate`/`supporting`/`invalid` (`defence_evidence_facts.category`, `lib/argument/canonicalEvidence.ts`) are produced by the rules/classification engine. The Intelligence Engine may **analyze** their observed association with outcomes but must **never**: (a) assign or change a category, (b) infer that AVS or CVV alone is "strong" evidence, or (c) treat a category as universally effective across dispute reasons — effectiveness is always measured *within* the applicable reason category, with sample gates, and reported as `descriptive` association, not proven efficacy.

### 1.3 Infrastructure to reuse (not rebuild)
`jobs` table + `claim_jobs` stale-lock reclaim RPC + 240s soft-budget checkpoint (cursor round-trips through `jobs.entity_id`) + **per-shop concurrency cap = 1** + `app/api/jobs/worker/route.ts` `switch` registration + `cronEnvGate`. **No materialized views exist** — the house pattern is plain rollup tables refreshed by jobs, paginating every large read at `DB_PAGE_SIZE = 1000` via `.range()` + stable `.order("id")` (PostgREST silently caps un-ranged selects at 1000). LLM access is a fetch wrapper `callClaudeMessages` (`lib/defence/anthropicClient.ts`) with a strict redaction boundary (`lib/defence/narrativeWriter.ts`) — the pattern for the optional explanation layer.

### 1.4 Money
There is **no `Money` type**; amounts are Postgres `numeric` and `lib/disputes/metrics.ts` sums in JS float and never crosses currencies. Decision: **aggregate in SQL** (numeric), and introduce an engine-local **integer-minor-units `Money`** with no float arithmetic, reusing the single-currency rule. Existing `metrics.ts` is left untouched.

**Currency-aware minor units — no assumption of 2 decimals.** Every `Money` carries `{ amountMinor, currency }` and resolves its **minor-unit exponent from the currency** (0 for JPY/KRW/CLP/…, 3 for BHD/KWD/OMR/TND, 2 otherwise), with an explicit rounding rule (half-up) applied only when converting a decimal source into minor units. Conversion and rounding rules are part of the type. Blume Box is single-currency today, but the engine is merchant-generic, so the exponent is never hardcoded to 2.

**`amountMinor` is represented as `bigint` (or a canonical decimal string at DB/JSON boundaries), never a JS `number`.** The DB stores minor units in `bigint` columns whose range exceeds JS `Number.MAX_SAFE_INTEGER`; a `number` representation could silently lose precision on large lifetime aggregates. In application code `Money.amountMinor: bigint`; at serialization boundaries (JSON, tool payloads) it is carried as a decimal **string** and re-parsed to `bigint` on read. **All arithmetic is integer `bigint` — including multipliers.**

**Effectiveness / ratio assumptions are NOT JS floats.** A "35% effectiveness" is stored as **integer basis points** (`3500`) — or an explicit decimal/rational type — never `0.35`. `scaleMoney(amount, bps)` computes `amount.amountMinor * bps / 10000n` in `bigint` and applies the **documented versioned rounding rule** (half-up, `rounding_rule_v1`) on the single final division. There is no floating-point step anywhere in a monetary path, so results are exactly reproducible.

---

## 2. Blume Box data assessment (real, measured — `scripts/sql/intel-blume-box-coverage-probe.sql`, prod `aokhply`, 2026-07-21)

| Metric | Value | Implication |
|---|---|---|
| Orders imported | **354,412** (import `complete`, 100%) | The configured historical import **completed successfully**; this confirms completion of the *requested* import, **not** that all Shopify history was captured |
| Observed order coverage | 2018-05-24 → 2026-07-21 | Currently covers this window. **Earlier Shopify history has not independently been proven absent** — treat 2018-05-24 as a coverage boundary, not a proven store-open date |
| Currencies | **1** | No cross-currency complication |
| Disputes | **454** | **Small N** — the binding constraint on segmentation |
| Dispute span | 2018-11 → 2026-07 | ~8 years |
| Disputes orphaned (no `order_gid`) | **0.0%** | Every dispute joins to an order |
| Disputes null `phase` | **0.0%** | Stage fully available |
| `final_outcome` won/lost/partially | **82.6%** (17.4% null) | Win-rate analysis **supportable** |
| Disputes with outcome amount | **375** | Net-loss/recovery **supportable** |
| `submitted_at` present | **81.7%** | Response-timing **supportable** |
| Median ingest lag (order→first ingest) | **~45,767 h (~5.2 yr)** | **Risk features are retrospective — leakage** |
| Orders ingested within 48h of order | **0.1%** | Confirms above |
| `shopify_orders.has_chargeback = true` | **0.000%** | **Unusable flag** — join via `order_gid` |
| Network code `direct`/`derived` | **0.0%** | Codes 100% inferred — no reason-code segmentation |
| `delivery_status` null | 36.8% | Delivery signal partial |
| `payment_gateway` null | 7.4% | Payment segmentation usable-with-limits |
| `country` null | 0.3% | Geo segmentation reliable |

### Verdict per proposed analysis
- **Descriptive dispute & loss report — SUPPORTED (Reliable), with defined terms.** 454 disputes, good outcome/amount coverage, single currency, full phase coverage, all order-linked. "Resolved", "win rate", and "recovery" are only meaningful against the **explicit terminal-outcome set and denominators defined in §7.1** — the 82.6% figure below is *not* used raw.
- **Win-rate / response analysis — SUPPORTED WITH LIMITATIONS.** Enough for aggregate rates with Wilson CIs over a defined denominator; label all responded-vs-unanswered comparisons **selection-biased, non-causal**. `submitted_at`, submission timing, and final pack composition are **retrospective-analysis outcomes here — they must not become response-*model* features** (§6, §7.1).
- **Risk-based prevention (causal) — NOT SUPPORTED (pending provenance check).** The ~5.2-year median ingest lag is strong evidence that `risk_level_initial` is post-hoc. **But `first_ingested_at` is not a sufficient test on its own** — the true question is what timestamp `risk_level_initial` actually reflects (a historically-preserved Shopify assessment time / the state returned at backfill / a later snapshot). Until that provenance is established (§14, blocking), risk features are held `POST_OUTCOME_ONLY`/retrospective and risk-based prevention claims are **suppressed** for backfilled orders. (Valid *prospectively* only for orders ingested live near creation — future data.)
- **Reason-code-level segmentation — WEAK.** 100% inferred network codes; use `disputes.reason` (coarse, reliable) and `reasonFamily`, not network codes.
- **Customer tenure — LEFT-CENSORED; cannot prove "new".** Prior orders computed as-of the order date prevents *future* leakage, but a customer first *seen* in the imported window (esp. near 2018-05-24) may have purchases before the coverage boundary — and waiting a longer wash-in does **not** prove they had none. The engine therefore emits only `returning` (an earlier order is observable), `first_seen_in_observed_history` (no earlier order found — **not** a claim of newness), or `unknown` (insufficient history). It labels a customer genuinely **`new` only if Shopify supplies a reliable full-history customer-creation / first-order date** covering the store's whole lifetime (§5.1, §6, §14).
- **Evidence effectiveness / AVS / CVV / 3DS / billing-mismatch / cost-margin — INSUFFICIENT/ABSENT.** Not captured historically per-order → suppressed, never fabricated.
- **Fine segment slicing — mostly SUPPRESSED.** With 454 disputes, most category×segment cells fall below sample gates. This is the concrete reason the report will surface *few* conclusions.

---

## 3. Architecture (5 layers + logging), all under `lib/intelligence/**`

1. **Data-prep** — deterministic SQL analytical **views** over existing tables (§6 entities); aggregation in SQL, never load 340k rows into memory.
2. **Feature registry** — code-first (`lib/intelligence/features/registry.ts`), version-hashed and pinned per run; each feature declares source, definition, availability stage **and an `available_at` timestamp/derivation rule** (§6), missing-value interpretation, prevention/response-model eligibility (each gated by a per-row `available_at ≤ cutoff` proof), analytical-outcome-only flag, and retrospective-only flag.
3. **Statistics** — `lib/intelligence/stats/`: Wilson intervals, percentile bootstrap, configurable sample gates, Benjamini-Hochberg FDR, chronological splits. Pure + unit-tested.
4. **Recommendation + safety** — deterministic builder emitting the §11 `IntelligenceRecommendation`; evidence grades + suppression/safety gates (§24).
5. **LLM explanation (Phase E, deferred)** — admin-only English prose from validated objects only; never recalculates numbers.
6. **Decision/outcome log** — `intelligence_decision_log` for future prospective validation (**Phase B**, with `intelligence_recommendations`).

Runs are **async multi-stage jobs**; results are versioned and reproducible.

---

## 4. Database migration plan

New migration `supabase/migrations/<ts>_intelligence_engine.sql` — all tables `shop_id`-scoped, **RLS enabled with no policies** (service-role only), matching the analytics-table convention:

- `intelligence_analysis_runs` — `id`, `shop_id`, `status` (queued/running/auditing/preparing/reporting/succeeded/failed), `stage`, `started_at`, `completed_at`, `data_cutoff`, `source_row_counts jsonb`, `feature_registry_version`, `classification_version`, `methodology_version`, `config jsonb`, `cost_assumptions jsonb`, `data_quality jsonb`, `warnings jsonb`, `errors jsonb`, `checkpoint jsonb`, timestamps. (§19 reproducibility.)
- `intelligence_recommendations` — **deferred to Phase B** (schema stabilizes with the descriptive report). When added: the §11 object columns + `analysis_run_id` FK; money as `*_amount_minor bigint` + `*_currency text` (no float); never silently replaced (new run = new rows).
- `intelligence_decision_log` — **deferred to Phase B alongside `intelligence_recommendations`** (it references `recommendation_id`, whose table does not exist in Phase A, and no recommendation can be acted on in Phase A anyway). When added: `recommendation_id` FK, `analysis_run_id`, `shop_id`, `actor`, `action` (shown/accepted/rejected/marked_later/modified), `reason`, `outcome jsonb`, `methodology_version`, timestamps.
- Analytical **views** (non-materialized): `intel_order_records`, `intel_dispute_records`, `intel_evidence_records`, `intel_event_records`.

Applied in-session via **`npm run db:migrate:dev`** (dev first), never bare `db:migrate`.

### 4.1 Tenant isolation for the analytical layer (honest about what enforces it)
**The service role bypasses RLS.** So `.eq("shop_id", …)` is **application-level enforcement, not a database-enforced tenant boundary** — and a test that a *correctly filtered* query works does **not** prove an *unfiltered* query can't leak. RLS-enabled/no-policy base tables + `security_invoker` views protect only against anon/authenticated access, not against a service-role query that forgets the filter. For **internal admin Release 1 this is acceptable, but only if explicitly acknowledged** and wrapped in the following discipline; a stronger, database-enforced boundary is required before any merchant exposure.

- **Single tenant-scoped data-access layer** — all reads of `intel_*` views/tables go through one module (`lib/intelligence/db/tenantScope.ts`) whose every function **requires a `shopId`** and always applies `.eq("shop_id", shopId)`. There is no other code path to the analytical data.
- **No direct analytical-view access elsewhere** — enforced by an ESLint rule / CI grep forbidding `from("intel_...")` and `getServiceClient().from("intelligence_...")` outside that module (mirrors the existing forbidden-copy CI grep).
- **Tests reject missing, wrong, and cross-tenant identifiers** — the DAL throws on absent/empty `shopId`; a seeded two-shop test asserts shop A's calls never return shop B's rows, and that omitting `shopId` fails closed rather than returning all shops.
- **`security_invoker = true`** on every `intel_*` view (Postgres 15+, Supabase) so a view owner can't become an RLS-bypass hole for non-service roles.
- **No grants to merchant-facing roles** (`revoke all ... from anon, authenticated`); only the service role reads them during the admin-only phase.
- **Documented DB-boundary upgrade before merchant exposure** — e.g. a per-request scoped role / RLS with a `shop_id` claim — tracked as a prerequisite in §14, not deferred silently.

---

## 5. Analytical field map (PRD §6 → source)

Legend: **A**=available, **D**=derivable in SQL, **P**=partial (missingness noted), **X**=absent (suppress).

### 5.1 Order/transaction record → `intel_order_records` (over `shopify_orders` + joins)
`shop_id` A · `order_id`(shopify_order_id) A · `processed_at`/`created_at_shopify` A · `currency` A · `order_total` (gross) A · net/discount/shipping/tax/refund breakdown **X** · cost/margin **X** (config assumption only) · `country`/`is_cross_border` A · `payment_gateway` P(7.4% null) · `financial_status`/`fulfillment_status` (see §6 for timing) · `risk_level_initial` A-but-**retrospective (provenance pending, §14)** · `delivery_status`/`delivered_at_tracking`/`signed_by_name` — **later observations, timing-gated (§6)** · AVS/CVV/3DS/billing-mismatch/IP-geo/failed-attempts/accelerated-checkout **X** · `has_chargeback` **X (unusable)** → dispute link via `order_gid` **D** · order hour/weekday/value-band **D**.

**Customer tenure — left-censored; the engine does not claim "new".** Prior-order counts are computed **as-of the order date** (no future leakage) from `customer_shopify_id`. But the imported window is a **coverage boundary**, not the customer's true first purchase — and no wash-in period can prove a customer had no order before the boundary. Each order carries:
- `customer_history_coverage_start` — earliest order date observable for this shop (the left-censor boundary).
- **tenure ∈ {`returning`, `first_seen_in_observed_history`, `unknown`}**, defined deterministically:
  - `returning` — an earlier order for this customer exists in observable history.
  - `first_seen_in_observed_history` — no earlier order was found *within the imported window*. This is **not** a claim of newness; it explicitly does not rule out pre-boundary orders.
  - `unknown` — history is insufficient to decide (e.g. `customer_shopify_id` null, or the order sits at/near the coverage boundary).
- A genuine **`new` label is emitted only if a reliable full-history signal exists** — a Shopify customer-creation date or first-order date proven to cover the store's entire lifetime (see §14). Absent that, `new` is never asserted. Any optional wash-in window used to raise confidence in `first_seen_in_observed_history` is stated as an explicit parameter and labeled as *not proof of newness*.

### 5.2 Dispute record → `intel_dispute_records` (over `disputes` + `submission_logs` + `dispute_qualifications`)
All core fields **A** (see §1.1). `classification_confidence` from `network_reason_code_confidence` (note: 100% inferred for Blume Box) + `dispute_qualifications.confidence`. `outcome_finality` **D** from `final_outcome` ∈ the **explicit terminal set defined in §7.1** + `closed_at` — not merely "non-null".

**Analytical outcomes vs predictive features (critical).** `submitted_at`, submission timing, final pack composition, and `evidence_packs.completeness_score` are surfaced here **for retrospective response analysis only**. They may post-date submission (pack completeness is often computed *after* the fact), so they are **flagged non-predictive** and are barred from any response-*win* model by the feature registry (§6). The engine may report "responded packs with X had win rate Y" (descriptive, selection-biased) but must not feed X into a model that predicts win at response time.

### 5.3 Evidence record → `intel_evidence_records` (over `evidence_items` + `defence_evidence_facts`)
type/source/category/strength/`bank_eligible` **A**; contradiction **X** (no contradiction model exists — do not claim).

**Availability is NOT inferable from the `evidence_items` timestamp.** That timestamp records when DisputeDesk **generated/stored** the item, which is neither when the underlying fact became true nor a proof it was usable before the response cutoff. The record therefore distinguishes three times: **(a) underlying-event time** (when the fact became true — e.g. the delivery scan), **(b) ingestion time** (when DisputeDesk fetched it), **(c) extraction/pack-generation time** (when the item/score was computed). A delivery may pre-date the deadline even though its evidence item was generated later; conversely a pack-generation timestamp does **not** prove the evidence existed then. Evidence is **response-model-eligible only when the underlying-event time (a) is proven `≤ scored_at`** (§6) — not from (b) or (c). For descriptive reporting we may state "evidence item present"; we do not assert it was *available before the deadline* without (a).

### 5.4 Operational event record → `intel_event_records`
A **financial status is not a timestamped event.** Each event class is graded by whether a reliable *chronology* can be reconstructed, and dependent analysis is suppressed unless the source is **Available**:

| Event class | Grade | Persisted source + timestamp |
|---|---|---|
| Fulfillment / shipment accepted | Available | `shopify_orders.fulfilled_at`; `shopify_fulfillment_trackings` (`fulfillment_status`) |
| Delivery / signature | Partial | `shopify_orders.delivered_at_tracking`, `signed_by_name` (36.8% null); `shopify_fulfillment_trackings.terminal_at`/`shipment_status`. Timing-gated, not always present |
| Cancellation | Available | `shopify_orders.cancelled_at` |
| **Refund** | **Absent (chronology)** | Only `financial_status` (a *state*, not an event) is persisted; there is **no timestamped refund-event table**. Refund *timing* (before/after dispute) cannot be reconstructed reliably → **refund-timing analysis suppressed** unless/until a timestamped source is confirmed (§14). `fatalLoss` uses live `totalRefundedSet` at pack time, not a historical event stream. |
| **Return** | **Absent (chronology)** | No persisted timestamped return-event stream locally → return-timeline analysis suppressed |
| **Support interactions (Gorgias)** | **Partial → Absent for history** | Only for shops with Gorgias connected, and typically forward-looking (post-connection); **no historical backfill** → treat as Absent for pre-connection history, Partial after |
| Dispute create / submit / decision | Available | `disputes.initiated_at`/`submitted_at`/`closed_at`; `submission_logs`; `dispute_events` |

Phase A surfaces the existing normalized `dispute_events` ledger; order milestones (fulfillment/delivery/cancellation) are added in Phase B **only for the Available classes above**. No claim is made about refund/return chronology.

---

## 6. Feature-availability model (registry seed)

**A stage label alone is insufficient and would permit leakage.** Every model-eligible feature declares **both** (a) a coarse availability stage *and* (b) an **`available_at` rule**: either a concrete timestamp column, or a deterministic derivation, that establishes the exact instant the value became known. A feature may enter a model only when its `available_at ≤ the decision/cutoff instant of that model` is **provable from data**, not assumed from its stage.

Stages: `ORDER_DECISION_TIME` (ODT), `SHIP_DECISION_TIME` (SDT — what's known when choosing to ship, e.g. shipping method), `POST_SHIP_OBSERVATION` (PSO — delivery/signature outcomes that arrive later), `DISPUTE_RESPONSE_TIME` (DRT), `POST_OUTCOME_ONLY` (POO).

**Model cutoffs are per-row decision timestamps, not deadlines.**
- **Prevention cutoff** = the fulfillment/ship decision instant for the row.
- **Response(win) cutoff = an explicit `scored_at` / historical decision timestamp**, NOT `min(submitted_at, due_at)`:
  - **Submitted cases** → the instant immediately **before `submitted_at`** (what was known when the merchant chose to submit).
  - **Merchant-reviewed cases** → the recorded review/decision time.
  - **Unanswered cases with no recorded decision time** → **excluded from response-win modeling entirely.** Using `due_at` here would leak information that only appeared between the real operational decision and the deadline. Moreover, an unanswered dispute has **no contest outcome**, so it cannot train a win model regardless.
  - A **deadline snapshot** (state as of `due_at`) may be computed **separately and only as an explicitly-labeled hypothetical**, never as the training cutoff.

| Feature | Stage | `available_at` rule | Prevention feature? | Response-WIN feature? | Missing = |
|---|---|---|---|---|---|
| order_total, currency, country, is_cross_border, order hour/weekday, value_band | ODT? | `created_at_shopify` proves *order creation* time, **not** that the persisted value is the original historical value vs a later backfill snapshot — **UNVERIFIED for modeling** (§14) | descriptive ✅; model-eligible only after provenance/immutability verified | descriptive ✅; model-eligible only after verified | unknown |
| payment_gateway | ODT? | `created_at_shopify` **UNVERIFIED** — gateway may only be known *after* transaction processing (§14) | descriptive until verified | descriptive until verified | unknown (not "other") |
| customer tenure/prior-orders | ODT | as-of `created_at_shopify`, three-state `{returning, first_seen_in_observed_history, unknown}` (§5.1) | ✅ (tenure∈{returning,first_seen…}) | ✅ (same) | `unknown` tenure |
| shipping method / carrier chosen | SDT? | `fulfilled_at` records the *action*, not necessarily when the choice became available — **UNVERIFIED** (§14) | descriptive until verified | descriptive until verified | unknown |
| **delivery_status, delivered_at_tracking, signed_by_name** | **PSO** | **`delivered_at_tracking` / tracking `terminal_at`** — a *later* observation; must be a real event time, not ingest time (§14) | ❌ (outcome, post-decision) | ✅ **only if** its event timestamp `≤ scored_at`; else excluded | unknown (**not** "not delivered") |
| risk_level_initial (**backfilled**) | **POO (pending §14)** | timestamp provenance unproven → treated as post-hoc | ❌ | ❌ | unknown |
| dispute.reason (raw) | DRT | raw provider reason plausibly at `initiated_at`; **normalized classification may be generated later — verify (§14)** | ❌ | ✅ (raw reason); normalized only if generation time ≤ scored_at | GENERAL / unknown |
| dispute.phase | DRT | `initiated_at` (synced from Shopify `type`) | ❌ | ✅ | unknown |
| network_reason_code (inferred) | DRT | requires a **persisted classification timestamp** to be response-eligible — none today → descriptive-only (§14); 100% inferred here | ❌ | descriptive-only | unknown |
| **evidence completeness, pack composition, submitted_at, submission timing** | DRT/POO | pack scores often computed **after** submission → **non-predictive** | ❌ | ❌ **(analytical outcome only, §5.2)** | unknown |
| final_outcome, outcome_amount_* | POO | `closed_at` | ❌ | ❌ (label only) | unknown |

**Three distinct timestamps per feature.** The registry records, and `available_at` proofs distinguish, (a) **source-event time** (when the fact became true in the world), (b) **ingestion time** (when DisputeDesk stored it), and (c) **classification-generation time** (when a *derived* value like normalized reason / network code was computed). A feature is model-eligible only when its **source-event OR classification-generation time** (whichever governs the value used) is proven `≤ cutoff`. Where only ingestion time is known and it post-dates the decision, the feature is **descriptive/retrospective-only**.

**Leakage rules (test-enforced):**
1. A feature is prevention-model-eligible only if stage ∈ {ODT, SDT} **and** its governing timestamp `≤ ship/fulfillment decision instant` for the row.
2. A feature is response-*win*-model-eligible only if its governing timestamp `≤ scored_at` (the per-row decision timestamp above) — enforced **per row via timestamp**, never inferred from the stage, and **never using `due_at` as the cutoff**. Unanswered disputes without a recorded decision time are excluded from response-win modeling. Post-ship observations qualify *only* when their own event timestamp proves pre-`scored_at` availability.
3. `submitted_at`, submission timing, pack composition, and evidence completeness are **analytical outcomes, never win-model features** (they can post-date submission).
4. Customer history excludes future orders; tenure is `{returning, first_seen_in_observed_history, unknown}` — never `new` without a proven full-history signal.
5. `final_outcome`/`outcome_amount_*` never enter any predictive feature set.
6. Any feature failing its timestamp proof for a given row is **excluded for that row**, not imputed.
7. Fields marked **UNVERIFIED** above are **descriptive-only until §14 resolves their true availability timestamp** — they may not be marked model-eligible in the registry before then.

---

## 7. Statistical methodology

- **Proportions** (dispute rate, win rate, response rate): Wilson score interval; always report numerator/denominator/period/population/missingness.
- **Financial ranges** (avoided-loss, EV): percentile bootstrap over `numeric`/minor-unit amounts; conservative/expected/optimistic effectiveness scenarios for simulations.
- **Sample gates** (configurable): min exposed population, min dispute events, min resolved outcomes, max missingness, min historical periods. Below gate → `exploratory` label or suppression.
- **Multiple comparisons**: Benjamini-Hochberg FDR across the recommendation candidate set; plus chronological holdout + cross-period stability.
- **Causation guard**: observational action comparisons (responded-vs-unanswered, signed-vs-unsigned, reviewed-vs-unreviewed) are `descriptive` and explicitly labeled selection-biased; never causal wording.
- **Evidence grades**: `descriptive` (historical association) / `adjusted_observational` (confounder-adjusted + time-validated) / `prospectively_validated` (post-definition outcomes). Retrospective Blume Box findings **cannot** be `prospectively_validated`.
- **Confidence** (`insufficient`/`low`/`moderate`/`high`) is produced by the **explicit, versioned rubric in §7.2** — a deterministic scoring-and-capping function so identical inputs always yield identical confidence. It is multi-factor and **cap-based** (the final label is the *minimum* of per-factor caps), so a large but systematically biased dataset can never earn `high`.

### 7.1 Terminal-outcome set, denominators, and interval methods (defined, not assumed)
"Resolved" is **not** "any non-null outcome." The terminal set is explicit and unit-tested. Note the rename: `unknown` → **`workflow_closed_but_outcome_unknown`** (the workflow is terminal but no adjudicated outcome is known) to remove the "terminal yet excluded from resolved" ambiguity.

| Outcome | Workflow terminal? | Adjudicated? | In `full_win`/`any_recovery` denom? |
|---|---|---|---|
| `won` | ✅ | ✅ | ✅ |
| `partially_won` | ✅ | ✅ | ✅ |
| `lost` | ✅ | ✅ | ✅ |
| `withdrawn` | ✅ | ❌ (no adjudication) | ✗ excluded |
| `closed_other` / closed without monetary result | ✅ | ❌ | ✗ excluded |
| `workflow_closed_but_outcome_unknown` | ✅ | ❌ | ✗ excluded |
| `pending` / null | ❌ | ❌ | ✗ excluded |

**Adjudicated, responded** = `{won, partially_won, lost}` with a response recorded. This is the denominator for the binary case rates.

**Report four *separate* metrics — never blend a case rate with a monetary ratio:**
1. **Full-win rate** = `won` ÷ adjudicated responded. Binary → **Wilson** interval.
2. **Any-recovery rate** = (`won` + `partially_won`) ÷ adjudicated responded. Binary → **Wilson** interval.
3. **Monetary recovery rate** = Σ`outcome_amount_recovered` ÷ Σ`disputed amount` (minor units), over disputes with amounts. Continuous ratio → **bootstrap** interval. **Never** a Wilson interval.
4. **Average recovery per response** = Σ`outcome_amount_recovered` ÷ count of responses (minor units) → **bootstrap** interval.

`partially_won` gets **no fractional credit inside a binomial** — partial recovery is captured only by metrics 3–4. Wilson is applied **only** to the binary rates (1, 2); bootstrap to the monetary quantities (3, 4). All numerators/denominators/exclusions are surfaced.

**Two response rates (every exclusion deterministic, historically available, counted, disclosed):**
- **Raw response rate** = disputes with `submitted_at` present ÷ **disputes with an establishable response opportunity**, defined exactly and unit-tested as: *disputes with a valid `initiated_at` AND a recorded response deadline (`due_at`), excluding only records where the provider explicitly supplied no response mechanism* (per the real provider payload in `raw_snapshot`, not an assumption). No classification-dependent exclusions. The precise predicate follows provider data; the count of disputes **excluded because no response opportunity/deadline could be established** is shown to the user, never silently dropped.
- **Actionable response rate** = disputes with `submitted_at` present ÷ disputes **deterministically eligible at the relevant historical time** (deadline known then; not deterministically covered/fatal-loss-blocked *as of that time*). Every exclusion carries a documented rule, an availability timestamp, and a **count shown to the user** — exclusions can only *reduce* the denominator when provably historical, never retroactively.

**Recovery / net loss** computed only over disputes with an outcome amount, in `bigint` minor units; disputes without amounts are reported as a separate coverage figure, never imputed to zero.

### 7.2 Confidence rubric (versioned: `confidence_rubric_v1`, deterministic)
**Confidence has four kinds, and only the *applicable* factors are evaluated for each** — so a correctly computed portfolio total is never marked `low` merely because a confounder is unavailable:

| Confidence kind | Applies to | Factors that apply |
|---|---|---|
| **Data/measurement confidence** | descriptive factual totals (total disputes, total disputed amount, raw response count) | sample completeness, missingness, measurement validity **only**. Confounder availability, FDR, temporal-stability, and CI width **do not apply** |
| **Statistical-estimate confidence** | rates & segment comparisons (win rate, dispute rate, segment deltas) | all §7.2 factors incl. CI width, temporal stability, FDR |
| **Recommendation confidence** | proposed actions (§10 cards) | statistical-estimate factors + confounder availability + effect-transportability |
| **Model confidence** | predictions (Phase D) | calibration, backtest stability, class balance, **target-population transportability** (§12), plus the above |

Within the applicable set, confidence = `min` of every applicable per-factor cap. Ordering `insufficient < low < moderate < high`. Thresholds are config constants (below are the v1 defaults) so identical inputs always produce identical output; changing them bumps the rubric version, which is pinned into the run. Each factor row below is tagged with the kinds it applies to.

| Factor | Cap `high` requires | Cap `moderate` | Cap `low` | Forces `insufficient` |
|---|---|---|---|---|
| Sample sufficiency | events ≥ `gate.high` (e.g. ≥100 adjudicated) | ≥ `gate.mod` (e.g. ≥30) | ≥ `gate.min` (e.g. ≥10) | below `gate.min` |
| CI width (binary) | ≤ 0.10 | ≤ 0.20 | ≤ 0.35 | > 0.35 |
| Missingness (of the driving field) | ≤ 5% | ≤ 15% | ≤ 30% | > 30% |
| Temporal stability | consistent sign & overlapping CIs across all chronological folds | consistent sign | one unstable fold | reverses across folds |
| Classification reliability | inputs `direct`/`derived` | mixed | inputs mostly `inferred` (caps at `low`) | — |
| Measurement validity | field measures the claim at the correct time (proven) | minor proxy | known proxy/timing gap | invalid for the claim |
| Multiple-comparison survival *(estimate/recommendation/model only — N/A to descriptive totals)* | passes FDR at q=0.05 | passes q=0.10 | exploratory-labeled | — |
| Confounder availability *(recommendation/model only — N/A to descriptive totals & simple estimates)* | key confounders measured | some measured | **principal confounders unmeasured → cap `low`** | — |
| CI width / temporal stability *(estimate/recommendation/model only — N/A to descriptive totals)* | see rows above | | | |

Worked implication: a finding on 100%-inferred network codes is capped `low` by the classification-reliability factor regardless of sample size; a retrospective risk feature is `insufficient` via measurement validity. The function is pure and unit-tested against fixed input vectors.

---

## 8. Expected-value framework (§15)

Configurable costs (`intelligence_analysis_runs.cost_assumptions`): human response time × loaded hourly cost, dispute/processing fees, evidence-generation cost, manual-review cost, signature/shipping-upgrade cost, gross margin, optional friction cost, economic safety margin. `EV_respond = P(win) × recoverable − response_cost − incremental_fees`, computed in minor units. Missing cost data → show range or require merchant assumption; never silently default.

---

## 9. Background-job design

Job types chained via `enqueueJob` (per-shop cap serializes): `intel_run_start` → `intel_audit` → `intel_prepare` → (Phase B+) `intel_baseline` → `intel_recommend`. Reuses 240s checkpoint (cursor/stage in `jobs.entity_id` + `runs.checkpoint`), duplicate-run guard (no existing queued/running run for shop), idempotency by `run_id`, progress on the run row, worker `switch` + import registration. Admin-triggered; optional cron later behind `cronEnvGate`. Every large read paginates at 1000 rows.

---

## 10. UI & component plan (admin-first)

`/admin/intelligence` (Tailwind, `getAdminSessionUser()` auth, `ADMIN_NAV` entry): **Overview** (coverage, losses/recoveries, top opportunities), **Opportunities** (recommendation cards: recommendation, why-it-matters, financial estimate, sample size, confidence, evidence grade, effort, friction, limitations, supporting data, actions), **Policy Simulator**, **Data Quality**, **Methodology**. Phase A ships a minimal shell: trigger run, list runs, render the Data-Quality report. APIs under `app/api/admin/intelligence/*` guarded by `getAdminSessionUser()`.

---

## 11. Privacy & tenant isolation

Every table `shop_id` + RLS(no policy)/service-role; every query `.eq("shop_id", …)`; no raw PII in analytical outputs (customer identifiers are join keys only, tokenized/hashed in any surfaced output); no cross-merchant training; LLM (later) receives no raw PII; admin report access recorded via `audit_events`. Blume Box resolved through its `shops` row — no hardcoded identifiers. Tenant deletion cascades derived analytical rows (FKs `on delete cascade` to `shops`).

---

## 12. Implementation sequence (phases)

- **Phase A (BUILT 2026-07-21 on `feat/intelligence-engine-phase-a`; migration on dev; validated vs prod read-only):** analysis-run + data-quality-audit infrastructure; analytical views (with §4.1 tenant-scoped DAL); feature registry; `intel_data_quality_audit` + run job; stats primitives (Wilson, bootstrap, gates, `confidence_rubric_v1`); leakage + tenant-isolation tests; minimal `/admin/intelligence` shell (trigger run, list runs, render data-quality report); run the audit against Blume Box. **The recommendation table AND the decision log are deferred to Phase B** — Phase A creates only `intelligence_analysis_runs` + audit results. Both `intelligence_recommendations` and `intelligence_decision_log` land in Phase B (the log FK-references recommendations, and nothing is acted on in Phase A), so no Phase A migration references a not-yet-existing table.
- **Phase B (BUILT):** baseline descriptive report (the §7.1 metrics with correct interval methods); `intelligence_recommendations` + `intelligence_decision_log` schema + wiring; descriptive opportunity detection; fuller Intelligence UI.
- **Phase C (BUILT):** Policy Simulator (`intel_simulate_segment` RPC, templates, integer-basis-point scenario assumptions, financial ranges, friction exposure).
- **Phase D (CONDITIONAL — gated, not promised):** First run a **model-feasibility evaluation** on effective sample size, event counts, temporal coverage, class balance, backtest stability, **and target-population transportability**. **Implement a model only where the predefined gates pass.** Otherwise, document that modeling is **unsupported** and retain descriptive outputs. Given 454 disputes / ~375 recorded outcomes, the realistic expectation is: a portfolio-level *descriptive* report is fine; a single pooled response model may be underpowered after chronological splits; **category-specific calibration is likely unsupported**; a prevention model is likely **unusable** because the principal historical risk features are retrospective (§2, §14). No portfolio/category/calibrated model is committed in advance — each must clear its gate or be explicitly reported as not built.
  - **Response-model target-population warning (a hard limitation, surfaced merchant-facing).** Training data is **only historically responded *and adjudicated* disputes** — unanswered disputes have no contest outcome. A response-win model therefore estimates **`P(win | historically contested and adjudicated)`**, *not* an unbiased win probability for every future dispute. Historical response selection may be strongly biased (merchants likely contested the more winnable cases), so estimates **do not transport** to unanswered/never-contested populations without an explicit selection-bias adjustment. **Feasibility gates add:** (i) a quantified historical response-selection-bias check, and (ii) a transportability assessment to the intended decision population; failing either blocks the model or restricts its stated scope. This limitation is printed on any prediction the model produces.
- **Phase E (BUILT):** LLM explanation layer (admin-only English, `callClaudeMessages`, strict no-recompute prompt); decision logging surfaced; exportable markdown Intelligence Report.

**Phase D outcome (built, gated):** feasibility harness confirms **prevention is infeasible** (only customer-tenure is leakage-safe at order time — below the 3-feature gate; risk retrospective, order-time fields unverified). The **response-win model IS feasible** for Blume Box (reason+phase+tenure eligible, 375 adjudicated, 3 chronological folds) and is **built** (L2 logistic + chronological backtest + calibration), stamped `P(win | historically contested & adjudicated)` with the selection-bias caveat. Category-specific calibration remains infeasible.

Each phase: run tests, review migrations, verify tenant isolation, show changed files, state unresolved limitations. Do not invent behavior to bypass data/architectural blockers.

---

## 13. Assumptions & blockers

- The **configured historical import completed successfully** and currently covers 2018-05-24 → 2026-07-21. This confirms completion of the *requested* import — **not** that all Shopify history was captured; earlier history is not proven absent. Data lives in **prod** (`aokhply`) — reads only, target confirmed each time.
- **Risk-feature leakage** is strongly indicated (~5.2-yr median ingest lag) but the definitive test is the *provenance* of `risk_level_initial`, not `first_ingested_at` alone (§14). Held retrospective-only/suppressed until proven.
- Absent §6.1 fields (AVS/CVV/3DS/margin/fee breakdown) and **refund/return/support chronology** (§5.4) → dependent analyses suppressed.
- Customer tenure is **left-censored** at the coverage boundary → `{returning, first_seen_in_observed_history, unknown}`; **never** label `new` without a proven full-history first-order/customer-creation date.
- Network reason codes 100% inferred for Blume Box → use coarse `reason`/family.
- Versions (`CATALOG_VERSION`, classification, feature-registry, methodology) pinned per run for reproducibility.
- No contradiction model and no arbitration stage exist — the engine will not claim either.

---

## 14. Open verification tasks (BLOCK modeling; must resolve before the feature registry or any model)

These are unresolved factual questions. Descriptive Phase-A/B work can proceed around them, but **no feature registry entry may be marked model-eligible, and no Phase-D model may be built, until the relevant item is answered.**

1. **True provenance of `risk_level_initial`.** Determine what timestamp it reflects: (a) a historically-preserved Shopify assessment time, (b) the state returned at backfill (2026), or (c) a later snapshot. Inspect `shopify_order_risk_assessments.assessed_at`/`snapshot_at` and the ingest path. If availability at the *original order-decision instant* cannot be proven, `risk_level_initial` stays `POST_OUTCOME_ONLY`.
2. **Refund chronology.** Confirm whether any timestamped refund event exists locally (vs only `financial_status`). If not, refund-timing (before/after dispute) analysis stays **suppressed**.
3. **Return chronology.** Same test for returns; suppress return-timeline analysis unless a timestamped source is confirmed.
4. **Support-interaction history.** Confirm Gorgias coverage window per shop; treat pre-connection history as Absent.
5. **Customer-history coverage boundary.** Compute `customer_history_coverage_start` and validate the `unknown`-tenure rule against real 2018–2019 orders.
6. **Delivery/signature timestamp availability vs response cutoff.** Verify that `delivered_at_tracking`/tracking `terminal_at` are populated with real event times (not ingest times) before using them as response-window features (relative to `scored_at`, not `due_at`).
7. **Analytical-layer isolation review.** Confirm `security_invoker = true` behavior, that the tenant-scoped DAL (§4.1) is the only access path, and that tests reject missing/wrong/cross-tenant `shopId`. Acknowledge that `.eq("shop_id",…)` under the service role is app-level, not DB-enforced; scope the **DB-enforced boundary required before any merchant exposure**.
8. **`available_at` provenance for optimistic fields.** For `payment_gateway`, carrier/shipping choice, raw `dispute.reason`, **normalized** reason, and `network_reason_code`: establish source-event time vs ingestion time vs classification-generation time. Each stays **descriptive-only** until its governing timestamp is proven `≤ cutoff`; none may be marked model-eligible before then.
9. **Full-history customer signal.** Determine whether a reliable Shopify customer-creation or first-order date covering the store's full lifetime is obtainable. Only then may tenure be labeled `new`; otherwise the three-state rule (§5.1) stands.
10. **Order-time field immutability.** For `order_total`, `currency`, `country`, `is_cross_border` (and similar presumed order-time fields): verify whether the persisted value is the **immutable original-order value** or a value captured during the later backfill (a mutable/later snapshot). `created_at_shopify` dates the order, not the field's preservation. Fields not proven immutable-at-order-time stay **descriptive-only for modeling**.
11. **Evidence underlying-event availability.** For each evidence type used in response analysis, establish the **underlying-event time** (not the `evidence_items` generation/ingestion time) and prove it `≤ scored_at` before any response-model use (§5.3).
12. **Provider response-opportunity predicate.** Pin the exact, provider-aware rule (from `raw_snapshot`) for "had a response opportunity" that defines the raw-response-rate denominator (§7.1), and unit-test it against real Shopify/provider payloads; count and disclose records where it cannot be established.
