# Plan: Insights page is mostly empty on a shop's first day

**Status: approved 2026-10-09 and implemented** (branch `fix/insights-first-day-gaps`). Step 0 ran on prod the same day. ralplan consensus in round 4: Architect "sound with changes", Critic "approve" — see §8
**Mode: short** (no schema change; prod data writes only in step 0, through existing writers)
**Trigger:** `whj8db-1q.myshopify.com`, Chargeback Exposure page (`/app/insights/initial-analysis`), viewed 2026-10-09.
**Code baseline:** `origin/master` (prod). The local branch `docs/true-up-plan-status` carries the pre-redesign page and must not be used as a reference. All file:line references are `origin/master`.

---

## 1. What happened (evidence, prod, read-only)

Queries went through `npm run db:query:prod` (guard printed `aokhplydttxtebvbeuzc` each time).

| Fact | Value |
|---|---|
| Shop row created | 2026-10-09 09:27 UTC, Session Token Exchange install |
| History import | `complete` at 10:02 UTC, 22,930 orders, since 2010-01-01, `read_all_orders` |
| Orders stored | 22,938, first order 2025-03-26 |
| Disputes stored | 481 (Jun 2025 – Oct 2026); 3 `sync_disputes` jobs succeeded |
| `ratio_snapshots` rows (month records) | **0** |
| `shop_daily_metrics` rows | **0** (`shop_fraud_daily_metrics`: 534, correct) |
| Carrier lookups | ran on 26 of 22,090 shipments |
| Orders with a Shopify Protect status | 0 of 22,938 |
| `build_defence_package` jobs today | 14 succeeded, **12 failed** |

All installed prod shops, 2026-10-09:

| Shop | Installed | Month records | Daily-metric rows (earliest) | Succeeded `sync_disputes` jobs | First order |
|---|---|---|---|---|---|
| surasvenne | 2026-03-04 | 17 | 697 (2024-11-11) | 430 | 2024-11-11 |
| cay-collective | 2026-07-02 | 13 | 1,121 (2023-06-14) | 432 | 2023-06-14 |
| blume-box | 2026-07-20 | 13 | 3,037 (2018-05-24) | 429 | 2018-05-24 |
| 6a8848-dd | 2026-08-29 | 13 | 131 (2026-05-31) | 440 | 2024-04-23 |
| vkqq7k-d1 | 2026-10-08 | 2 (its whole window: Aug, Sep) | **1 (2026-10-08)** | 9 | 2026-08-23 |
| whj8db-1q | 2026-10-09 | **0** | **0** | 3 | 2025-03-26 |

**Measured (dry run, no writes):** `scripts/recompute-insights-months.ts --dry-run` computed this shop's 12 months in **67 s** (about 5.6 s per month) from a laptop. Every month: card chargebacks 0; September 0 / 489.

Nothing failed in the import. The page is empty because of what the page reads.

### 1.1 Root causes, per empty area

| # | What the merchant sees (September 2026, the default month) | Cause | Kind |
|---|---|---|---|
| G1 | Monthly chart: 12 empty columns, no average line, no text in the chart footer | `readTrend` reads month records only (`readTrend.ts:56-81`); the shop has none. Only the `calculate-ratios` cron (02:00 UTC) writes them, and it has not run since the install | defect (timing) |
| G2 | Every month in the selector except September opens as "Not available": no payment-method table, no protection block, no reasons, "No checkpoints for this month." | A closed month without a record is never computed on read (`readInsightsPeriod.ts:75`) | defect (timing) |
| G3 | Dispute reasons: the August and Change columns are "—" on every row | `readPreviousReasons` reads August's record (`reasonComparison.ts:70-86`) | defect (timing) |
| G4 | Badge "Provisional · final on 8 Oct" on 9 October | Live-computed months are always labelled provisional (`readInsightsPeriod.ts:82`) | defect (same cause) |
| G5 | The fulfilment-baseline checkpoint is absent | `computeShopMonth` reads last month's stored median (`computeShopMonth.ts:63-76`) | defect (same cause) |
| G6 | Self-heal takes four nights, oldest month first; August arrives 13 October | `SELF_HEAL_CAP = 3`, oldest first (`calculate-ratios/route.ts:19,133-141`) | defect (design) |
| G7 (adjacent, not on this page) | Dashboard chargeback rate and plan recommendation count 0 chargebacks | `enqueueShopDailyMetricsBackfill` is called only in the OAuth callback (`callback/route.ts:217`). Also affects `vkqq7k-d1` | defect (install path) |
| G8 | "Signed for at delivery: — · We can't see signatures from your carriers" | Carrier lookups run for disputed orders only | structural |
| G9 | "Shopify Protect: — Not measured yet" | No order carries a Protect status; "yet" promises a number that will not come | copy, design-owned |
| G10 | "3-D Secure 1.2%" (6 of 489) | Receipts carry 3DS on 88 of 6,608 card-network orders all-time. Low for a Swedish shop; not verified | follow-up probe |

Not empty, and correct: the payment-method table (Klarna 1,009 orders, 4 chargebacks, 37 inquiries), the card ratio (0 of 489), the win rate (39 of 39).

### 1.2 Why this was not caught
`docs/plans/insights-single-source.plan.md` changelog v2→v3 #14 deleted the planned materialize job in favour of cron self-heal. Existing shops were filled by a manual recompute during the rollout, so the first-install path never ran in prod until this week.

### 1.3 Token exchange starts less than OAuth does
Token exchange runs only `onNewShopCreated`, `registerDisputeWebhooks` and `persistShopCurrency` (`token-exchange/route.ts:221-242`). The OAuth callback also runs `registerOrderWebhooks` (`:176`), `ingestShopifyPolicies` (`:205`), `enqueueShopDailyMetricsBackfill` (`:217`), `registerWebPixel` (`:230`) and `enqueueShopOrdersBackfill` (`:260-267`). On this shop the order import started only because a page view hit the Insights route's self-heal (`initial-analysis/route.ts:548`).

### 1.4 Separate issue, out of scope
12 `build_defence_package` jobs failed today with `No letter: the template writer is retired and counsel v2 wrote none for credit_not_processed.` (Klarna disputes).

---

## 2. RALPLAN-DR summary

### Principles
1. **A closed month is read from its record, never computed on read.**
2. **One writer:** `persistShopMonth`.
3. **A shop's first records are written only after its dispute history has arrived.** Disputes drive the headline counts; a month marked final without them is worse than a missing month.
4. **Existing behaviour for shops that already have records does not change.** A shop whose statement-month predecessor has a record gets its statement month written first every night, as today.
5. **Reconcile from state; events only make it faster.** The cron reaches the same result if every event-driven job is lost.
6. **Design is a spec.** No new UI element or copy without the design owner's decision.

### Decision drivers
1. Correct before fast.
2. A whole first impression as soon as inputs allow, and no empty chart in between.
3. Smallest change that closes the class, plus a one-off repair.

### Options

| | **A″ (chosen): event-triggered job with a state check + cron as reconciler** | B: cron only, hourly | C: compute missing months on read |
|---|---|---|---|
| What | A job, enqueued by the three events that can complete a shop's inputs, writes the window when the first-materialization check passes; the nightly cron runs the same lib and check | Run the maintenance hourly for shops with no records | Read paths compute any missing month live |
| Time to whole | The worker tick after the last input lands | Up to 60 min after it | Immediate |
| Waiting logic | None: the handler exits when not ready; the next event re-enqueues it | None | None |
| Shop whose syncs keep failing | Forced write at the first 02:00 cron after hour 24 | Forced write at hour 24–25 | n/a |
| Cost | One job type, three one-line enqueues | No job type, but one 240 s budget shared by all shops (`calculate-ratios/route.ts:16`) | 12 live computes per view |
| Verdict | Chosen | Kept as the reconciler layer | Rejected: breaks principle 1 and email/page parity |

B is a fair option: no job type and state-driven. It loses on the shared budget and the wait. A″ is worth its extra job type only because it needs no polling loop, counter or delay: three events enqueue, one state check decides.

This reverses changelog #14 of the earlier plan.

---

## 3. Design

### 3.1 First-materialization check
`lib/insights/period/firstMaterialization.ts`: `canMaterializeFirst(sb, shop, now) → { ok: boolean; reason?: "import" | "disputes"; forced?: boolean }`. It applies **only to a shop with zero `ratio_snapshots` rows**.
- `import`: `historical_import_status = 'complete'` and `historical_import_completed_at` set.
- `disputes`: at least one `sync_disputes` job with `status = 'succeeded'` for the shop. The handler throws when a sync reports any error (`syncDisputesJob.ts:27-32`; GraphQL and per-dispute errors both feed it, `syncDisputes.ts:247-254,445-449`), so `succeeded` means a walk with no reported error. `shops.last_reconciled_at` is **not** used: it is stamped after failed and partial syncs (`reconcileSchedule.ts:72-78`, called unconditionally at `syncDisputes.ts:505-509`).
- Forced write: **only when the `disputes` condition fails** and `now − historical_import_completed_at > 24 h`, return `ok: true, forced: true`. A shop with a succeeded sync that is merely picked up late is `ok`, not forced, and raises no alert. The caller writes, inserts one `insights_ops_alerts` row (`alert_key = 'first_records_forced'`, `period_month` = the statement month) and, only if the row was inserted, emails support@disputedesk.app naming the shop and saying that its month records and daily metrics were computed without a successful dispute sync and must be recomputed once the sync is repaired.
- **Real bound:** nothing fires at hour 24 by itself. A shop whose syncs keep failing gets no event, so its forced write happens at the first 02:00 cron after hour 24: **24 to 48 hours** after import completion.
- The fraud rollup is not a gate. It feeds one share (`computeOperationalMetrics.ts:293-299`), and the job's priority places it after the rollup job (§3.3).

### 3.2 `maintainShopMonths` — the one maintenance routine
Extracted from `calculate-ratios/route.ts` into `lib/insights/period/maintainShopMonths.ts`, options `{ budgetMs: number }` — a duration from the start of the call, after which no new heal month is started. Returns `{ skipped?: "not_ready"; written: string[]; remaining: number }`; `remaining` counts every unwritten month, including the statement month.

1. **Check.** If the shop has zero records and `canMaterializeFirst` is not ok → return `{ skipped: "not_ready" }`. Nothing is written, and the day-9 alert is **not** evaluated for that shop (it has no statement month to judge; the `first_records_forced` alert covers a shop that stays stuck). A shop with at least one record skips this check entirely (principle 4).
2. **Daily-metrics backfill, before any month write.** If the shop has zero records (and step 1 passed), enqueue the forced daily-metrics backfill (§3.5), deduped on one queued or running. Because it happens before the first write, a slice that dies later cannot lose it; a slice that dies before it still sees zero records on retry.
3. **Statement month first, when its predecessor has a record.** If the month before the statement month has a record, or lies outside the trend window, write the statement month now, as today (`:127-128`). This is every existing shop, every night, including the 1st of a month. A heal that throws afterwards cannot cost the shop its statement month.
4. **Heals, oldest → newest**, stopping when `budgetMs` is used. The filter is today's, unchanged — no row, or old version, or `!stable_at && coverage !== "partial" && canMarkStable` (`:133-140`) — **without the cap of 3**. Each month reads its predecessor's stored median from a record written before it.
5. **Statement month last, only for a shop that did not get it in step 3**, and only when no heal months remain. This is a first materialization: its statement month is written once, after August exists, with the fulfilment baseline. If the budget cut the heals, the statement month waits for the continuation (the job's own, §3.3, or the one the cron enqueues, §3.4); the page stays on the in-progress card until then (§3.6).
6. Drift and the day-9 alert: unchanged, for shops that were not skipped. When this run did not write the statement month, the alert reads `stable_at` from its row; **if the statement month has no row and was not written in this run, the alert is not evaluated** (a first materialization still in progress is not "a month that failed to become final"). Drift's up to two computes are outside `budgetMs`, as today.

G6 is fixed by removing the cap: at the measured 5.6 s per month a 12-month window fits one 100 s job slice. A cron share is smaller (§3.4), which is why the cron hands an unfinished first materialization to the job.

### 3.3 Job `materialize_insights_months`
Handler `lib/jobs/handlers/materializeInsightsMonthsJob.ts`, registered in `app/api/jobs/worker/route.ts`. **Priority 95**: numerically above `sync_disputes` (50), `backfill_fraud_daily_metrics` (70), `backfill_shop_orders` (80) and `backfill_shop_daily_metrics` (90). Claiming is `priority asc` with one job per shop (`20260702150000_claim_jobs_stale_lock_reclaim.sql:126,139-146`), so it cannot take the shop's slot from a job it depends on.
- Calls `maintainShopMonths({ budgetMs: 100_000 })`.
- `skipped: "not_ready"` → return. No re-enqueue, no counter. The next event enqueues it again.
- `remaining > 0` and `written.length > 0` → enqueue a continuation unconditionally (the `backfillOrdersJob.ts:34-43` pattern). A slice that wrote nothing ends the chain.
- A throw (a month that cannot be computed) fails the job after its 3 attempts. On the last attempt (`job.attempts >= job.maxAttempts`, `claimJobs.ts:21-22`) the handler inserts one `insights_ops_alerts` row (`alert_key = 'materialize_failed'`, statement month), emails ops once and rethrows, so repeated re-enqueues by later syncs are not silent. A last attempt that dies by timeout is parked by the stale-lock reclaim without running the handler (`20260702150000_claim_jobs_stale_lock_reclaim.sql:73`), so no alert fires; the nightly cron is the reconciler for that case.

Enqueued from three places, each **only when the shop has zero records and `historical_import_status = 'complete'`**, deduped on "one already queued or running", each in its own try/catch so it can never fail the job that hosts it:
1. the import-completion branch (`backfillOrders.ts`, next to the fraud-rollup chain at `:311-325`);
2. the end of `handleSyncDisputes`, after its error check;
3. the end of `handleBackfillFraudDailyMetrics`.

Also at import completion: if the shop has an offline session and no `sync_disputes` job queued, running or succeeded, enqueue one (priority 50), once. It saves up to an hour; the hourly `sync-disputes` cron enqueues one anyway (`sync-disputes/route.ts:87-92`).

### 3.4 Cron `calculate-ratios` as reconciler
Per shop it calls `maintainShopMonths({ budgetMs })` with a **fair share**: remaining cron budget ÷ shops not yet processed. The start guard (`:72-75`) stays.

When `maintainShopMonths` returns `remaining > 0` and the statement month has no row, the cron enqueues one `materialize_insights_months` job (deduped on queued or running). The job finishes the window within the next worker ticks; the next night's cron is the fallback. Without this a cron-driven first materialization (lost job, or forced write) would leave the statement month for the following night, past the 48-hour page gate. With step 3 of §3.2, every record-holding shop's statement month is written at the start of its share, as today; a metrics-version bump then heals older months over several nights instead of starving later shops.

### 3.5 Daily-metrics backfill
- `enqueueShopDailyMetricsBackfill(shopId, { force })`: `force` bypasses the "rows exist" skip (`backfillShopDailyMetrics.ts:169-174`), which the 00:30 nightly snapshot row would otherwise trip. The handler always upserts the 90-day window (`:126-128`).
- New shops: enqueued in §3.2 step 2, when disputes are local. The cron runs the same step, so a lost job still ends with G7 fixed.
- The OAuth callback call (`callback/route.ts:217`) is kept for `!isNewShop` only (`isNewShop`, `:104,132`). On a new shop it would run before the first dispute sync and write 90 rows of zero chargebacks.
- Stated consequences: a new shop whose order import never completes gets no daily-metrics backfill, so its dashboard rate is empty rather than zero. A forced-write shop (§3.1) gets its daily metrics and month records computed without disputes; the `first_records_forced` email tells ops to re-run both after the sync is repaired.

### 3.6 Page: an "in progress" card until records exist (user decision, 2026-10-09)
The lean route (`?view=period`) adds **`recordsPending: boolean`**. True only when all three hold: `historical_import_status = 'complete'`; no `ratio_snapshots` row of any coverage exists for the statement month; `historical_import_completed_at` is under **48 hours** old (the forced-write bound of §3.1). When true the route does not run the live statement-month compute; the shop row is read before the period read for that (today the period read starts first, `route.ts:503-507` vs `:529`). It reads nothing beyond `shops` and `ratio_snapshots`.

The user's decision: do not show the month view until the analysis is ready; say that it is in progress. While `recordsPending === true` the page renders the same card component as the analyzing state (`page.tsx:98-119`) with its own copy, and nothing else:
- `fraudIntel.preparingTitle`: "Your analysis is in progress"
- `fraudIntel.preparingBody`: "Your order history is imported. We are now preparing your monthly figures. This page updates by itself when they are ready."

Both keys are added in all 6 locales in the same commit (`verify-i18n-parity.mjs`). While the card is shown the page re-fetches every 30 seconds and switches to the month view on the first response with `recordsPending` false. (The polling is the planner's reading of "do not show until the analysis is ready"; without it the card would only clear on reload.) The strict `=== true` keeps the demo fixture (`lib/demo/fetchShim.ts:343`) on the month view. After 48 hours the page behaves as today.

The import-still-running state (`historicalImportStatus !== "complete"`) keeps its existing card and copy.

### 3.8 Protect tile when no order has a Protect status (user decision, 2026-10-09)
`operational.protectShareByValue` is null exactly when no order of the month carries a Protect status (`protectCoverage.ts`). The note under the "—" changes from "Not measured yet" (`insightsPage.mProtectNotMeasured`) to **"No orders this month had Shopify Protect"**, in all 6 locales. The value stays "—". No layout change. The Swedish wording is proposed with alternatives for the user to pick before the commit.

### 3.7 Order import on token-exchange installs
**Add** `await enqueueShopOrdersBackfill(shopInternalId)`, inside its own try/catch, on the token-exchange success branch after `storeSession` and `announceNewShop` (`token-exchange/route.ts:221`), when the shop had **no prior offline session** (`!existing`, `:133`). Awaited, because the route warns that a floated call loses the race with the redirect (`:215-220`); it costs three small queries. "No prior session" rather than "new shop row", so that an exchange that failed after creating the row still starts the import on the retry. The helper skips when the import is complete or a job is queued (`backfillOrders.ts:429-450`).

The OAuth callback chain (`callback/route.ts:260-267`, which also serves scope upgrades) is untouched. Nothing is enqueued on the branches where no session was stored (`:156-180` and the catch, `:243-261`), so a failed exchange cannot push the import to `failed`.

---

## 4. Steps

### Step 0 — Repair now (prod data, forward-only)
Run from a clean checkout of `origin/master`.
1. Dry run (already done once): `node --env-file=.env.production.local --import tsx scripts/recompute-insights-months.ts --expect-ref aokhplydttxtebvbeuzc --shop whj8db-1q.myshopify.com --reason materialize --dry-run`. Pass: 12 lines; September `cb 0 settled 489`.
2. Apply: the same command without `--dry-run` (the script writes oldest → newest).
3. Canary read, `npm run db:query:prod`: for `period_month = '2026-09-01'`, `stable_at`, `metrics_version`, `operational_metrics->'byPaymentMethod'`, `operational_metrics->'byReason'`. Pass: `stable_at` set; version 4; the `klarna` row has 4 chargebacks and 37 inquiries; reasons sum to 41.
4. Page read ("page whole"): the `?view=period` response for the shop, read in the browser's Network panel through admin impersonation. Pass: all 12 `trend[i].periodState` ≠ `not_available`; `previousReasons.periodMonth = "2026-08-01"`; `period.periodState = "final"`. Then open the page: default month, March 2026, the reasons table.
5. Daily metrics, shop set printed above: **`whj8db-1q` and `vkqq7k-d1`**, nobody else. Canary first:
   `npm run db:query:prod -- "insert into jobs (shop_id, job_type, priority) select s.id, 'backfill_shop_daily_metrics', 90 from shops s where s.shop_domain = 'whj8db-1q.myshopify.com' and not exists (select 1 from jobs j where j.shop_id = s.id and j.job_type = 'backfill_shop_daily_metrics' and j.status in ('queued','running')) returning id"`
   Wait for the job to succeed, then read: row count, earliest date, and `sum(chargeback_count)` against `count(*)` of `phase = 'chargeback'` disputes initiated in the same 90 days. The dispute side counts `disputes.initiated_at` in UTC days, from the earliest row's date (inclusive) to the day after the latest row's date (exclusive). Pass: the two numbers are equal. Then the same for `vkqq7k-d1`.

**Forward-only:** `restoreRevision` cannot return a month to "no record". Acceptable: these are the records tonight's cron would write, from the same function, and both shops have succeeded dispute syncs. The daily-metrics upsert is idempotent.

**Approval:** steps 0.2 and 0.5 are prod writes on the two shops named here. They run only on the user's go for this plan.

### Step 0 result (executed 2026-10-09, 14:30–14:45 UTC)
- `whj8db-1q`: 12 month records written (Oct 2025 – Sep 2026), all version 4 and final, 12 log rows. September: Klarna 4 chargebacks and 37 inquiries, reasons sum to 41, the fulfilment-baseline checkpoint is present. The live `?view=period` response shows all 12 trend months `final`, the period `final`, and August as the previous-reasons month; the page renders the chart with bars and the "Final" badge.
- Daily metrics: `whj8db-1q` 90 rows (2026-07-11 → 2026-10-08), 3,688 orders, 4 chargebacks = 4 chargeback disputes in the window. `vkqq7k-d1` 90 rows, 1 order, 0 chargebacks = 0.

### Step 1 — `canMaterializeFirst` + `maintainShopMonths`; cron switched to it (§3.1, §3.2, §3.4)
Tests:
- `canMaterializeFirst`: import incomplete → `import`; no succeeded sync job → `disputes`; only failed sync jobs → `disputes`; 25 hours after completion with no succeeded sync → `ok, forced`; 25 hours with a succeeded sync → `ok`, not forced.
- `maintainShopMonths`:
  - zero records and not ready → zero `persistShopMonth` calls, no day-9 alert;
  - a shop with one record and no succeeded sync job → written as today;
  - first materialization, 12 missing → forced daily-metrics job enqueued before the first write; months written oldest → newest; statement month last, with the fulfilment baseline in its checkpoints;
  - first materialization cut by the budget → statement month not written, `remaining > 0`; the next call finishes and writes it once (one revision), whether or not the first call reached the predecessor;
  - first materialization cut by the budget on the 10th of a month → no `m1_not_stable` row;
  - one-month window, and a predecessor row of an old metrics version → statement month written first;
  - a write throws after 3 months → a retry still ends with exactly one forced daily-metrics job;
  - existing shop, heal throws → the statement month was already written;
  - existing shop on the 1st of a month (the new statement month has no record, its predecessor has) → statement month written first;
  - empty trend window → the statement month is still written;
  - forced → one alert row for the statement month, one email.
- Cron: a version bump on 6 shops → every shop's statement month is written in the same run; fair-share budget applied; a first materialization cut by the fair share → one `materialize_insights_months` job enqueued.
- `tests/api/cron/calculateRatios.test.ts` is **rewritten**: `:71-77` (cap 3) changes; `:68` (statement month first), `:106` (nightly rewrite) and `:110-122` (day-9 alert) must still hold for record-holding shops, so those cases get existing rows in the test world (today's `rows: []` world is a zero-record shop under this plan); the world also gains the job-table input.

### Step 2 — Job and its three enqueue points; forced daily-metrics backfill (§3.3, §3.5)
Tests: not ready → writes nothing and enqueues nothing; ready → 12 records and one forced daily-metrics job; continuation enqueued only when a slice wrote months and months remain; continuation slice does not enqueue the daily-metrics job again; last failed attempt → one `materialize_failed` alert; each of the three events enqueues only for a zero-record shop with a complete import, and a failing enqueue does not fail the host job; import completion enqueues one `sync_disputes` only with a session and none existing; callback on a new shop does not enqueue the daily-metrics backfill, on an existing shop it does.

### Step 3 — Page gate (§3.6)
Tests: `recordsPending` true only under the three conditions; a partial-coverage statement row → false; 49 hours → false; true → `computeShopMonth` is not called; the page shows the in-progress card with the new keys, polls, and switches to the month view when `recordsPending` turns false; the Protect note uses the new key text when the share is null;. `tests/api/insightsPeriodView.test.ts:76-83` (exact body) is **edited**; `:95` (lean path never reads the fraud rollup) must keep passing unchanged.

### Step 4 — Order import on token exchange (§3.7)
Tests: success branch with no prior session → one awaited enqueue; prior session → none; failed-exchange branches → none and status stays `not_started`; exchange fails, then succeeds on retry → one enqueue.

### Step 5 — Docs, same commits
`docs/technical.md`: § Ratio & Compliance (first-materialization check, job, cron order, forced-write alert, the in-progress state) and the install-path section. The embedded help article for the Insights page gains one line on the in-progress state. `docs/plans/insights-single-source.plan.md` (currently untracked) is committed with a note under changelog #14. 

### Step 6 — Verify (§5), then release
Branch → PR to `develop` → dev verification including the real install → PR to `master` → stop for the in-chat go.

### Not in this plan
- G8 signed-for coverage.
- G10: a read-only probe of 5 September direct-card receipts through `lib/shopify/receipts/threeDs.ts`. Done separately; no change follows without a decision.
- The rest of §1.3 on token exchange: order webhooks (the `session-health` cron registers them, `session-health/route.ts:170`), policies (ingested lazily, `policySource.ts:53`), web pixel (no other caller found).
- §1.4 failed defence packages.

---

## 5. Verification

Gates: `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify`.

**Pre-release, read-only, prod** (the only shops the new check can affect). Expected after step 0: no rows.
```sql
select s.shop_domain, s.historical_import_completed_at,
       (select count(*) from jobs j where j.shop_id = s.id and j.job_type = 'sync_disputes' and j.status = 'succeeded') as sync_ok
from shops s
where s.uninstalled_at is null and s.historical_import_status = 'complete'
  and not exists (select 1 from ratio_snapshots r where r.shop_id = s.id);
```

**Release gate on dev — one real token-exchange install.** Uninstall the dev app from a dev store, delete that shop's row on dev (`npm run db:query:dev`), install again, and do not open the Insights page until the import has completed. Record four timestamps: import complete, first succeeded dispute sync, first month record, page whole (the step 0.4 assertions). Pass: the order import started without a page view; the page shows the in-progress card until records exist, then switches to the full month view by itself; no month record is older than the first succeeded sync.

Shapes, each with the real page read (default month, one older month, the reasons table):

| Shape | Where | What is checked |
|---|---|---|
| 12-month, Klarna-heavy | `whj8db-1q` (prod, step 0) | 12 bars with counts, August column, "Final" badge |
| Short window | `vkqq7k-d1` (prod, read-only) | 2 months, no month before the first order, no regression |
| Fresh install, any volume | dev (the release gate above) | the whole chain and its timings |
| Zero disputes | dev shop | records with 0 chargebacks; card ratio where ≥ 50 orders |
| Large | `blume-box`, `--dry-run` only | wall time for 12 months against the 100 s slice |
| Not ready | dev shop, month records removed, no succeeded `sync_disputes` job, `historical_import_completed_at` set to now (otherwise the check is forced and the gate has expired), job enqueued by hand | job writes nothing; in-progress card; after a sync succeeds, records appear and the page switches |

**After release:** owner = this session. For each shop created after the release, query `historical_import_completed_at`, the first succeeded `sync_disputes` job's `updated_at`, `min(ratio_snapshots.revised_at)`, and record count against window length. The pass threshold is the dev run's "last input → first record" time plus one worker tick; until that run exists no number is claimed.

**Rollback:** revert the release. The new check only applies to zero-record shops, so shops with records are unaffected either way; records already written stay valid.

## 6. Open questions for the user
Answered 2026-10-09:
1. Step 0: **yes** — done, see "Step 0 result" in §4.
2. §3.6: do not show the page until the analysis is ready; show an in-progress message. Built as §3.6.
3. Protect tile: **yes**, change the copy. Built as §3.8.

Still open: the exact wording of the two in-progress strings and the Protect note (proposals in §3.6 and §3.8), and the Swedish variants.

## 7. Risks

| Risk | Mitigation |
|---|---|
| First records written before disputes arrive | `canMaterializeFirst` requires a succeeded sync job; test with only failed sync jobs |
| A shop never gets a succeeded sync (expired token, one bad dispute) | Forced write at the first 02:00 cron after hour 24 (24–48 h), with one ops alert; the page gate uses the same 48 h |
| The check stops existing shops' nightly records | It applies only to zero-record shops; test with a one-record shop and no sync job |
| Job starves the jobs it depends on | Priority 95, below all of them in claim order |
| Job and 02:00 cron write the same month | Advisory lock per (shop, month); no-op on equal hash (`20261003100000_insights_period_rows.sql:138,159-165`) |
| Continuation loops | Chain ends when a slice writes nothing |
| Removing the cap of 3 lets one shop use the cron's 240 s | Fair-share deadline per shop; statement month first for every record-holding shop; after a version bump older months heal over several nights |
| The forced daily-metrics backfill is lost when a slice dies | Enqueued before the first month write; retry test |
| A month that cannot be computed fails the job on every re-enqueue | One `materialize_failed` ops alert per statement month |
| A re-installed shop with zero records and an old succeeded sync passes the check on older disputes | Accepted: its next hourly sync and the nightly statement rewrite correct the statement month; older months need a manual recompute |
| A sync response with neither data nor errors reads as zero disputes (`syncDisputes.ts:257-267`) | Accepted; pre-existing |
| Page stuck on "analyzing" | 48-hour bound; the statement month is written in the run that completes the heals, and the cron hands an unfinished first materialization to the job |
| A first-materialization month that throws on every attempt blocks the statement month | Job path: `materialize_failed` alert. Cron-only path: the error is in the cron's JSON output; the page falls back to today's behaviour after 48 hours |
| Fraud rollup late or failed | Affects one share on the month; the statement month is rewritten nightly; older months keep the value until a manual recompute |
| Step 0 is forward-only | Same function and writer as tonight's cron; dry run and canary first; two named shops |

## 8. Changes across review rounds

| Finding | Resolution |
|---|---|
| v1: months and daily metrics written before disputes exist | First-materialization check; daily backfill at first materialization |
| v1: statement month before its predecessor; batch seams | Oldest → newest, statement month last, no cap |
| v1: self-requeue would cancel itself | Continuation unconditional; dedupe only at event enqueues |
| v1: empty page during the wait; unmeasured | Analyzing card; 67 s measured; real dev install as release gate |
| v1: Step 0 unreadable canary, vague set | Exact reads, two named shops, exact command |
| v2: `last_reconciled_at` is stamped on failed and partial syncs | Readiness = a succeeded `sync_disputes` job |
| v2: wait loop had no counter, delay or priority | No loop: three events enqueue, handler exits when not ready; priority 95; 24-hour state bound |
| v2: gate on the cron could drop existing shops silently | Check limited to zero-record shops; forced write and alert after 24 hours |
| v2: "move" the order-import enqueue dropped scope upgrades and broke failed exchanges | Added on the token-exchange success branch only; callback untouched |
| v2: statement month no longer always written; empty-window shop held 24 hours | Statement month always written (order refined in v4, §3.2) |
| v2: `historyReady` meant two things; pinned tests unlisted | Route field `recordsPending`, defined once; both test files listed |
| v3: uncapped heals with the statement month last could starve other shops' nightly statement month | Statement month first whenever its predecessor has a record; last only on first materialization; fair-share cron deadline |
| v3: forced daily-metrics backfill could be lost; day-9 alert undefined for a skipped shop | Enqueued before the first write; a skipped shop is not judged by the day-9 alert |
| v3: the "24-hour bound" had no trigger | Stated as 24–48 h; page gate aligned to 48 h |
| v3: token-exchange condition missed a failed-then-retried exchange; floated call | `!existing`, awaited |
| v3: event enqueues for shops whose import is not complete; silent repeated failures | Guard on a complete import; `materialize_failed` alert |
| v4: a cron-driven first materialization had no continuation; false day-9 alert on a cut run; `forced` fired for a late but healthy shop | Cron enqueues the job when months remain; alert not evaluated without a statement row; forced only when the disputes condition fails |
| v2: over-built | Cut: completion module, attempt counter, settling pass, seam re-touch, newest-first selection, fraud-rollup gate, 3-D Secure step |

## 9. ADR
- **Decision:** write a shop's month records from a job enqueued by the events that complete its inputs, guarded by a first-materialization check; run the same routine in the nightly cron without the cap of 3, under a fair-share budget; hold the page on an in-progress card until records exist; start the order import on token-exchange installs; repair the two affected shops with existing tools.
- **Drivers:** correct before fast; whole first impression; close the class.
- **Alternatives considered:** hourly cron only (shared budget, up to an hour); compute on read (breaks the record invariant).
- **Why chosen:** gated on the input that drives the headline numbers, fast without a polling loop, and the cron reaches the same state if the job is lost.
- **Consequences:** one job type and one check; the earlier "no materialize job" decision is reversed; new shops see "analyzing" until their first dispute sync succeeds; a shop with no successful sync gets its first records anyway within 24–48 hours, and an ops alert.
- **Follow-ups:** §1.3 remainder; §1.4; G8; G9; G10 probe.
