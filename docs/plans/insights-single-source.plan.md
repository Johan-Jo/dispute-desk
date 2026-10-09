# Plan: One source for Insights / digest exposure metrics (final)

**Status: pending approval** (consensus: Critic APPROVE iteration 3; Architect v3 blockers B1–B3 folded in)
**Mode: DELIBERATE** (prod, merchant-facing compliance numbers, merchant email)
**Author:** Planner (ralplan final synthesis) · 2026-10-02
**Supersedes:** plan-v3. The v1 findings F1–F26 still stand and are not repeated. Where this file and an earlier version differ, this file wins.

**Binding user decisions:**
- Card-brand per-network ratios are in scope (PR5). They use the existing `shopify_order_risk_signals.card_brand`.
- The dashboard tile is unchanged.
- Digests re-enable automatically when the email-fix PR (PR4) merges, through a default-on kill switch.
- Onboarding email = latest stable month + 12-month trend.
- **Only open question:** Q-E (§9).

**Design dependency.** The user is commissioning a Claude Design redesign of the Insights page UI layout (PR3b) and the email template (PR4).
- PR3b and PR4 **transcribe that design literally** (CLAUDE.md rule 8).
- **No UI or template work starts before the design is delivered.** If the design is unreachable, stop and ask (memory: stop when design unavailable).
- PR0–PR3a and the server/data half of PR4 (migration, `digestSends`, cron, route) do not depend on the design and may proceed.
- The data and view-model contracts in this plan (§0, §2) are the design's **inputs**. If the design needs a field that §0 does not list, raise it before building. Do not invent the field in the UI.
- Where this plan names UI elements (lines, labels, selector), it names the **data that must be presentable**, not the layout.

**New prod facts gathered this round** (read-only; the guard printed `aokhplydttxtebvbeuzc` each time; SQL and output in `ralplan/sql/v3_*.{sql,txt}`):
- **Card brand is already ingested.** `shopify_order_risk_signals.card_brand` (migration 20260523111400) is written by both ingest paths: `backfillOrders.ts:46` `upsertSignalRows` and `orderIngest.ts:31` `upsertSignalRow`, from `CardPaymentDetails.company`.
  - Coverage on card-rail settled orders, Sep-2025 to Sep-2026: Blume 99.7%, MM 99.8%, cay 99.9%, surasvenne 100% (`v3_brand2.txt`).
  - Jun–Sep 2026: every card-rail settled order has a signal row (`v3_brand.txt`).
  - Consequence: PR5 needs **no order-level column and no Shopify re-pull** (see the changelog for why the user's "column + backfill" is met differently).
- **Q-E recipients** (`v3_qe.txt`): the 4 shops with `lastMonthlyDigestYyyyMm='2026-10'`:

  | Shop | Recipient |
  |---|---|
  | blume-box | ariel@blume.com |
  | 6a8848-dd (Mein Maison) | ecomm@hamzans.com |
  | cay-collective | thelma@caycollective.com |
  | surasvenne (your own store) | oi@johan.com.br |

- `scripts/run-migration.mjs:32-50,150,172`:
  - needs `--target=prod` **and** `APP_ENV=production`;
  - the filter is the first non-`--` argv, matched with `startsWith` against the **basename**, so pass a prefix, not a path.

---

## 0. Data contract for design

This section is written for the designer. Each field is built by `toInsightsViewModel` (§2.5) and formatted only by `format.ts`. Every field is an i18n token plus raw numbers; nothing reaches the UI as English or as a pre-formatted string.

**Conventions:**
- **Ratio:** stored rounded to 5 decimals (e.g. `0.00149`). Displayed as a percentage with 2 decimals (`0.15%`) in the viewer's locale.
- **Count:** an integer with locale digit grouping.
- **Month:** ISO `YYYY-MM-01`, displayed as "September 2026" in the viewer's locale.
- **Period** fields are fixed to a calendar month and to a record revision. They are correctable, and corrections are labelled.
- **Live** fields describe "now". They are never part of a month record.
- **`null`** always means "not measured" and is displayed as "—". It is never displayed as 0.

### 0.1 Page states (one per view)

| `periodState` | Meaning | Must show |
|---|---|---|
| `final` | Month row is stable (on or after the 8th of the next month, import complete) | the month, plus "updated `<revisedAt>`" |
| `provisional` | Month is closed but not yet final | the month, plus "provisional, final on `<finalOn>`" |
| `not_fully_imported` | The import started after this month began (`coverage='partial'`) | the month, plus "not fully imported"; no ratios |
| `not_available` | Closed month with no complete record | an explicit "not available for this month" line; **never** a blank page |
| `error` | Computing the programme block failed | an explicit "temporarily unavailable" line in the programme area. The rest of the page still renders. Never a whole-page failure banner and never a vanished card |
| `mtd` | Current month, live | "So far this month (to `<date>`)". Never emailed |

### 0.2 Header and revision fields

| Field | Meaning | Unit | Class | States |
|---|---|---|---|---|
| `periodMonth` | The month shown | month | period | — |
| `periodState` | See §0.1 | enum | period | 6 values |
| `revisedAt` | When this record was last revised | timestamp | period | — |
| `finalOn` | The date a provisional month becomes final (8th, 00:00 UTC) | date | period | only when `provisional` |
| `monthOptions[]` | Months the selector offers (`trendWindow`, §2.4) | month[] | period | each carries its own `periodState` |
| `revisedSinceEmail` | `{emailSentAt, changes:[{field, from, to}]}` | — | period | **absent** when no headline string differs between the email and the current record |
| `asEmailedOn` | Digest view only: the send date, with a "See current figures" link when the record is newer | date | period | only on `?digest=` |

### 0.3 Programme block (card-network exposure, one month)

| Field | Meaning | Unit/precision | Class | States |
|---|---|---|---|---|
| `cardFramingApplies` | Card networks dominate this month's disputes. When false, hide the VAMP/ECM checkpoint and pills and show N/A | bool | period (per month) | — |
| `headlineLabel` | Which headline is shown | enum `estimate` ("Card dispute ratio (estimate)") \| `network` ("Visa dispute ratio (VAMP, disputes only)"; from PR5, coverage ≥ 95%) | period | — |
| `cardDisputeRatio` | Card chargebacks / card settled orders created in the month | ratio, 5dp → % 2dp | period | `null` when fewer than 50 settled orders |
| `cardChargebackCount` / `cardSettledCount` | The numerator and denominator | count | period | — |
| `vampRatioCalculated` | The same ratio after DisputeDesk exclusions (secondary, labelled) | ratio | period | `null` as above |
| `visaChargebackCount` / `mcChargebackCount` | Network split | count | period | — |
| `visaDisputeRatio`, `visaSettledCount` | PR5 only | ratio / count | period | `null` before PR5 or below 50 |
| `ecmRatio` | MC chargebacks (M) / settled (M-1) | ratio | period | `ecmIsLowerBound=true` until PR5 (label "lower bound") |
| `mcSettledCount`, `brandCoverage` | PR5 only | count / ratio 4dp | period | — |
| `vampSeverity` / `ecmSeverity` | Severity of each programme | enum `healthy` \| `info` ("above the ratio, below the enforcement floor") \| `consider` \| `breach` | period | — |
| `vampFloorMet` / `ecmFloorMet` | Network enforcement floors met | bool | period | — |
| `unknownPaymentShare` | Share of orders with no payment method recorded | ratio → % 0dp | period | caveat shown only when > 20% |
| `unresolvedRailDisputeCount` | Disputes that could not be matched to an order | count | period | line shown only when > 0 |

### 0.4 Operational block (one month)

| Field | Meaning | Unit | Class | States |
|---|---|---|---|---|
| `threeDsShare` | Share of card orders with 3-D Secure | ratio → % | period | `null` |
| `signedForShare` | Share of orders with signature-on-delivery observable | ratio → % | period | `null` below n=30 or when unobservable ("—") |
| `protectShareByValue` | Shopify Protect coverage by order value | ratio → % | period | `null` |
| `winRate` | Disputes won / decided in the month | ratio → % 0dp | period | `null` when none were decided |

### 0.5 Checkpoints

`checkpoints[]` is the **full ordered list**: `{id, severity, titleToken, bodyToken, params (raw numbers, ISO months), sourceToken}`.
- The order is fixed by the server (`orderCheckpoints()`). The UI must not re-sort it.
- The page shows the first 5; the email shows the first 3.

### 0.6 Live state

| Field | Meaning | Unit | Label |
|---|---|---|---|
| `openActionable` | Disputes needing action now | count | page: "Right now"; email and digest view: "As of `<sentAt>`" |
| `awaitingBank` | Responses with the bank | count | same |
| `nearestDue` | `{dueAt, daysUntil}`. A negative `daysUntil` means overdue | date + days | same; `null` when none is due |

### 0.7 Trend (12 months)

`trend[]` = one entry per month of `trendWindow` (§2.4), oldest first: `{periodMonth, periodState, cardDisputeRatio, cardChargebackCount, cardSettledCount}`.
- A month with zero disputes is a real entry: count 0, and a ratio when the denominator is ≥ 50.
- Months before the shop's import or first order are omitted, not shown as 0.

### 0.9 Disputes by payment method (added 2026-10-02, user request)

Why: the card ratio only covers card payments. Mein Maison's disputes are ~97% PayPal (Jul 219 of 225), cay-collective's 100% Klarna, and blume-box's July fraud wave was 54 of 191 typed-in Mastercard orders (28%) while Shop Pay stayed at 0.15%. None of that is visible from one card figure.

`byPaymentMethod[]`, one row per method the shop used in the month, ordered by order count:

| Field | Meaning | Unit | States |
|---|---|---|---|
| `method` | `paypal`, `klarna`, `card`, `shopify_pay` (Shop Pay), `apple_pay`, `google_pay`, `shop_pay_installments`, `amazon_pay`, `tiktok_shop`, `gift_card`, `unknown` | token | `unknown` = no payment method recorded |
| `brand` | Visa / Mastercard / American Express / Discover for card-rail methods (from `shopify_order_risk_signals.card_brand`), else null | token | `null` |
| `orders` | Settled orders created in M with this method | count | — |
| `chargebacks` / `inquiries` | Disputes initiated in M on orders with this method | count | — |
| `chargebackRate` / `disputeRate` | chargebacks ÷ orders, (chargebacks + inquiries) ÷ orders | ratio 5 dp → % 2 dp | `null` below 50 orders |
| `isCardNetwork` | Counts toward Visa/Mastercard programmes | bool | — |

- Methods under 50 orders with no disputes are folded into one "Other" row.
- A dispute opened in M can be on an older order; the rows say "disputes opened this month ÷ orders placed this month" (same definition as the card ratio).
- Card verdicts apply whenever a shop has ≥ 50 card orders, independent of the dispute mix (shipped in #984).

### 0.8 Email-only fields

| Field | Monthly | Onboarding |
|---|---|---|
| `sentAt` | yes | yes |
| `isCorrection` + correction banner ("This replaces the email of 1 October…") | Q-E only | no |
| Programme + operational headline (as §0.3/§0.4) | yes | yes |
| Checkpoints `slice(0,3)` | yes | yes |
| Live state "As of" | yes | yes |
| 12-month trend values | no (the page link covers it) | **yes**, pinned per month via `trend_revisions` (PR4) |
| Link | `…/insights/initial-analysis?period=YYYY-MM&digest=<id>` | same |

The email is English (`en`). The digest view renders in the viewer's locale, with numbers from the same record.

---

## 0a. Changelog v3 → final (consensus amendments)

| # | Finding | Resolution | § |
|---|---|---|---|
| F1 | Arch B1: the log and the row hold different numeric representations | **Round once.** `computeProgrammeBlock` rounds every ratio to 5 dp (the `numeric(8,5)` scale) before building `p_values`, and severity is evaluated on the rounded value. `persist_shop_month` writes the row columns verbatim from `p_values` and **raises** if a ratio has more than 5 dp. Boundary-quotient parity test (0.0014446): row view == log view == email | §2.2, §2.6, §6 |
| F2 | Arch B2 / Critic NB2: PR1 and PR2 pick different months | One `statementMonth(now)` = **M-1 always** (UTC), labelled `provisional` until M+1 day 8, then `final`. It is used by PR1, PR2, §2.4 and the page default. The monthly email sends M-1 only once it is final. PR2 acceptance restated | §2.4, PR1, PR2, PR4 |
| F3 | Arch B3: self-heal and onboarding bounds differ | One `trendWindow(shop, now)` = `max(sinceMonth, firstOrderMonth, M-12)` .. M-1. Self-heal, onboarding readiness, the trend and the month selector all use it. Zero-dispute months are materialized. Test: a zero-dispute shop onboards within 4 nights | §2.4, PR2, PR4 |
| F4 | Arch S1: a throw blanks the page or silently hides LSI | Both routes catch the programme-block error only, log it, and return `status:'error'`. The page and LSI render an explicit "unavailable" state | PR1, PR2, §0.1 |
| F5 | Arch S2: first-insert race | Step 0: `pg_advisory_xact_lock(hashtextextended(p_shop_id::text \|\| p_period_month::text, 0))` | §2.6 |
| F6 | Arch S3 / Critic NB7: PUBLIC execute | `revoke execute … from public, anon, authenticated; grant execute … to service_role` on both functions. A5 checks PUBLIC | PR2, PR5, §7 |
| F7 | Arch S4 / Critic NB3: the digest fires once | Schedule `0 9 8-14 * *`, targeting M-1 only. Deduped by `unique(shop_id, kind, period_month)` | PR4 |
| F8 | Arch S5: `cardFramingApplies` uses 90 days | Computed per month inside `computeProgrammeBlock` and persisted (`card_framing_applies`) | §2.2, PR1, PR2 |
| F9 | Arch S6: PR5 wording | The acceptance names Blume as network-labelled; MM and cay stay N/A (FU-10) | PR5 |
| F10 | Arch synthesis + Critic NB5: drift noise | A drift revision is written only when a chargeback count changes or a headline value changes **at display precision** (`en` string). The drift `p_values` = the stored values with only the programme block replaced. "Revised since" renders only when at least one headline string differs (hidden when empty) | §2.6, PR2, PR4 |
| F11 | Arch N-c: second checkpoint sort | PR3b deletes the `OperationalCheckpoints.tsx` re-sort. I3 forbids `.sort(` over checkpoints outside `orderCheckpoints` | PR3b, §6 |
| F12 | Critic NB1: onboarding trend values | The onboarding email **shows** the trend. `insights_digest_sends.trend_revisions jsonb` (month → revision). The trend is built from the log. Parity case 6(d) | PR4, §6 |
| F13 | Critic NB4: floor-rule contradiction | The ECM count-floor override (≥100 MC CBs → at least `consider`) applies **only while the ECM denominator is the all-card lower bound** (before PR5). Otherwise, below the threshold is always `healthy` | §2.2 |
| F14 | Critic NB6: Q-E canary | surasvenne first; read the received email against the page; then the 3 merchants | §9 |
| F15 | Critic NB8: aborted transaction in the SQL test | The invalid-coverage case runs in a `DO` block with an exception handler, then asserts the row and log are unchanged | PR2 |
| F16 | Critic NB9: late "welcome" email | The sweep is bounded to `historical_import_completed_at >= now() - interval '60 days'` | PR4 |
| F17 | Critic NB10: placeholder filename | PR5 = `20261012100000_insights_network_denominators.sql`, with full commands | PR5 |
| F18 | Arch §1.5 gap | PR3a: run the recompute immediately after the deploy. `not_available` is expected in the gap, and the cron does not heal it | PR3a |
| F19 | Arch §1.1 nits | A-B1 also reports chargeback-side brand coverage. I4 claims "brand map defined once", not "one transaction pick" | PR5, §6 |

---

## 0b. Changelog v2 → v3

| # | Finding | Resolution | § |
|---|---|---|---|
| 1 | Arch N1 / Critic N1 (blocker): stability rule never marks a post-import month stable | Rule: `status='complete' AND completed_at IS NOT NULL AND (since_date IS NULL OR since_date ≤ monthStart) AND now ≥ M+1 day 8`. Prod-shaped test (Blume: completed 2026-07-21, month 2026-09, now 2026-10-08 → true) plus all 4 shops' real dates. PR2 acceptance: Blume 2026-09 `stable_at IS NOT NULL` after 2026-10-08 02:00 UTC | §2.3, PR2 |
| 2 | Critic N2: prod migration command refused | `APP_ENV=production node scripts/run-migration.mjs --target=prod <basename-prefix>`, verified against the script. Schema verified after every apply (memory: positional-filter incident) | PR2, PR4, PR5 |
| 3 | Arch N3b/c / Critic N3: rev-0 collision, non-atomic write, wrong `metrics_version` default | **Log-on-write model:** the log stores every state, including the current one, so the row's `revision` always has a log row and there is nothing "prior" to insert. One SQL function `persist_shop_month(...)` does lock → hash compare → log insert → row upsert in one transaction. Migration: existing rows `revision=0` = logged rev 0 `pre_v2_backup`. `metrics_version default 1` (true for pre-v2 rows); the function always writes it explicitly. Failure-atomicity test runs against dev | §2.6, PR2 |
| 4 | Arch N2: checkpoint values are lib-formatted strings | Persisted checkpoints are `{id, severity, titleToken, bodyToken, params:{raw numbers, ISO month}, sourceToken}`. `format.ts` is the only formatter. I5 extended: no `pct(`, `toFixed(` or `%`-template building in `lib/insights/**`. `source.label` becomes `sourceToken` (Arch N10) | PR3a, §6 |
| 5 | Arch N3a: email top-3 vs page top-5 | The view-model holds the **full ordered list**, ordered by `orderCheckpoints()` (one function). Page shows `slice(0,5)`, email `slice(0,3)`. Parity asserts the email ids equal `vm.checkpoints.slice(0,3)` in order, and every headline string is present | §2.5, §6 |
| 6 | Critic m1: byte-equal is false outside English | Parity is defined in two tiers. **Structural** (all 6 locales): token keys, raw numbers, severities and order deep-equal. **Byte-equal** strings in `en` only (the email locale). The digest view renders in the viewer's locale, with numbers from the same record | §2.5 |
| 7 | Arch synthesis / V4: stored view-model needs versioning | Adopted: the send row stores a **pointer** (`snapshot_revision`) + `live_state` + `headline` (raw numbers + resolved `en` strings). No view-model is stored, so no `view_model_version` is needed. CI guard: re-rendering the pointer in `en` must reproduce the stored `headline` | §2.5, PR4 |
| 8 | Arch N4 / V2: two severity tables in PR1 | `programmeThresholds.ts` moves **into PR1**. `thresholds.ts` re-exports it, `/api/ratios/current` bands come from it, and I4 lands in PR1 | PR1 |
| 9 | Arch N5 + Critic N4: PR1 definition ≠ PR2 (inquiries, after-exclusions); PR2→PR3a two-VAMP window | PR1 lands the **pure `computeProgrammeBlock`** (chargebacks only, inquiries excluded, gross, card-rail). Both the initial-analysis route and `/api/ratios/current` call it live for the last complete month. PR2 persists the same function's output and switches **both** routes to the row together. No definition change across PRs and no window. Acceptance: PR2 value == PR1 value for Blume Sep (or a logged revision) | PR1, PR2 |
| 10 | Arch N5 floor wording | Floor rule stated once: a met threshold below the enforcement floor downgrades `consider`/`breach` to `info`. Below the threshold is always `healthy` | §2.2 |
| 11 | Arch N7: digest callers omitted from PR1 | `sendMonthlyChargebackDigest.ts:264` and `sendOnboardingAnalysisDigest.ts:105` are in the PR1 file list. They pass `programme: undefined`, the rule returns null, and no VAMP line is emitted (both are suspended anyway) | PR1 |
| 12 | Arch V1: `calculate.ts:80-87` swallows count errors as 0; `winRate` returns 0 on empty | `computeProgrammeBlock` / `computeShopMonth` **throw** on any `error`. A test injects an error and asserts that it throws and nothing is persisted. `computeWinRate` → `null` when the denominator is 0 (insights layer; dashboard unchanged). The Blume Oct row with `settled_count=0` is the observed instance | PR1, PR2, PR3a |
| 13 | Arch N6: PR3b needs a PR4 table | "Revised since the email of <date>" moves to **PR4**. PR3b shows only "updated <revised_at>" | PR3b, PR4 |
| 14 | Arch N8: materialize job budget | **Job deleted.** The calculate-ratios cron self-heals missing closed months (cap 3/shop/run). No worker case is needed (Critic m4 is moot; stated so the executor doesn't add one) **Reversed 2026-10-09** by `insights-first-day-gaps.plan.md`: a new shop's page was empty until the cron had run four nights, so the job exists again (`materialize_insights_months`) and the cap of 3 is gone | PR2 |
| 15 | Arch N9: unknown-method range not credible (0/585 CBs on NULL-method orders) | **Cut.** Headline = card CBs / card settled. A caveat line "N% of orders have no payment method recorded" shows when the share is >20%. Severity keys off the headline. `card_dispute_ratio_low`, the straddle state, 2 tokens and 1 fixture are dropped. One-hour probe added to FU-7 | §2.2, PR3b |
| 16 | Arch N10: I3 matches its own definition | I3 exempts `lib/insights/checkpoints.ts` and `lib/insights/__tests__/checkpoints.test.ts` | §6 |
| 17 | Critic N5 / user YES: card-brand ingest | **PR5**, fully specified. Brand source = the existing `shopify_order_risk_signals.card_brand`, normalised by the existing `CARD_COMPANY_TO_NETWORK` (`enrichNetworkReasonCode.ts:27`, exported as `normalizeCardBrand`; the same map `paymentContext.ts:247` uses via `deriveCardNetwork`). **Rejected: a new `shopify_orders.card_brand` column**, which would be a second copy of an already-ingested field (Principle 1). The migration is on `ratio_snapshots` (per-network counts). The "backfill" is the canaried recompute through revisions, plus a bounded gap-fill **only if** coverage is <95% | PR5 |
| 18 | Critic N6 / user: auto re-enable, no Vercel step | PR0: `insightsDigestsEnabled()` returns `false` **in code** (no env). PR4: returns `process.env.INSIGHTS_DIGESTS_DISABLED !== "true"`, so the default is on and the env is only an emergency kill switch. The side-by-side sign-off is a **precondition of PR4's master go**. I9 keeps the gate wired | PR0, PR4, §4 |
| 19 | Critic N7 / user: onboarding = latest stable month + 12-month trend | Onboarding readiness is checked **daily by the calculate-ratios cron**. It sends when the latest stable month exists and the trend months in import coverage are materialized. The `backfillOrders.ts:344` trigger is removed. This also sweeps shops whose import completed during suspension (`onboarding_digest_sent_at IS NULL`, because PR0 gates before the claim). Tests cover both | PR4 |
| 20 | Critic m2: date-dependent acceptance | Pinned: "on or after 2026-10-08 02:00 UTC" | PR2, PR3b |
| 21 | Critic m3: alert dedup | `insights_ops_alerts` unique `(shop_id, alert_key, period_month)`, insert-on-conflict-do-nothing, email only on insert. Arch V3 adopted: only alert (b) (M-1 not stable on day ≥9) is kept; (a) is dropped | PR2 |
| 22 | Critic m5: help in PR1/PR2 | `lib/help/embedded.ts` article `vamp-ratio-explained` + `help.embedded.*` updated in PR1 (last full month, chargebacks only), PR2 (revisions, stable on the 8th), PR3b, PR4 and PR5 | each PR |
| 23 | Critic m6 / CLAUDE.md #10: in-chat go for recomputes | Removed. Recompute = dry-run canary (Blume) → read the diff against A0 → proceed with the other 3 → report. An in-chat go is needed **only** for master merges and the PR4 side-by-side | §3 |
| 24 | Critic m7: rollback state | `--restore-revision 0` is documented as leaving the v2 columns NULL. A1/"no NULL with settled ≥50" are expected to fail in that state | PR2 |
| 25 | Critic m8 | Revision + drift machinery kept, limited to the programme block | PR2 |
| 26 | Q-E | Kept as the single open question, with a recommended default and exact recipients | §9 |
| 27 | Arch §1 L80-95: un-ranged disputes select | `computeProgrammeBlock` paginates disputes with `.range` (I2) | PR1 |
| 28 | Existing current-month rows (Blume Oct row) | Ignored by every reader (`period_month < date_trunc('month', now())`). From PR2 on, the cron never writes the in-progress month (MTD is never persisted). The stale Oct row is overwritten through the function when October closes | PR2 |

---

## 1. RALPLAN-DR summary

### Principles
1. **One number, one definition, one writer.** `lib/insights/period/` computes. `persist_shop_month` is the only writer. Every surface renders one `InsightsViewModel` through `format.ts`.
2. **The email is a dated statement; the page can reproduce it.** Same record revision, same numbers. A later correction is labelled, never silent.
3. **The record stays correctable.** Every state is a logged revision with a reason.
4. **Calendar months for programme ratios.** Rolling windows are for operations only.
5. **Absent ≠ zero ≠ breach.** Query errors throw. Empty denominators give null. Below-floor gives `info`.

### Decision drivers
1. Email == page for the linked statement (the user's hard requirement).
2. Programme-faithful numbers: per-network once brand coverage allows (user: PR5).
3. Bounded prod blast radius: suspend first, canary recompute, per-PR master go.

### Options

| | **A′ (chosen): correctable month row + revision log + send pointer** | A: hard freeze on day 8 | B: live shared compute only |
|---|---|---|---|
| Click-through parity | Same revision + stored live state + stored headline | Period fields only; live state differs | None (drift between send and click) |
| Correctability | Any month, logged | `--force` only, which breaks sent emails | Always current |
| Cost | 3 small tables, 1 SQL function, view-model | Freeze + late-note path | Recompute every view |
| Risk | Revision noise (mitigated: drift revises only on a chargeback-count or display-precision change) | Biased history frozen | Requirement unmet |

- **Why A′:** it meets driver 1 strictly. Live state is stored, and numbers come from a pinned revision. It also lets the NULL-payment_method repair and late disputes correct history.
- **B as a layer, not an alternative:** B is A′'s compute layer, and PR1 ships it as a live stopgap.
- **Rejected as overbuilt (Arch §3):** a stored rendered view-model, the unknown-method range, and a 24-month materialize job.

---

## 2. Data contract

### 2.1 Period vs live

| Class | Fields | Stored | Default view | Digest view (`?digest=`) | Email |
|---|---|---|---|---|---|
| Period (correctable) | programme block (§2.2, incl. `card_framing_applies`), operational block, win rate (decided in M), checkpoints + `thresholds_version` | `ratio_snapshots` (rev N) + log | "September 2026 · updated <revised_at>" (or "provisional, final on <date>"). From PR4: "Revised since the email of <date>: X → Y", only when at least one headline string differs between the send revision and the row | revision `snapshot_revision` from the log; header "As emailed on <date>"; revised line + "See current figures" if a headline string differs | "September 2026"; onboarding also shows the 12-month trend, pinned per month by `trend_revisions` |
| Live | open actionable, awaiting bank, nearest action due | never on the row; `insights_digest_sends.live_state` | "Right now" | "As of <sent_at>" | "As of <date>" |
| MTD | period set for the current month | never persisted or emailed | "So far this month (to <date>)" | — | — |

### 2.2 Headline definitions: `lib/insights/programmeThresholds.ts` (PR1), `THRESHOLDS_VERSION='2026-10-a'`
- `card_dispute_ratio` = card-rail chargebacks / card-rail settled orders created in M.
  - Numerator: `phase='chargeback'` only, inquiries excluded, initiated in M, order resolves to `CARD_RAIL_METHODS`, gross (no DD exclusions).
  - Denominator: `PAID|PARTIALLY_REFUNDED`.
  - `null` when the denominator is < 50.
  - **Rounding (one representation):** every stored ratio is rounded **once**, in `computeProgrammeBlock`, to 5 dp (`roundRatio`, matching `numeric(8,5)`). Severity, `p_values`, the row columns, the log, the email and the page all use that rounded value. `format.ts` only converts it to a percentage with 2 dp. No surface recomputes a ratio from counts.
- `card_framing_applies` = the card-network dispute share **in M** ≥ 0.5 (the `railSegmentation` rule applied to M's disputes, not to the route's 90-day window). It is persisted per month and drives the checkpoint, the LSI pills and the email.
- `vamp_ratio_calculated` = the same numerator after DD CE3.0/FPT exclusions. It is a labelled secondary.
- Visa/MC chargeback counts: by `network_reason_code` (`^1[0-3]\.` / `48%`) until PR5. From PR5, by order brand (reason code as fallback when the brand is NULL).
- ECM: MC chargebacks in M / card settled in M-1. Labelled "lower bound (all-card denominator)" until PR5, then the true MC denominator (M-1 MC settled).
- **Severity:**
  - VAMP early warning 0.9%, excessive 1.5%;
  - ECM 1.5% + 100 chargebacks;
  - below the threshold → `healthy`;
  - at or above the threshold, floor not met (`visa_chargeback_count < 1500` / `mc_chargeback_count < 100`) → `info` "above the ratio, below the enforcement floor";
  - floor met → `consider`/`breach` by ratio;
  - **one exception (until PR5 only):** while the ECM denominator is the all-card lower bound, ECM count floor met (≥100 MC chargebacks) → at least `consider` whatever the ratio, because the lower bound understates the true ratio. PR5 removes the exception when the true MC denominator lands. Outside this exception, below the threshold is always `healthy`.
- Caveat (not a severity input): `unknown_settled / (card + unknown settled) > 0.20` → "N% of orders have no payment method recorded".
- `thresholds.ts` re-exports this table. Its 0.65%/1.00% values are deleted (FU-1 rechecks against the primary source).

### 2.3 Stability rule: `lib/insights/period/canMarkStable.ts`
```
canMarkStable(shop, month, now) =
     now >= Date.UTC(y, m+1, 8)                                 // M+1 day 8, 00:00 UTC
  && shop.historical_import_status === 'complete'
  && shop.historical_import_completed_at != null
  && (shop.historical_import_since_date == null || since_date <= monthStart(month))
```
- Months before completion are covered by the backfill. Months after are covered by live ingest, so the completion date does not bound stability.
- `since_date > monthStart` → `coverage='partial'`, never stable, rendered "not fully imported".
- `stable_at` means eligible for email and the default view. It does not mean immutable.

### 2.4 Month selection: `lib/insights/period/months.ts` (PR1), one module
```
statementMonth(now) = first day of (UTC month of now) − 1 month          // M-1, always
periodState(row, now) = coverage='partial' → 'not_fully_imported'
                       | row.stable_at != null → 'final'
                       | else → 'provisional' (finalOn = canMarkStable date, M+1 day 8)
trendWindow(shop, now) = months from max(sinceMonth, firstOrderMonth, statementMonth(now) − 11)
                         to statementMonth(now)                           // ≤ 12 months
```
- `sinceMonth` = month of `historical_import_since_date` (NULL → no bound). `firstOrderMonth` = month of the shop's earliest `shopify_orders.created_at`.
- **Users:**
  - PR1 live compute;
  - the PR2 routes (`programmeMonth`, `/api/ratios/current`, LSI);
  - the page default view;
  - the monthly digest target (M-1, sent only once `final`);
  - cron self-heal;
  - onboarding readiness;
  - the 12-month trend;
  - the month selector.

  No other "current month" or "trend range" computation is allowed (I4 extension).
- **Page default = `statementMonth(now)`.** On days 1–7 it is shown as `provisional`, which keeps the corrected September visible today. From the 8th it is `final`.
- `not_fully_imported` (the import started mid-month) → that state, plus "Your first full-month report: <date>".
- Import incomplete → the existing gate.
- An invalid or foreign `digest=` is ignored (shop-scoped lookup).
- **Onboarding** keeps the user decision "latest stable month". On days 1–7 that is M-2 while the page default shows M-1 provisional. The email link pins `?period=<M-2>&digest=`, so parity holds.

### 2.5 Parity contract (what "email == page" means, testably)
1. **Record:** the email and the digest view read the same `(shop, period, snapshot_revision)` state from `ratio_snapshot_revisions`.
   - The onboarding email's trend reads each month at `trend_revisions[month]`.
   - The default view reads the row. When `row.revision > send.snapshot_revision`, it re-renders both in `en` and lists only the headline fields whose strings differ. An empty list → no line.
   - Because ratios are rounded once (§2.2), the row columns and the log `values` of the same revision are numerically identical. The boundary-quotient test proves it.
2. **Structural (all locales):** `toInsightsViewModel` output is deep-equal for email and page: token keys, raw numbers, severities, and checkpoint order (`orderCheckpoints()`). The email renders `checkpoints.slice(0,3)`, the page `slice(0,5)`, so the email ids == `vm.checkpoints.slice(0,3).map(c=>c.id)`.
3. **Byte-equal (`en`):** with `en` messages, every headline string (programme ratio, ECM, win rate, open, awaiting bank, nearest due) and every string of the first 3 checkpoints appears verbatim in the email HTML and in the route-rendered `en` strings.
   - For the other 5 locales, the format test asserts that the same raw numbers are rendered (parsed back) and no key is missing.
4. **Copy-drift guard:** the send row's `headline` (resolved `en` strings + raw numbers) must equal a re-render of `snapshot_revision` in `en`.
   - CI fails if a `format.ts`/copy change would alter an emailed number.
   - At runtime, the digest view renders the stored `headline` strings for headline fields when the viewer is `en`, so old links never show a different number.

### 2.6 Revision model: one SQL function
`persist_shop_month(p_shop_id uuid, p_period_month date, p_values jsonb, p_reason text, p_metrics_version smallint, p_thresholds_version text, p_mark_stable boolean) returns table(revision int, changed boolean)`.
- It is `security invoker`.
- Grants: `revoke execute … from public, anon, authenticated; grant execute … to service_role` (precedent: `20260502120000_shop_reconcile_schedule.sql:56-57`).

In one transaction:
0. `perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || p_period_month::text, 0))`. This serializes concurrent first inserts (cron vs recompute script), where `for update` has no row to lock.
0b. For each ratio key in `p_values`: `if (v)::numeric(8,5) <> (v)::numeric then raise` (the value is not pre-rounded, a B1 guard).
1. `select … for update` the row.
2. `h := md5(p_values::text)` (jsonb text is canonical). If the row exists and `row.values_hash = h`, set only `stable_at` when `p_mark_stable and stable_at is null`, and return `changed=false`.
3. `new_rev := coalesce(row.revision, 0) + 1` (a new row starts at 1).
4. Insert into the log `(shop, month, new_rev, p_values, p_reason, versions)`.
5. Upsert the row with every column written **verbatim** from `p_values` (no recomputation, no re-rounding), with `revision=new_rev, values_hash=h, revised_at=now(), revision_reason=p_reason, metrics_version, thresholds_version`. `stable_at` stays, or is set if `p_mark_stable`.

Any exception rolls back both writes. The invariant is that every row's current `revision` has a log row with the same hash (acceptance A4).

**Drift materiality (TS, before calling the function):** `lib/insights/period/driftIsMaterial.ts`.
- On the cron drift path (PR2 step 3), `p_values` = the **stored** values with only the programme block replaced by the recomputed one.
- `persistShopMonth` is called only when one of these holds:
  - (i) any chargeback count differs (card, Visa, MC, unknown-network);
  - (ii) any headline value differs **at display precision** (the `en` string from `format.ts`).
- Denominator-only churn below display precision (e.g. late refunds moving `settled_count`) writes nothing.
- Deliberate recomputes through the script are not filtered. They persist on any hash change, with their `--reason`.

---

## 3. Phased PRs

| PR | Scope | Migration | Design-gated | Master go needs |
|---|---|---|---|---|
| PR0 | Suspend both digests (code constant) | — | no | in-chat go (today) |
| PR1 | Live `computeProgrammeBlock(statementMonth)`, one threshold table, `months.ts`, route error states | — | no | in-chat go |
| PR2 | Month rows, `persist_shop_month` (lock, 5-dp guard), revision log, cron self-heal over `trendWindow`, material drift | `20261003100000_insights_period_rows.sql` | no | prod migration verified (A4, A5) + in-chat go |
| PR3a | Operational block, read path, persisted checkpoints, view-model, `format.ts`, fakePostgrest | — | no | in-chat go; recompute right after deploy |
| PR3b | Page UI from the view-model | — | **yes** (Insights page design) | design comparison + in-chat go |
| PR4 | Digests from the record, send pointer + `trend_revisions`, day 8–14 cron, onboarding readiness, auto re-enable | `20261005100000_insights_digest_sends.sql` | **template only** (email design) | §4 preconditions; the side-by-side yes is the go |
| PR5 | Per-network denominators from `card_brand` | `20261012100000_insights_network_denominators.sql` | no | prod migration verified + in-chat go |

**Per PR:** branch → PR to `develop` (auto-merge OK) → dev verify → PR to `master` → **STOP for the in-chat go for that PR** → merge (no `--admin`, no auto-merge).

**Gates:** `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`. technical.md and help are updated in the same commit, and i18n keys in all 6 locales (`verify-i18n-parity.mjs`).

**Recompute / backfill (CLAUDE.md #10):**
1. Dry-run Blume and read the diff against A0.
2. Apply Blume, then run A1/A4.
3. Proceed with MM, cay and surasvenne without asking.
4. Report.

A mismatch stops the batch and is fixed as a class.

### PR0: Suspend both insight digests (master, today)
- `lib/email/insightsDigestGate.ts`: `insightsDigestsEnabled()` returns **`false`** (code constant, comment "re-enabled by PR4"; no env, so no Vercel step).
- It is called:
  - at the top of `sendMonthlyChargebackDigest` and `sendOnboardingAnalysisDigest`, returning `{sent:false, reason:"suspended"}`;
  - at the top of `triggerOnboardingDigest`, before any query or the `onboarding_digest_sent_at` claim;
  - in `app/api/cron/monthly-digest/route.ts` after `cronEnvGate`, returning `200 {suspended:true, sent:0}` plus one log line.
- **Tests** (`insightsDigestGate.test.ts`):
  - cron: suspended, `sb.from` not called;
  - trigger: no claim UPDATE;
  - both senders: the Resend mock is not called.
- **Acceptance:** the prod curl with the cron secret returns `{"suspended":true,"sent":0}`. `q9` re-run: markers unchanged (`2026-10`) and `onboarding_digest_sent_at` unchanged for the 4 shops.
- **Rollback:** revert.

### PR1: Page stopgap, one live programme number, one threshold table (master)
- **New** `lib/insights/programmeThresholds.ts` (§2.2). `lib/liabilityShift/ratios/thresholds.ts` re-exports it, and `checkpoints.ts:53-60` imports from it.
- **New** `lib/insights/period/computeProgrammeBlock.ts(sb, shopId, monthIso)`:
  - pure, read-only;
  - head counts for card settled in M and M-1, plus unknown settled;
  - disputes `phase='chargeback'`, `initiated_at` in M, `.range`-paginated;
  - order rail via ≤200-id in-list chunks;
  - returns raw counts + `card_dispute_ratio` (null <50), `vamp_ratio_calculated`, Visa/MC counts, ECM lower bound, floors and `card_framing_applies` (computed for M, §2.2);
  - every ratio is rounded once via `roundRatio` (5 dp) before it is returned (§2.2);
  - **throws on any `error`**.
- **New** `lib/insights/period/months.ts`: `statementMonth`, `periodState`, `trendWindow` (§2.4). PR1 uses `statementMonth` and the provisional/final label (from `canMarkStable`'s date rule, without the persistence-side checks).
- **Route** `app/api/dashboard/insights/initial-analysis/route.ts`:
  - replace the inline rail block L569-599 with `railSegmentationFor(...)`. The 90-day share is kept only for the operational rail-share text. Pills, the checkpoint and the email use `programmeMonth.cardFramingApplies`;
  - add `programmeMonth = computeProgrammeBlock(statementMonth(now))`, with `periodState` `provisional` (finalOn) or `final`;
  - **wrap only the programme call in try/catch**: log the error and return `programmeMonth: {status:'error'}`. The rest of the response is unaffected. The VAMP/ECM checkpoint is omitted, and the page shows `fraudIntel.programmeUnavailable` (never the whole-page `failedTitle` banner).
- **`/api/ratios/current`:**
  - headline from `computeProgrammeBlock(statementMonth(now))`, bands from `programmeThresholds`;
  - NULL passes through (delete `Number(x ?? 0)` at L53-66);
  - a throw → `200 {snapshot:null, status:'error'}`, and LSI renders `liabilityShift.notMeasured` (never null or a vanished card, `LiabilityShiftImpact.tsx:82-100`).
- **`/api/ratios/trend`:** NULL passes through (L44-47). It has no UI consumer (grep).
- **`checkpoints.ts`:**
  - VAMP/ECM rules take `programme?: {ratio, visaCount, mcCount, ecmRatio, periodMonth}`, and return null when it is undefined;
  - floor and severity per §2.2;
  - the `cardDisputes/3` ECM input is removed.
- **Callers:**
  - `page.tsx:975` passes `programmeMonth` (the client eval stays until PR3a);
  - `sendMonthlyChargebackDigest.ts:264` and `sendOnboardingAnalysisDigest.ts:105` pass `programme: undefined`.
- **`LiabilityShiftImpact.tsx`:**
  - `ratio: number | null`;
  - the `cardFramingApplies` prop (from the per-month programme block) hides the VAMP/ECM pills;
  - headline == `programmeMonth.cardDisputeRatio`, because both come from the same function, month and thresholds.
- **i18n (6 locales):** `fraudIntel.checkpoint_programme_period`, `…_vamp_below_floor_title|body`, `…_ecm_below_floor_title|body`, `fraudIntel.programmeProvisional` ("provisional, final on {date}"), `fraudIntel.programmeUnavailable`, `liabilityShift.notMeasured`.
- **Help:** `vamp-ratio-explained` says "last full calendar month, chargebacks only, inquiries excluded; provisional until the 8th".
- **Tests:**
  - `computeProgrammeBlock.test.ts`: inquiries excluded; <50 → null; error → throws; >1000 disputes paginated; ratios returned at 5 dp (0.0014446 → 0.00144); `card_framing_applies` from M's disputes only (a 90-day-only card wave does not flip it);
  - `months.test.ts`: `statementMonth` on 2026-10-02 = 2026-09 and on 2026-01-03 = 2025-12; `trendWindow` bounds (since_date, first order, 12 months);
  - route tests (both routes): an injected programme error → `status:'error'`, 200, the rest of the payload intact;
  - `checkpoints.test.ts`: below threshold → healthy; above + below floor → info; 120 MC CBs → ≥consider; `programme` undefined → no VAMP checkpoint;
  - `tests/api/ratios/current.test.ts`: current month excluded, NULL kept, band from `programmeThresholds`;
  - route test: the filter column is `initiated_at`;
  - I4 lands.
- **Acceptance (prod, same hour as A-PR1):**
  - Blume route `programmeMonth.periodMonth="2026-09-01"`, with `cardDisputeRatio` == A-PR1 (orientation 4/2686 = 0.00149); `periodState='provisional'` before 2026-10-08, `final` after;
  - VAMP checkpoint "September 2026: 0.15%", healthy;
  - LSI headline 0.15%, healthy pill;
  - ECM count 2, healthy;
  - MM, cay: N/A, pills hidden. surasvenne: "—".
- **Rollback:** revert (read-only).

### PR2: Correctable month rows, single writer, revision log
- **Code:**
  - `lib/insights/period/computeShopMonth.ts` = `computeProgrammeBlock` (+ operational/win rate from PR3a). Pure, and throws on any error.
  - `lib/insights/period/persistShopMonth.ts` is the only TS caller of `rpc('persist_shop_month')`. It computes `p_mark_stable` from `canMarkStable`.
  - `calculate.ts` is reduced to a re-export, or deleted with callers moved.
  - Both routes (`initial-analysis` `programmeMonth`, `/api/ratios/current`) switch from live compute to **the `statementMonth(now)` row** (§2.4), in the same PR. This is the same month PR1 shows, labelled by `periodState` (`provisional` until the row is stable, then `final`). If the M-1 row is missing, they fall back to live `computeProgrammeBlock(statementMonth)` labelled `provisional`. The S1 error handling from PR1 is kept on both paths.
  - The legacy columns are written with §2.2 semantics. `mc_settled_count` is kept and set to 0 until PR5 gives it real meaning.
- **Cron** `calculate-ratios` (keeps `cronEnvGate`). Per active, import-complete shop:
  1. M-1: recompute; mark stable when the rule allows.
  2. Missing or non-stable closed months **in `trendWindow(shop, now)`** (§2.4), oldest first, **cap 3/shop/run** (self-heal; replaces the materialize job). Zero-dispute months are materialized (counts 0, ratio from the denominators). A 12-month window fills in ≤4 nights. This is the same window onboarding readiness uses (PR4).
  3. Drift check on stable months ≤3 old: the programme block is recomputed, and `persistShopMonth` (reason `late_data`) is called only if `driftIsMaterial` (§2.6).
  4. `programmeAlert`: if day ≥9 and M-1 is not stable for an import-complete shop → `insights_ops_alerts` insert-on-conflict (`alert_key='m1_not_stable'`). Email support@disputedesk.app only if a row was inserted.

  The in-progress month is never written. Output: `{shop, recomputed, revised, markedStable, skipped}`.
- **Delete** `scripts/backfill-ratio-snapshots.mjs`.
- **New** `scripts/recompute-insights-months.ts`:
  - `--env-file .env.production.local --expect-ref aokhplydttxtebvbeuzc --shop <domain> [--from] [--to] --reason <text> [--dry-run] [--restore-revision <n>]`;
  - prints a per-month diff;
  - refuses on a ref mismatch;
  - writes only via `persistShopMonth`.
- **Migration** `supabase/migrations/20261003100000_insights_period_rows.sql` (additive):
  - `ratio_snapshots` adds:
    - counts: `card_chargeback_count`, `visa_chargeback_count`, `mc_chargeback_count`, `unknown_network_chargeback_count`, `unresolved_rail_dispute_count`, `unknown_settled_count`, `ecm_denominator_count` (int);
    - `card_dispute_ratio numeric(8,5)`;
    - floors, framing and coverage: `vamp_floor_met`, `ecm_floor_met`, `card_framing_applies` (bool), `coverage text check in ('full','partial')`;
    - stability and revisions: `stable_at`, `revised_at` (timestamptz), `revision int not null default 0`, `revision_reason text`;
    - versioning and payload: `metrics_version smallint not null default 1`, `thresholds_version text`, `operational_metrics jsonb`, `checkpoints jsonb`, `values_hash text`.
  - `ratio_snapshot_revisions(id bigserial pk, shop_id uuid not null references shops on delete cascade, period_month date not null, revision int not null, values jsonb not null, values_hash text not null, reason text not null, metrics_version smallint not null, thresholds_version text, created_at timestamptz default now(), unique(shop_id, period_month, revision))`.
  - Backfill rev 0 and backfill hashes in the same migration:
    - `insert … select shop_id, period_month, 0, to_jsonb(r), md5(to_jsonb(r)::text), 'pre_v2_backup', 1, null from ratio_snapshots r;`
    - then `update ratio_snapshots r set values_hash = v.values_hash from ratio_snapshot_revisions v where v.shop_id=r.shop_id and v.period_month=r.period_month and v.revision=0`. Insert first, while `values_hash` is still NULL, so the two hashes are identical and A4 holds. The v2 payload hashes differently, so the first recompute always logs rev 1.
  - `insights_ops_alerts(id uuid pk, shop_id uuid not null references shops on delete cascade, alert_key text not null, period_month date not null, created_at timestamptz default now(), unique(shop_id, alert_key, period_month))`.
  - `create function persist_shop_month(...)` per §2.6 (advisory lock, 5-dp guard, verbatim write); `revoke execute on function persist_shop_month(...) from public, anon, authenticated; grant execute … to service_role`.
  - RLS enabled with no policies, and `public`/anon/authenticated revoked on both new tables.
- **Apply order:**
  1. `npm run db:migrate:dev` in the creating session; verify columns and the function.
  2. Run `scripts/sql/test_persist_shop_month.sql` on dev with `npm run db:query:dev -- --file scripts/sql/test_persist_shop_month.sql --output table`. Every case runs inside a `DO` block, because the Management API may not keep a multi-statement `begin … rollback`. The test records its output in the PR and checks five cases:
     - an invalid `coverage` raises inside a `begin … exception when others then … end` sub-block, then asserts that neither the row nor the log changed;
     - a ratio with 6 dp raises (B1 guard);
     - an equal hash gives `changed=false` and no log row;
     - a changed hash gives `rev+1` and a log row;
     - `pg_advisory_xact_lock` is present in the function body (`pg_get_functiondef`). The concurrent first-insert race is covered by this inspection, not by two sessions.

     The test rows are deleted at the end of the DO block, on a dedicated test shop row.
  3. **Before the master merge:** `APP_ENV=production node scripts/run-migration.mjs --target=prod 20261003100000`.
  4. Verify on prod with `npm run db:query:prod -- --file <scratch>/A_schema.sql --output table`: the new columns, `select proname from pg_proc where proname='persist_shop_month'` (1 row), A4 and A5 (incl. PUBLIC).
  5. Merge PR2.
  6. Recompute per §3 rule, before the 02:00 UTC cron.
- **Docs + help:**
  - technical.md § Ratio & Compliance: calculation, floors, stability rule, revisions, single writer, "what we cannot measure".
  - `vamp-ratio-explained`: "final on the 8th; figures can be revised and are labelled".
- **Tests:**
  - `canMarkStable.test.ts`:
    - day 7 23:59 false, day 8 00:00 true;
    - `in_progress` false; `completed_at` null false; `since_date` > monthStart false;
    - **Blume prod-shaped:** completed 2026-07-21, since 2010-01-01, month 2026-09, now 2026-10-08 → true;
    - MM, cay and surasvenne real dates for 2026-09 → true.
  - `computeShopMonth.test.ts`: Blume Jul/Aug/Sep fixture == §7 orientation; injected count error → throws, persist not called.
  - `persistShopMonth.test.ts`: calls only `rpc`; `p_mark_stable` derives from the rule.
  - Cron tests:
    - cap 3; no current-month write;
    - self-heal bounded by `trendWindow`; a zero-dispute shop gets 12 rows after 4 runs;
    - drift limited to the programme block; denominator-only churn below display precision (Blume Aug 7/3,274 → 7/3,276, still "0.21%") → no revision; a new chargeback → revision `late_data`; churn crossing a display digit (0.21% → 0.22%) → revision;
    - alert dedup (second day-10 run → no email);
    - **no worker case** is added.
  - Script: `--expect-ref` mismatch exits 1.
- **Acceptance:**
  - A1 == A0. A3 = 0. A4 = 0. A5 all true / 0 grants.
  - `persist_shop_month` dev test output attached to the PR.
  - The Blume 2026-09 row's `card_dispute_ratio` == the PR1 value (or the diff is explained by a logged revision). On **any** date in October 2026, the Blume route `programmeMonth.periodMonth` = 2026-09 (`statementMonth`), with the same value: `periodState='provisional'` before 2026-10-08 02:00 UTC and `final` after.
  - Row view == log view at the same revision (A4 + the 5-dp guard).
  - **LSI headline == VAMP checkpoint** for Blume.
  - No row with `card_dispute_ratio IS NULL AND settled_count >= 50`.
  - **On or after 2026-10-08 02:00 UTC:** Blume, MM, cay and surasvenne 2026-09 have `stable_at IS NOT NULL`.
- **Rollback:**
  - `--restore-revision 0` per shop writes a new revision with rev-0 values. The v2 columns are NULL in that state, which is expected: A1 and the NULL check do not apply after a rollback.
  - Code revert. The columns stay.

### PR3a: Operational block, read path, persisted checkpoints (server)
- **`lib/insights/period/`:**
  - `computeOperationalMetrics` (paginated `.range`, one definition each):
    - 3DS: shared numerator/denominator predicate; fix the `route.ts:153-161` comment;
    - signed-for: per-order observability, null below n=30;
    - Protect by value;
    - `unknownPaymentShare`.
  - `computeWinRate` → `lib/disputes/winRate.ts` (extracted from `metrics.ts:324-336`; dashboard unchanged). The insights wrapper returns `null` on a 0 denominator.
  - `computeShopMonth` = programme + operational + win rate. `evaluateCheckpoints` runs **only here**.
  - Checkpoints persisted as raw `params` + tokens + `sourceToken`, ordered by `orderCheckpoints()`. `metrics_version` → 3.
  - `computeLiveState`: open = `ACTIVE_NORMALIZED_STATUSES`; awaiting bank = `submitted_to_bank` | `submitted_confirmed`; nearest due excludes awaiting bank.
  - `readInsightsPeriod(sb, shop, month|"mtd")`:
    - a closed month reads the row;
    - a missing row, or a stable row with NULL `operational_metrics`/`checkpoints`, → `{status:'not_available'}` and no compute;
    - MTD → live compute + server eval.
  - `readRevision(sb, shop, month, rev)` reads the log, for PR4.
  - `toInsightsViewModel(period, liveState, revisionInfo)` is the only builder (tokens + raw numbers).
  - `format.ts` (`formatPct`, `formatCount`, `formatMonth(iso, locale)`) is the only formatter.
- **Per payment method (§0.9):** `computePaymentMethodBreakdown(sb, shop, month)` in `lib/insights/period/`, persisted in the month row's `operational_metrics.byPaymentMethod` (same revision, same writer) and exposed as `viewModel.byPaymentMethod`. Test fixtures: blume-box Jul (typed-in Mastercard 28%), Mein Maison Jul (PayPal 3.58% / 6.03%), cay Sep (Klarna 0% / 1.52%).
- **Route:** `?period=YYYY-MM` returns `{status, viewModel, trend: 12, mtd}`. Deletes `compute3dsAndFulfillment`, the KPI part of `aggregateWindow`, `signatureObservable` and the PR1 live programme call.
- **`page.tsx`:** delete the client `evaluateCheckpoints` (L975); render `viewModel.checkpoints`.
- **Recompute:** `--reason metrics_v3` over all closed months in `trendWindow` (§3 rule), **immediately after the PR3a deploy**.
  - Between the deploy and the recompute, stable rows have NULL `operational_metrics`, so the default view shows `not_available`. That is expected.
  - The cron does not heal this gap, because step 2 only picks missing or non-stable months. The recompute does.
- **Tests:** §6 infra + unit. I1–I3, I5–I7 and I9 land (I4 in PR1, I8 in PR3b).
- **Acceptance:**
  - A2 = 0.
  - Blume `?period=2026-09`: `viewModel.programme.cardDisputeRatio` == A1 row; checkpoints == row jsonb.
  - Fail-closed test passes.
  - Closed-month route p95 < 1.5 s (Vercel logs).
- **Rollback:** revert. The rows stay valid.

### PR3b: Page UI (blocked on the Claude Design delivery)
- **Design gate:** no UI work starts until the user's Claude Design for the Insights page is delivered.
  - Re-fetch it (`claude_design` MCP) before implementing.
  - Transcribe it element by element (CLAUDE.md rule 8).
  - Compare it card by card before declaring done.
  - The list below is the **data that must be presentable** (see §0), not a layout. Where the design and this list differ on presentation, the design wins. Where the design needs data §0 lacks, stop and ask.
- `page.tsx`, `OperationalCheckpoints.tsx` and `LiabilityShiftImpact.tsx` render only the view-model through `format.ts`. LSI shows the headline plus a labelled "after DisputeDesk exclusions" secondary (I8).
- **Delete the re-sort** in `OperationalCheckpoints.tsx:87-89` and its `severityOrder` (:186-197). The component renders `viewModel.checkpoints` in the server order (I3 extension).
- Every §0.1 state renders explicitly. `error` and `not_available` are never a blank area, a whole-page banner or a vanished card.
- **Data to present:**
  - period header "updated <revised_at>" / "provisional, final on <date>" (**no** revised-since line; that is PR4);
  - month selector (`trendWindow` months);
  - 12-month trend (`trendWindow`, zero-dispute months shown as real entries);
  - MTD line;
  - no-payment-method caveat (>20%);
  - "N disputes could not be matched to an order";
  - signature "—" when unobservable.
- **i18n (6 locales):** `fraudIntel.periodHeader`, `periodUpdated`, `periodSelectorLabel`, `monthToDateLine`, `firstFullMonthOn`, `notFullyImported`, `programmeEstimateLabel` ("Card dispute ratio (estimate)"), `ecmLowerBoundLabel`, `trendTitle`, `unknownPaymentCaveat`, `unresolvedDisputes`, `afterExclusionsLabel`, `notAvailable`.
- **Help:** `vamp-ratio-explained`: the month selector, so-far month and caveat.
- **Acceptance (on or after 2026-10-08 02:00 UTC):**
  - the design comparison is recorded card by card in the PR;
  - Blume default view = Sep 2026 (`final`), "0.15%", healthy, caveat shown (32% no method);
  - `?period=2026-07`: 2.37%, `info` below the enforcement floor;
  - MM, cay N/A; surasvenne "—"; Blume signature "—".
- **Rollback:** revert.

### PR4: Digests from the record, send pointer, auto re-enable
**Design gate (template only):** the email template layout follows the user's Claude Design email design and is transcribed literally (CLAUDE.md rule 8). The migration, `digestSends`, the crons, the route and the parity tests do not wait for the design. `sendMonthlyChargebackDigest`/`sendOnboardingAnalysisDigest` template markup does wait. The template consumes only §0.8 fields.

- **Migration** `20261005100000_insights_digest_sends.sql`:
  - `insights_digest_sends(id uuid pk default gen_random_uuid(), shop_id uuid not null references shops on delete cascade, kind text check in ('monthly','onboarding'), period_month date not null, snapshot_revision int not null, trend_revisions jsonb, metrics_version smallint not null, thresholds_version text not null, live_state jsonb not null, headline jsonb not null, is_correction boolean not null default false, status text check in ('pending','sent','failed'), sent_at timestamptz, created_at timestamptz default now(), unique(shop_id, kind, period_month))`.
    - `trend_revisions` = `{ "YYYY-MM-01": revision, … }` for every trend month the email renders. It is required for `onboarding` and NULL for `monthly` (the monthly email shows no trend; §0.8).
  - RLS on; `public`/anon/authenticated revoked.
  - Apply:
    - dev in session: `npm run db:migrate:dev`;
    - prod before the merge: `APP_ENV=production node scripts/run-migration.mjs --target=prod 20261005100000`;
    - verify columns + A5 with `npm run db:query:prod -- --file <scratch>/A_schema.sql --output table`.
- **`lib/insights/period/digestSends.ts`** (the only writer, I6):
  1. claim a `pending` row (a conflict means it is already handled → skip);
  2. build the vm from `readRevision(snapshot_revision)` + `computeLiveState`. For onboarding, build the trend from `readRevision(month, trend_revisions[month])` for each `trendWindow` month;
  3. store `live_state` + `headline` (en strings + raw numbers) + `trend_revisions`;
  4. render, send, and mark `sent`/`failed`.
- **Cron** `monthly-digest`, schedule **`0 9 8-14 * *`** in `vercel.json`:
  - target = **`statementMonth(now)` (M-1) only**, and only when its row is `final`. It never falls back to M-2. If M-1 is not final, that day's run skips it, and the next day in 8–14 retries. `unique(shop_id, kind, period_month)` makes the repeats idempotent;
  - delete `windowMetrics`/inline counts;
  - marker `lastMonthlyDigestPeriod='YYYY-MM'`;
  - **legacy-covered skip:** if the shop's pre-PR4 marker `lastMonthlyDigestYyyyMm` equals period + 1 month (for example `'2026-10'` for 2026-09, which is the wrong 1 October email), the regular cron skips that period. Only the Q-E hook may send it, as a correction. Without this skip, a PR4 merge before 2026-10-14 would send a silent second September email from the cron. Test it;
  - the opt-out and `teamEmail` checks are kept.
- **`sendMonthlyChargebackDigest.ts`:**
  - input = `{viewModel, liveState, sentAt, isCorrection}` only, no `SupabaseClient` (I7);
  - renders `checkpoints.slice(0,3)`;
  - link `insights/initial-analysis?period=YYYY-MM&digest=<id>`.
  - `digestShared.ts`: delete `CHECKPOINT_COPY` and resolve via `getTranslations({locale:'en'})`. Delete `digestDisputeActivity.ts`.
- **Onboarding:**
  - Remove `backfillOrders.ts:344`.
  - The calculate-ratios cron adds step 5 for shops matching all of:
    - import `complete`;
    - `historical_import_completed_at >= now() - interval '60 days'` (NB9: no "welcome" email months later to a shop that had no recipient or had opted out);
    - `onboarding_digest_sent_at IS NULL`;
    - no `sent` onboarding row.

    The digest sends when a stable month exists AND **every month of `trendWindow(shop, now)` has a row** (the same window self-heal fills, so a zero-dispute shop qualifies after ≤4 nights). It then calls `triggerOnboardingDigest` → `digestSends` (kind `onboarding`): latest stable month + 12-month trend, with `trend_revisions` pinned. Otherwise it waits and is re-checked daily.
  - This one rule covers:
    - new shops, with or without disputes;
    - M-2-partial shops, which wait for the next day 8;
    - shops whose import completed during suspension within the last 60 days. They were never claimed, because PR0 gated before the claim.
- **Route:**
  - On `digest=<id>` (shop-scoped), return the vm built from `snapshot_revision` + stored `live_state` (and the trend from `trend_revisions` for onboarding). Headline strings come from the stored `headline` for `en` viewers.
  - The **"Revised since the email of <date>"** line appears on the default and digest views only when at least one headline field's `en` string differs between `send.snapshot_revision` and the current row. It lists only those fields, and is **hidden when the list is empty** (a revision with no visible headline change shows nothing).
- **Gate:** `insightsDigestsEnabled()` → `process.env.INSIGHTS_DIGESTS_DISABLED !== "true"`. Default on, so merging PR4 re-enables both digests with no Vercel step. I9 stays.
- **Scripts:** `scripts/preview-insights-digest.ts --shop --period --kind monthly|onboarding --env-file --expect-ref --out` renders only, never inserts or sends. Both `*-example.ts` scripts are deleted.
- **i18n:** `email.insightsDigest.*` + `fraudIntel.revisedSinceEmail`, `asEmailedOn`, `seeCurrentFigures`, `correctionBanner` (6 locales). Untouched email chrome is a recorded exception in technical.md.
- **Docs + help:** technical.md § digests (pointer contract, `trend_revisions`, parity tiers, day 8–14 schedule, kill switch, onboarding readiness + 60-day bound). Help: the monthly email.
- **Q-E hook (only if the user says yes):** a cron-gated `?period=2026-09&correction=1&shop=<domain>` path on `monthly-digest` sends `is_correction=true` (banner "This replaces the email of 1 October, which used incorrect figures") once per shop.
  - The correction row uses `kind='monthly'` with `period_month=2026-09`, which has no prior send row (the 1 October email predates the table), so the same unique key dedups it.
  - `&shop=` makes the canary order (§9) enforceable.
- **Master-go preconditions (§4):** all must hold before the go is requested.
- **Acceptance:**
  - §7 protocol for the 4 shops on 2026-09;
  - `?period=2026-09&digest=<uuid>` survives `ddredirect` (`app/(embedded)/app/page.tsx:241-253`) (test);
  - the onboarding sweep test (incl. the zero-dispute shop, and a shop completed 61 days ago → not swept);
  - the digest cron on day 9 with M-1 not final on day 8 → sends M-1 on day 9 (never M-2);
  - the email template matches the delivered design (recorded comparison in the PR).
- **Rollback:** set `INSIGHTS_DIGESTS_DISABLED=true` (user, Vercel) or revert, in which case the code gate returns to PR0's `false`.

PR4 addition: the email carries the top 3 payment methods by disputes (method, orders, chargeback rate), pinned to the same revision as the rest.

### PR5: Per-network denominators from existing card-brand data (after PR4)
- **Source:** `shopify_order_risk_signals.card_brand`, joined on `(shop_id, shopify_order_id)`. It is normalised by `normalizeCardBrand` = the exported `CARD_COMPANY_TO_NETWORK` lookup (`enrichNetworkReasonCode.ts:27-63`), and `deriveCardNetwork` is refactored to call it, so there is one brand map. No Shopify query change and no order column.
  - The primary-transaction pick is still two functions (`signalWriter.ts:87` and `enrichNetworkReasonCode.ts:41`). The plan does not claim a single pick. Unifying them is out of scope.
- **SQL function** `insights_card_settled_by_brand(p_shop uuid, p_from date, p_to date) returns table(brand text, n bigint)`:
  - card-rail settled orders grouped by `lower(card_brand)`; TS maps the brands. This avoids un-ranged row pulls;
  - `security invoker`;
  - `revoke execute … from public, anon, authenticated; grant execute … to service_role`.
- **`computeProgrammeBlock` (metrics_version 4):**
  - `visa_settled_count` (M), `mc_settled_count` (M-1, finally correct), `brand_coverage` (branded / card settled, M and M-1);
  - chargebacks classified by **order brand**, with reason code as the fallback when the brand is NULL;
  - `visa_dispute_ratio = visa CBs / visa settled`, null <50;
  - `mc_ecm_ratio = MC CBs(M) / mc_settled(M-1)`, with the "lower bound" label retired;
  - the §2.2 ECM count-floor exception ("≥100 MC CBs → at least consider") is removed once the true MC denominator applies;
  - all ratios are rounded once via `roundRatio` (§2.2).
- **Headline switch:**
  - `brand_coverage ≥ 0.95` in M and M-1 → "Visa dispute ratio (VAMP, disputes only)" + "Mastercard ECM ratio";
  - otherwise → "Card dispute ratio (estimate)" (the PR3b label).
  - Severity uses the network ratio when the switch applies.
  - "Disputes only" stays because TC40 fraud reports are not observable (FU-1).
- **Migration** `supabase/migrations/20261012100000_insights_network_denominators.sql`:
  - `ratio_snapshots` adds `visa_settled_count int`, `visa_dispute_ratio numeric(8,5)`, `brand_coverage numeric(5,4)`;
  - the comment on `mc_settled_count` is updated;
  - `insights_card_settled_by_brand` is created with the grants above;
  - `persist_shop_month`'s 5-dp guard covers the new ratio keys (`create or replace`, grants re-applied).

  If a later migration already uses this timestamp at execution time, take the next free `YYYYMMDDHHMMSS` and use that prefix in both commands. Apply:
  1. dev, in session: `npm run db:migrate:dev`, then verify with `npm run db:query:dev -- --file <scratch>/A_schema.sql --output table`;
  2. prod, before the master merge: `APP_ENV=production node scripts/run-migration.mjs --target=prod 20261012100000`;
  3. verify with `npm run db:query:prod -- --file <scratch>/A_schema.sql --output table`: the 3 columns, the function (1 row in `pg_proc`), A5 (incl. PUBLIC).
- **Backfill:**
  - **(a) Coverage check first:** A-B1 per shop over the 13-month trend window.
  - **(b) Gap-fill only if coverage <95%:** enqueue the existing `backfill_shop_orders` job, bounded to the trend window, at priority ≥500 (memory: job-priority starvation). Prod coverage is 99.6–100% today, so this is expected not to run.
  - **(c) Recompute:** `--reason metrics_v4_network_denominators`, all closed months in the trend window (§3 rule, Blume canary). Any already-emailed month shows "Revised since" (expected, labelled). If PR5 lands before 2026-11-08, no month has been emailed yet.
- **Tests:**
  - brand map single-source (I4-style invariant: `CARD_COMPANY_TO_NETWORK` defined once);
  - "unknown"/NULL brand → unbranded;
  - coverage 0.94 → estimate label, 0.95 → network label;
  - Blume Jul fixture: MC 71 / June MC settled 1,383 = 5.13% with count < 100 → `info` below floor (not breach).
- **Acceptance:**
  - A-B1: route `visa_settled_count` and `mc_settled_count` == SQL. The brand-NULL share is reported per shop on **both** the settled side and the chargeback side (e.g. Blume Jun 19/22 and Jul 72/75 branded CBs).
  - A June revision is expected, because brand and reason code disagree (MC 16 vs 14). It is labelled.
  - Blume Sep orientation: `visa_dispute_ratio` ≈ 2/1,719 = 0.00116 and `mc_ecm_ratio` ≈ 2/880 = 0.00227. The exact values equal A-B1 run the same hour.
  - **Blume** (`card_framing_applies=true`) shows the network-specific headline label. **MM and cay** keep `card_framing_applies=false` → N/A with pills hidden (unchanged; revisiting them is FU-10). **surasvenne** stays "—" (<50).
- **Help:** `vamp-ratio-explained`: per-network denominators, the coverage rule, "disputes only".
- **Rollback:** `--restore-revision` to the v3 revision; revert.

---

## 4. Re-enable = PR4 master-go preconditions (owner: the user, in chat)
1. PR0–PR4 are on master's candidate, and both prod migrations are verified (schema + A4 + A5).
2. The parity, invariant and onboarding-sweep suites are green on CI.
3. The §7 protocol has zero unequal cells for the 4 shops on 2026-09.
3b. The page (PR3b) and email template (PR4) match the delivered Claude Design, with a card-by-card comparison recorded.
4. The user has seen the Blume preview HTML and the Blume page (`?period=2026-09`) side by side in chat and said yes. That yes **is** the master go for PR4. After the merge, digests are live with no further step.

**After the merge:**
- The next regular monthly send is **2026-11-08 09:00 UTC for October 2026** (retried daily to the 14th if October is not final). September 2026 is skipped by the legacy-covered rule for the 4 shops that got the 1 October email, and is sent only through Q-E.
- Onboarding sends resume on the next 02:00 cron for eligible shops.
- The wrong 1 October email is never corrected unless Q-E = yes.

---

## 5. Pre-mortem
1. **"The page still doesn't match the email."**
   - *Causes:* the merchant arrives via the nav (no `digest=`), or a revision lands between send and click, or a copy/format change alters a number.
   - *Mitigations:*
     - the default view looks up the last send and labels changed headline fields;
     - live state is labelled "Right now" vs "As of";
     - the `ddredirect` round-trip is tested;
     - the copy-drift guard (§2.5.4) fails CI;
     - `en` viewers see the stored headline strings;
     - ratios are rounded once (row == log, 5-dp guard in SQL, boundary-quotient test);
     - one `statementMonth` for the page, LSI and the email;
     - "Revised since" fires only on a visible headline change, so refund churn does not produce false "disagreements";
     - I7/I9.
2. **Recompute corrupts history.**
   - *Causes:* a wrong PR2/3a/5 recompute, a NULL-method repair swinging July, or drift spam.
   - *Mitigations:*
     - every state is logged (rev 0 backup) in one transaction;
     - a Blume canary diff is read against A0 before the others;
     - `--restore-revision`;
     - the hash short-circuit;
     - drift limited to the programme block, ≤3 months, and material changes only (`driftIsMaterial`);
     - the advisory lock serializes cron and script writers;
     - A1/A4 after each shop;
     - sent emails are pinned to their revision.
3. **A real breach is hidden.**
   - *Causes:* floors or the all-card ECM denominator downgrade real exposure; stability never fires (the v2 N1 class); a count error persists zero.
   - *Mitigations:*
     - below-floor is a visible `info` with numbers;
     - ECM floor met → ≥consider;
     - PR5 replaces the all-card ECM with the true MC denominator (Blume July 5.13% shown, not 1.48%);
     - prod-shaped `canMarkStable` tests;
     - the deduped day-9 "M-1 not stable" alert to support@;
     - compute throws on query errors (test), and the routes turn that into an explicit "unavailable" state, never a silent zero or a vanished card;
     - the digest cron retries days 8–14, so a late-stabilizing month is still emailed.

---

## 6. Expanded test plan
**Infra (PR3a, ~300 LOC + self-test):** `tests/helpers/fakePostgrest.ts`.
- In-memory tables.
- `select` incl. `{count:'exact', head:true}`.
- `eq/neq/gte/gt/lt/lte/in/is/not/or`, `order/range/limit/single/maybeSingle`, `insert/upsert/update/delete`.
- **Un-ranged selects cap at 1000.**
- An `rpc` registry (`persist_shop_month`, `insights_card_settled_by_brand`) with a TS reference implementation of §2.6 for integration tests. The real SQL is covered by the dev SQL test.
- `fakePostgrest.test.ts` pins the cap, filters and rpc stub.

**Unit:**
- `canMarkStable` (incl. 4 prod shapes), `computeProgrammeBlock` (throws, pagination, inquiries, 5-dp rounding, per-month `card_framing_applies`), `computeShopMonth`, `persistShopMonth`;
- `months` (`statementMonth` incl. the January rollover; `periodState`; `trendWindow` bounded by since_date, first order and 12 months);
- `driftIsMaterial` (count change → true; sub-display-precision denominator churn → false; display-digit change → true);
- route error handling (both routes: programme throw → `status:'error'`, 200, rest intact);
- `checkpoints` (healthy/info/consider/breach matrix, ECM floor, undefined programme, ordering);
- `operational` (1,401 orders counted under the cap; shared 3DS predicate; signature null);
- `winRate` (0 denominator → null in insights);
- `liveState`;
- `format` (6 locales parse back to the same numbers);
- `insightsDigestGate` (PR0 false; PR4 default-on, `DISABLED=true` off);
- `normalizeCardBrand` (PR5).

**Integration** (fakePostgrest + `nextMock`), `lib/insights/period/__tests__/parity.test.ts`. Blume-shaped fixture with >1000 orders/month (Sep 2,686 card + 1,282 unknown, 4 CBs; Jul 75 CBs).
1. Compute → persist → digest send → email HTML contains every `en` headline string and checkpoint ids == `vm.slice(0,3)`. The route `?period` vm deep-equals.
2. `?digest=<id>` vm == the send's revision vm, and the headline == the stored `headline`.
3. **Threshold mutation** (`vi.mock programmeThresholds`): digest and closed-month views are unchanged; only MTD changes.
4. **Revision:** a late CB + recompute → the send is unchanged, and the default and digest views show "Revised since … 0.15% → 0.19%". A revision whose headline strings are all unchanged → **no** "Revised since" line.
4b. **Boundary quotient (B1):** a month with quotient 0.0014446. The email, the digest view (log) and the default view (row) at the same revision all render the same string, and the row column == the log value.
5. Copy-drift guard: mutate a `format.ts` rounding → the test fails.
6. Onboarding:
   - (a) new shop, no stable month → waits, then sends after day 8;
   - (b) shop completed during PR0 (sent_at NULL, completed ≤60 days ago) → swept once; completed 61 days ago → never swept;
   - (c) the second run sends nothing;
   - (d) **trend pinning:** after the send, one trend month is revised; the digest view's trend is unchanged (it reads `trend_revisions`), and the default view's trend shows the new value;
   - (e) **zero-dispute shop:** no `initiated_at` at all → self-heal fills `trendWindow` in ≤4 nights → onboarding sends.
6b. Monthly digest: M-1 not final on day 8 → no send and no M-2 fallback; final on day 9 → sent on day 9; day 10 → nothing (dedup); legacy marker `'2026-10'` → September skipped by the cron.
7. Fail-closed: a stable row with NULL `operational_metrics` → `not_available`, compute spy not called.
8. Crons:
   - calculate-ratios: cap, drift, alert dedup, no current-month write;
   - monthly-digest: skips non-stable months, sent periods and the kill switch; marker = period.

**SQL (dev):** `scripts/sql/test_persist_shop_month.sql`, run as DO blocks: failure atomicity (exception sub-block), 6-dp raise, no-op on equal hash, rev+1 on change, advisory lock present.

**CI invariants** (`tests/invariants/insightsMetricsInvariants.test.ts`, scope as v2 §6):
- I1: no disputes `created_at` range filter.
- I2: no un-ranged non-head select on `shopify_orders`/`disputes`.
- I3: `evaluateCheckpoints(` only in `lib/insights/period/**`; its definition file and its tests are exempt. No `.sort(` over checkpoints outside `orderCheckpoints` (catches the `OperationalCheckpoints.tsx` re-sort class).
- I4: VAMP/ECM numeric constants only in `programmeThresholds.ts`; the brand map defined once; "current month" / trend-range month arithmetic only in `lib/insights/period/months.ts`.
- I5: no `CHECKPOINT_COPY`, English checkpoint literals, `pct(`/`toFixed(`/`%`-templates or `source.label` in `lib/insights/**`.
- I6: writes to `ratio_snapshots`/`ratio_snapshot_revisions` only through `rpc('persist_shop_month')` in `persistShopMonth.ts`; `insights_digest_sends` only in `digestSends.ts`; `insights_ops_alerts` only in `programmeAlert.ts`. Repo-wide, scripts included.
- I7: no `SupabaseClient` in digest renderer input types.
- I8: LSI and checkpoints read `viewModel.programme`; no `/api/ratios/current` fetch in LSI after PR3b.
- I9: both senders and the trigger call `insightsDigestsEnabled()`.

**E2E (manual, prod):** §7. Dev smoke after each develop merge: `?period=<statementMonth>`, LSI == checkpoint, and the selector changes both.

**Observability:**
- Send log `{shop, kind, period, send_id, snapshot_revision, metrics_version, thresholds_version, headline}`.
- Cron output `{recomputed, revised, markedStable, skipped, onboardingSent}`.
- `insights_ops_alerts`.
- `scripts/sql/insights_period_audit.sql`: row vs A0, revision counts, A4.

---

## 7. Prod verification protocol (4 shops)
Shops: `blume-box`, Mein Maison `6a8848-dd`, `cay-collective`, `surasvenne` (`.myshopify.com`). Each query runs as follows (the guard must print `aokhplydttxtebvbeuzc`; never `tail`):

```
npm run db:query:prod -- --file <scratch>/A<n>.sql --output table > "$TMP/A<n>.txt" 2>&1; cat "$TMP/A<n>.txt"
```

- **A0:** the live derivation, as in v2 §7 but **without the low/unknown-in-denominator column**. The executor aligns the method list with `CARD_RAIL_METHODS`.
- **A1:** `ratio_snapshots` for the 4 shops, 2026-06..09. Columns: `settled_count, unknown_settled_count, card_chargeback_count, visa_chargeback_count, mc_chargeback_count, card_dispute_ratio, mc_ecm_ratio, vamp_floor_met, ecm_floor_met, coverage, stable_at, revision, metrics_version`. Pass = counts == A0, ratios == round(quotient, 5), and each row ratio == `(values->>'card_dispute_ratio')::numeric` of its current log revision (one representation).
- **Orientation** (Blume, 2026-10-02):

  | Month | card settled | unknown settled | card CBs | Visa / MC (reason code) | Card ratio | ECM (all-card M-1) | PR5 Visa | PR5 ECM (MC M-1) |
  |---|---|---|---|---|---|---|---|---|
  | Jul | 3,166 | 1,563 | 75 | 2 / 71 | 0.02369 | 71/4,789 = 0.01483 | 2/1,974 = 0.00101 | 71/1,383 = 0.05134 (count < 100 → info) |
  | Aug | 3,274 | 1,031 | 7 | 1 / 6 | 0.00214 | 6/3,166 = 0.00190 | 1/2,038 = 0.00049 | 6/862 = 0.00696 |
  | Sep | 2,686 | 1,282 | 4 | 2 / 2 | 0.00149 | 2/3,274 = 0.00061 | 2/1,719 = 0.00116 | 2/880 = 0.00227 |

  Floors are false in all months. The PR5 columns use reason-code counts; the exact values come from A-B1 with the order-brand classification.
- **A2:** `count(*) where stable_at is not null and (operational_metrics is null or checkpoints is null)` → 0 (after PR3a).
- **A3:** stable rows with an import that is not complete, partial coverage, or `stable_at < period_month + 1 month + 7 days` → 0. Backfilled past months get `stable_at=now()` and pass.
- **A4:** `select count(*) from ratio_snapshots r where not exists (select 1 from ratio_snapshot_revisions v where v.shop_id=r.shop_id and v.period_month=r.period_month and v.revision=r.revision and v.values_hash=r.values_hash);` → 0.
- **A5:**
  - `relrowsecurity` is true for `ratio_snapshot_revisions`, `insights_ops_alerts` and `insights_digest_sends`;
  - 0 grants to `PUBLIC`/anon/authenticated on those tables;
  - 0 `EXECUTE` for `PUBLIC`/anon/authenticated on `persist_shop_month` and `insights_card_settled_by_brand`. Check with `has_function_privilege('public', '<fn oid>', 'execute')`, `has_function_privilege('anon', …)` and `has_function_privilege('authenticated', …)`, all false. `information_schema.routine_privileges` alone does not show the implicit PUBLIC grant;
  - `has_function_privilege('service_role', …, 'execute')` is true.
- **A-PR1:** A0 restricted to Blume 2026-09 chargebacks only == route `programmeMonth` (same hour).
- **A-S** (on or after 2026-10-08 02:00 UTC): `select s.shop_domain, r.stable_at from ratio_snapshots r join shops s on s.id=r.shop_id where r.period_month='2026-09-01' and s.shop_domain in (…4…)` → 4 rows, all non-null.
- **A-B1 (PR5):** `v3_brand.sql` extended with `M-1` MC settled, brand-NULL share, and order-brand-classified chargebacks. It must equal the row's `visa_settled_count`, `mc_settled_count` and ratios.

**Per shop (after PR3b, after PR4, after PR5):**
1. Run A1.
2. Open `admin.shopify.com/store/<handle>/apps/disputedesk-1/app/insights/initial-analysis?period=2026-09` and record the values.
3. Run `npx tsx scripts/preview-insights-digest.ts --shop <domain> --period 2026-09 --env-file .env.production.local --expect-ref aokhplydttxtebvbeuzc --out <scratch>/digest-<shop>.html` and record the values.
4. The `digest=` view is verified on dev with a dev send (the integration test covers prod shape).

| Shop | Metric | Before page | Before email (Oct 1) | After page 2026-09 | After preview |
|---|---|---|---|---|---|
| blume | Card programme | 5.31% breach; LSI Oct 0.00% | 0.90% approaching | 0.15% healthy + 32% caveat | identical |
| blume | ECM | ~158/mo breach | n/a | 2 MC CBs, 0.06% lower bound, healthy (PR5: 0.23%) | identical |
| blume | Basis | 8,927 card (90d) | "Across 1,000" | 2,686 card settled | identical |
| blume | Live state | 15 open | 17 open, "52d overdue" | Right now: A-live counts | "As of": same hour equal |
| blume | Win rate | 14% (30d) | 6% / 94 | decided in Sep (null if none) | identical |
| MM | Card programme | VAMP N/A; LSI Oct 3.13% red | per email | N/A, pills hidden | identical |
| cay | Card programme | N/A | N/A | N/A | identical |
| surasvenne | Card programme | — | — | "—" (<50) | identical |

**Pass:** zero unequal cells in the last two columns, for all 4 shops.

---

## 8. Follow-ups (cut)
- FU-1: threshold primary-source recheck (`RECHECK_RULES` overdue 2026-08-11), TC40 observability, 3DS on wallets.
- FU-2: `shop_daily_metrics` −22% (F17).
- FU-3: dashboard tile (**user: unchanged in this plan**).
- FU-5: 3DS receipt-read marker.
- FU-6: Playwright.
- FU-7: NULL payment_method root cause, plus a one-hour probe of why 0/585 chargebacks sit on NULL-method orders (repaired on ingest, or not disputable). After a repair, recompute (revisions label it).
- FU-8: win-rate definition alignment.
- FU-9: drop `vamp_ratio_without_dd` (`mc_settled_count` is now kept; see PR5).
- FU-10: revisit `cardFramingApplies` for PayPal-heavy shops once per-network ratios exist (MM: 1,022 card settled in Sep is still Visa-enforceable volume).
- (FU-4 is removed; it is now PR5.)

---

## 9. Open question (user), the only one
**Q-E: send a one-off corrected September 2026 digest to the shops that got the wrong 1 October email?**
- Recipients (prod, `v3_qe.txt`):
  - blume-box → ariel@blume.com
  - Mein Maison → ecomm@hamzans.com
  - cay-collective → thelma@caycollective.com
  - surasvenne → oi@johan.com.br (yours)
- **Recommended default: YES**, for all 4. Blume was told "0.90%, approaching" when the figure is 0.15%. A merchant may act on a false compliance alarm, and the page will now contradict their inbox.
- **Mechanism:** PR4's `is_correction` path, sent once per shop right after the PR4 master merge, with a banner token "This replaces the email of 1 October, which used incorrect figures". Same record, same parity guarantees.
  - It sends September 2026 only once it is `final` (on or after 2026-10-08 02:00 UTC).
- **Canary order (rule: canary before bulk):**
  1. Send to **surasvenne** (`oi@johan.com.br`) first, with `&shop=surasvenne.myshopify.com`.
  2. Read the received email against `?period=2026-09` on the page, value by value.
  3. Only then send to blume-box, Mein Maison and cay-collective, one call each.

  A mismatch stops the batch.
- **Cost:** each shop gets 2 digests in about 4 weeks (the correction mid-October, then October's on 11-08).
- If you say no, the hook is not built, and the wrong email stands; the page labels nothing about it.

Decided (no longer open):
- Q-A: "Card dispute ratio (estimate)" until PR5's coverage switch.
- Q-B: the tile is unchanged.
- Q-C: auto re-enable in PR4 via the default-on kill switch, no Vercel step.
- Q-D: latest stable month + 12-month trend, with the trend shown in the onboarding email and pinned per month.
- Card brand: per-network ratios in PR5 from the existing `shopify_order_risk_signals.card_brand`.
- UI layout: follows the user-commissioned Claude Design (PR3b, PR4 template), transcribed literally.

---

## 10. ADR
- **Decision:**
  - Per-shop calendar-month rows in `ratio_snapshots` are the single correctable record.
    - They are computed by one pure function (`computeProgrammeBlock` ⊂ `computeShopMonth`), with ratios rounded once to 5 dp.
    - They are written only by the transactional, advisory-locked `persist_shop_month`, which writes the row verbatim from the payload it logs in `ratio_snapshot_revisions`.
    - A row is `final` (eligible for email) once `canMarkStable` holds (import complete, coverage full, day 8).
  - Month selection lives in one module: `statementMonth` = M-1, shown as provisional and then final; `trendWindow` serves self-heal, onboarding, the trend and the selector.
  - Each digest stores a pointer (`snapshot_revision`, plus `trend_revisions` for onboarding) + live state + headline. The page renders that revision when opened from the email, and labels later revisions only when a headline string changed.
  - Drift revisions are written only for material changes.
  - The UI layout follows the user's Claude Design. This plan fixes the data contract (§0).
  - Ship order: PR0 suspend (code) → PR1 live stopgap from the same function, one threshold table → PR2 persistence + both routes switched → PR3a server → PR3b UI → PR4 email + auto re-enable → PR5 per-network denominators from existing brand data.
- **Drivers:** email == page; programme-faithful numbers; bounded prod risk.
- **Alternatives considered:**
  - A, hard freeze on day 8: freezes biased data and has no live state.
  - B, live compute only: drift between send and click. It is kept as the compute layer.
  - Stored rendered view-model: needs a schema-versioning policy; replaced by the pointer + headline.
  - Unknown-method range: contradicted by prod (0/585); replaced by a caveat.
  - Materialize job: over the worker budget; replaced by cron self-heal.
  - New `shopify_orders.card_brand`: a duplicate of the ingested `shopify_order_risk_signals.card_brand`.
  - "Latest stable month" as the page default: it would flip the page back to M-2 on days 1–7 and hide the corrected current statement. M-1-provisional was chosen instead.
  - Rendering ratios from counts at every surface: valid, but it spreads the arithmetic across surfaces. "Round once at compute, write verbatim" keeps one representation with a SQL guard.
  - Unfiltered nightly drift: it produces refund-churn revisions and false "Revised since" lines (Blume Aug 0.21% → 0.22%). Replaced by the materiality filter.
- **Why chosen:**
  - It is the smallest design that makes the emailed numbers reproducible from a pinned record while history stays correctable.
  - PR1's live use of the final function removes every cross-PR definition change.
  - PR5 costs one migration plus a recompute, because the brand data already exists.
- **Consequences:**
  - 3 tables + 2 SQL functions (RLS, execute revoked).
  - The email moves from the 1st to the 8th, with retries through the 14th.
  - The page shows M-1 as "provisional" on days 1–7.
  - PR3b and the PR4 template are gated on the design delivery.
  - Digests are off until PR4 merges, and on automatically after it.
  - "Revised since" lines appear after repairs, which is intended.
  - The legacy columns change meaning in PR2 (documented).
  - Network-specific headlines arrive with PR5.
  - The onboarding email can wait until the next day 8, plus up to about 4 nights of self-heal for the trend, and only reaches shops whose import completed in the last 60 days.
- **Follow-ups:** FU-1 … FU-10 (§8); Q-E (§9).
