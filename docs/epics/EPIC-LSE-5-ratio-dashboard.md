# EPIC LSE-5 — Ratio & Compliance Dashboard

> **Status:** Planned
> **Phase / week target:** Phase 5 of Liability-Shift Engine — Weeks 27–32
> **Dependencies:** EPIC LSE-2 (submission outcomes), EPIC LSE-3 (FPT outcomes), EPIC 9 (i18n)
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §8

## Goal

Surface to the merchant their **calculated** Visa VAMP, Mastercard ECM, and Mastercard EFM ratios; show threshold proximity; alert when approaching unsafe levels; and visualize the **counterfactual** impact of DisputeDesk's CE 3.0 / FPT wins ("here is where your ratio would be without us").

This is the marketing artifact of the LSE platform. The value is the qualification + evidence engines (LSE-1 to LSE-3); the dashboard is how merchants *see* that value.

## Non-goals (explicit)

- Pulling authoritative ratios from acquirers — we don't have that data feed; everything is **calculated estimate** from Shopify data, always labeled as such
- Predicting future ratios (no forecasting model in v1)
- Sending ratio data to third parties
- Cross-merchant benchmarks (defer — privacy + sample-size concerns)

## Architecture

```
nightly batch job (cron)
   │
   ▼
calculateRatios(shop, period_month)
   ├─ load disputes + orders for the month
   ├─ classify disputes:
   │     ├─ tc40_fraud  (reason fraudulent + kind chargeback)
   │     ├─ tc15_other  (everything else)
   │     └─ ce30_won / fpt_won / rdr_excluded  (read submission_logs)
   ├─ count tc05_settled
   └─ compute ratios + counterfactuals
        ↓
   upsert ratio_snapshots
        ↓
   check thresholds → emit alerts (in-app + email)

embedded/portal dashboard
   ├─ current ratios strip (live read of last snapshot)
   ├─ 12-month trend chart with threshold + counterfactual lines
   ├─ monthly impact summary
   └─ threshold-alert banner
```

**Touchpoints:**
- New module: `lib/liabilityShift/ratios/calculate.ts`
- New job: `lib/jobs/handlers/calculateRatiosJob.ts`
- New cron entry: `vercel.json` cron → `/api/jobs/run-ratio-calculations` nightly
- New API: `GET /api/ratios/current`, `GET /api/ratios/trend`
- Dashboard components in both `app/(embedded)/app/` and `app/(portal)/portal/`

## Calculations

Per PRD §8 and Visa's VAMP fact sheet:

```
VAMP_ratio = (count(TC40_fraud) + count(TC15_disputes)) / count(TC05_settled)
```

**Approximation from Shopify data** (always labeled as estimate in UI):
- `TC40_fraud` ≈ disputes where `reason = 'fraudulent'` and `kind = 'chargeback'`
- `TC15_disputes` ≈ all other disputes (kind chargeback or inquiry)
- `TC05_settled` ≈ paid orders excluding refunds and voids

**Exclusions from numerator** (when documented in `submission_logs`):
- `ce30_won` — disputes won via documented CE 3.0 submission, regardless of channel
- `fpt_won` — disputes won via documented FPT submission
- `rdr_excluded` — disputes resolved via Visa RDR (out of scope for LSE, but exclusion logic supports it)

**Mastercard ECM ratio** ≈ Mastercard chargebacks ÷ Mastercard settled count (per month)
**Mastercard EFM ratio** ≈ Mastercard fraud-only chargebacks ÷ Mastercard settled count (per month)

Thresholds (display only — encoded in `lib/liabilityShift/ratios/thresholds.ts`):
- VAMP standard threshold: 0.65%
- VAMP excessive threshold: 1.50%
- ECM threshold: 1.00%
- EFM threshold: 0.50% (varies by region — encode as data)

Color bands:
- Green: < 80% of standard threshold
- Yellow: 80%–100% of standard, OR > standard < excessive
- Red: ≥ excessive

## Counterfactual impact

For each month, compute two numbers:
1. **Actual VAMP ratio** — using the exclusion rules above
2. **Without-DisputeDesk VAMP ratio** — same numerator but with `ce30_won` and `fpt_won` **NOT** excluded

The delta is "transactions DisputeDesk removed from the VAMP numerator this month." Multiplied by Visa's per-enforcement-transaction fee ($8 per current fact sheet, but encode as data) gives the **estimated fees avoided**.

This is the marketing number. It's also a defensible number because we only count disputes where `submission_logs.final_outcome = 'won'` and the channel involved a DisputeDesk-generated package.

## Database changes

Migration: `supabase/migrations/NNN_lse_ratio_snapshots.sql`

### New table: `ratio_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK | |
| `period_month` | date | First day of month |
| `settled_count` | int | TC05 estimate |
| `tc40_count` | int | |
| `tc15_count` | int | |
| `vamp_ratio_calculated` | numeric | |
| `vamp_ratio_without_dd` | numeric | counterfactual |
| `ce30_excluded_count` | int | |
| `fpt_excluded_count` | int | |
| `rdr_excluded_count` | int | |
| `mc_settled_count` | int | |
| `mc_ecm_chargeback_count` | int | |
| `mc_ecm_ratio` | numeric | |
| `mc_efm_fraud_count` | int | |
| `mc_efm_ratio` | numeric | |
| `estimated_fees_avoided_usd` | numeric | counterfactual × $8 |
| `estimated_revenue_recovered_usd` | numeric | sum of won-dispute amounts |
| `calculated_at` | timestamptz | |

Index: `(shop_id, period_month desc)` unique.

### New table: `ratio_alerts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK | |
| `triggered_at` | timestamptz | |
| `alert_type` | text | `vamp_yellow`, `vamp_red`, `ecm_yellow`, `ecm_red`, `efm_yellow`, `efm_red` |
| `current_value` | numeric | |
| `threshold_value` | numeric | |
| `notified_via` | text[] | `in_app`, `email` |
| `dismissed_at` | timestamptz nullable | |

## Job / cron

Nightly job `calculate_ratios` enqueued by a Vercel cron. Re-runs the current month (in case of late-arriving data) plus the previous month if it's the first 7 days of the new month. Idempotent: upsert by `(shop_id, period_month)`.

Alert emission deduped per shop per `alert_type` per month — don't spam.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ratios/current` | Last snapshot for current shop |
| GET | `/api/ratios/trend?months=12` | 12-month series |
| POST | `/api/ratios/alerts/:id/dismiss` | Dismiss an alert |

## UI changes

### Embedded dashboard + Portal dashboard
Top-of-page **Ratio Strip**:
- Three small cards: VAMP ratio, ECM ratio, EFM ratio
- Each with current value, threshold, color band

**Trend chart** (12 months):
- Line: actual VAMP ratio
- Line (dashed): without-DisputeDesk VAMP ratio
- Horizontal threshold lines at 0.65% (standard) and 1.50% (excessive)
- Hover tooltip per month with breakdown

**Monthly impact summary** card:
- This month: disputes qualified, packages submitted, wins by channel, transactions removed from VAMP, fees avoided, revenue recovered
- Quarterly rollup option

**Threshold alert banner**:
- Yellow / red banner persistent until dismissed when a ratio crosses a band
- Email notification on threshold cross

### Settings
- Configure email recipients for ratio alerts
- Toggle which ratios to alert on

## i18n keys

New namespace `liabilityShift.ratios.*`: ratio labels (3), threshold-band labels (3), trend chart legend, alert templates, impact-summary copy. Translate across all 6 locales.

**Final localization pass for the whole LSE track happens in this epic** (per PRD §10 Phase 5 — "Remaining four languages"). EN + PT-BR were done in LSE-2 / LSE-3 / LSE-4; this epic completes ES, FR, DE, IT.

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `calculate_ratios` job runs nightly via Vercel cron and writes `ratio_snapshots`
- [ ] Calculation unit tests cover:
  - Empty month (no orders) → zero ratios, no alerts
  - Month with 1 CE 3.0 win → counterfactual delta = 1
  - Mastercard-only shop → VAMP fields zero, ECM/EFM populated
  - Month spanning the LATAM FPT launch (2025-06) — historical rows show no FPT exclusions before that date
- [ ] Threshold alerts emitted in-app and via email (existing email service from EPIC-10) when ratios cross bands
- [ ] Dashboard renders Ratio Strip + Trend Chart + Monthly Impact in both embedded and portal
- [ ] Trend chart counterfactual line is visually distinct (dashed, lighter color)
- [ ] All copy is labeled "calculated estimate" — never "official ratio"
- [ ] All 6 locales have complete translations for the LSE track (catch-up from LSE-2/3/4)
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` all green
- [ ] `docs/technical.md` updated with §*Ratio & Compliance Dashboard* (calculation methodology, threshold sources, counterfactual definition)
- [ ] Help article in `lib/help/` updated explaining the calculation caveat
- [ ] Public launch readiness check — marketing site copy reviewed against PRD §13 ("What we don't claim")
