# Admin section repair — ledger

Plan: `admin-section-repair.plan.md`. One row per defect: symptom → evidence → root cause → status.
Sources so far: static audit + read-only prod measurement (`db:query:prod --read-only`, guard re-confirmed per command). No live sweep yet (needs the owner's signed-in admin session).

## Batch 1 — Overview, Billing, billing data (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 1 | Overview, Billing, Shops list | MRR / "Active Subscriptions" counted plan labels, not payment | Prod 2026-11-12: 5 shops; label MRR $516 (4×Growth); only 2 have `first_paid_cycle_started_at` → $258. 1 Growth shop has no `plan_entitlements` row; 1 `active` with a subscription GID has never had a paid cycle | MRR = `PLANS[shops.plan].price` | fixed (`paidSubscriptions.ts`) |
| 2 | Billing | "Active Subscriptions" and ARPS used all installed shops (free included) | `billing/route.ts` + page: `totalShops` = every installed shop | wrong denominator | fixed (Paying Subscribers, ARPU over paying shops) |
| 3 | Overview | Packs/jobs/shops totals freeze at 1000 | `evidence_packs`, `jobs`, open `disputes`, `shops` selected un-ranged (PostgREST cap) | no pagination; docs claimed "no LIMIT" | fixed (`fetchAllRows`, per-status job counts) |
| 4 | Shops list | Per-shop dispute/pack counts wrong past 1000 rows | un-ranged `disputes` / `evidence_packs` selects in `shops/route.ts` | same cap | fixed |
| 5 | Overview | Metrics failure leaves "Loading dashboard..." forever or crashes | `.then(r => r.json())` with no `ok` check, `.catch(() => {})` | swallowed error | fixed (error state + Retry) |
| 6 | Billing | Same swallowed-error/infinite spinner | no `ok` check, no catch | — | fixed |
| 7 | Overview | Plan distribution percentages used all shops incl. uninstalled | `total={metrics.shops.total}` vs installed-only buckets | wrong total | fixed |
| 8 | Overview | Health bar did not wrap on narrow widths | `flex gap-3` | — | fixed |
| 9 | Operations leaderboard, Billing table | Merchant shown as raw myshopify alias | `shop.domain` printed directly | no shared renderer | fixed for these two (`AdminMerchant`); remaining pages tracked below |

## Batch 2 — Operations, Disputes (this PR)

| # | Page / route | Symptom | Root cause | Status |
|---|---|---|---|---|
| 10 | Dispute detail | Timeline empty; "Add note" and "Resync" did nothing, no message | Page called merchant routes needing a Bearer role token; got 401/403 and ignored them | fixed: admin-gated routes `/api/admin/disputes/[id]/{timeline,notes,resync}` over shared `lib/disputes/internal/*` |
| 11 | Dispute detail | Page blanked to "Loading..." on every refetch; failed override/note/resync silent | `setLoading(true)` in refetch; no `res.ok` checks | fixed (alert banner; text kept on failed note) |
| 12 | Disputes list | Operations leaderboard link `?shop_id=` listed ALL shops | page never read `shop_id` | fixed (+ "Show all shops" chip) |
| 13 | Disputes list | Failed load showed empty table | no `res.ok` check | fixed (alert) |
| 14 | Operations | Metrics failure = infinite "Loading operations..." | swallowed error | fixed (error + Retry) |
| 15 | Disputes list | Merchant shown as raw alias | — | fixed (`AdminMerchant`, route returns `primary_domain`) |

## Batch 3 — Shops (this PR)

| # | Page / route | Symptom | Root cause | Status |
|---|---|---|---|---|
| 16 | Shops list | A failed load looked like "No shops found" | error body (object) coerced to `[]`; no `res.ok` | fixed (alert + title) |
| 17 | Shops list | No way to see paying / trial merchants | plan filter was the label only | fixed (billing pill, Paying / On trial filters) |
| 18 | Shop detail | Save Overrides never reported success or failure | response ignored | fixed (inline status message) |
| 19 | Shop detail API | `PATCH` wrote any string to `shops.plan`; bad body = 500 | no validation | fixed (PLANS check, integer limit, 400s) |
| 20 | Shop detail API | Plan override audited as `system`, no operator | `actorType: "system"` | fixed (`admin` + email) |
| 21 | Shop detail | Load failure = permanent "Loading..." | no `res.ok`/catch | fixed (error + back link) |
| 22 | Shop detail | Trial / paid status not shown | not in GET | fixed (`billing` in GET + header pill, trial end date) |
| 23 | Shop activity panel | Failed load showed "No recorded activity" | `.catch(() => setRows([]))` | fixed (error message) |

## Batch 4 — Jobs, Webhooks (this PR)

| # | Page / route | Symptom | Root cause | Status |
|---|---|---|---|---|
| 24 | Jobs | Page blanked (`jobs.map is not a function`) when the API errored | error body object fed to `.map` | fixed (ok check + alert) |
| 25 | Jobs | Retry/Cancel said OK when nothing changed; failures silent | status-guarded UPDATE matched 0 rows, route returned `ok:true`; page ignored response | fixed (409 + visible error) |
| 26 | Jobs, Webhooks | No indication which merchant a job/delivery belongs to | no shop column | fixed (Shop column via `AdminMerchant`) |
| 27 | Jobs | `cancelled` jobs had no filter | filter list lacked it | fixed |
| 28 | Webhooks | 24h totals/p50/p95 truncated at 1000 rows | un-ranged aggregate select | fixed (`fetchAllRows`) |
| 29 | Webhooks | Failed aggregate showed zeros ("no webhooks") ; failed list blanked loading | no `res.ok` handling | fixed |

## Batch 5 — Fraud Intel, Outcome Analysis (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 30 | Fraud Intel | Page analysed ~3% of orders | prod: 34,284 orders in the 90d window, page read <= 1000 | PostgREST row cap overrides `.limit(50_000)` | fixed (SQL aggregation RPC) |
| 31 | Fraud Intel | Every dispute rate read 0% | prod: `has_chargeback` set on 0 orders all time; 1,893 disputes, all joinable by `order_gid`; real window figure 299 disputed orders (0.87%) | disputes counted from a never-written flag | fixed (disputes joined via `order_gid`) |
| 32 | Fraud Intel | Signals lookup passed up to 1000 ids in a URL | — | `.in()` on a large id list | removed with the row pull |
| 33 | Fraud Intel | Parser-miss total capped at 1000 rows | un-ranged select of `occurrences` | row cap | fixed (`fetchAllRows`) |
| 34 | Fraud Intel | RPC/DB failure rendered empty tables | — | no error handling | fixed (banner) |
| 35 | Outcome Analysis | Merchant shown as raw alias | — | — | fixed (`AdminMerchant`) |

Finding for the owner (not a bug): in prod, 19,232 of 34,284 window orders have no AVS signal ("unknown") and distance/attempt count are unknown on essentially all orders, so those cuts say little until signal capture improves. 291 of the 299 disputed orders are in the AVS-unknown bucket.

**Promotion note:** migration `20261112120000_admin_fraud_intel_buckets.sql` is applied on dev only. Apply to prod (`aokhplydttxtebvbeuzc`) with the `master` promotion, before the page code deploys there.

## Batch 6 — Templates, Reason Mapping, Template Health (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 36 | Reason mapping PATCH, Templates PATCH | No audit trail for mapping/template changes, ever | prod: `audit_events.shop_id` NOT NULL; 0 rows for `reason_mapping.updated`; routes inserted without a shop and ignored the error | wrong table, unchecked insert | fixed (`admin_audit_events` + `logAdminAction`) |
| 37 | Reason mapping page | A rejected assignment (e.g. draft template) looked successful | route returns 400 + message; page discarded the response | no `res.ok` | fixed (message shown) |
| 38 | Templates list | Failed load read as an empty library | `Array.isArray(data) ? data : []` | error coerced to [] | fixed |
| 39 | Template detail | Unknown id or error body crashed the page | error object set as the template | no `res.ok` | fixed |
| 40 | Template detail | Status change failure silent | response ignored | — | fixed |
| 41 | Template health | Failure rendered as a clean "0 issues" page | `data?.issues ?? []` on an error body | no `res.ok` | fixed |
| 42 | Both PATCH routes | Malformed JSON body = 500 | `await req.json()` unguarded | — | fixed (400) |

**Promotion note:** migration `20261112130000_admin_audit_events.sql` is applied on dev only; apply to prod with the `master` promotion.

## Batch 7 — Defence Package (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 43 | Pipeline page | Sample-payload panel always "Could not load fixture" on Vercel | `fs.readFile(process.cwd()+"tests/fixtures/…")`; `outputFileTracingIncludes` has no entry for the route | file not in the serverless bundle | fixed (tracing include) — **verify on deploy** |
| 44 | Runs list, run detail | No merchant shown | `shop_id` selected but never rendered | — | fixed (`AdminMerchant`) |
| 45 | Dashboard | Failed telemetry read showed "0 runs · 0% OK" | `const { data }` with no error check | — | fixed (throw + banner) |
| 46 | Dashboard | 7-day stats would cap at 1000 runs | bare select | row cap | hardened (prod today: 33 runs/7d, not yet wrong) |

Checked, no defect found: prompt-module editor (checks `res.ok`, surfaces errors), prompts list, settings page, run telemetry PDF route.

## Batch 8 — Audit Log (this PR)

| # | Page / route | Symptom | Root cause | Status |
|---|---|---|---|---|
| 47 | Audit page | Typing a shop id crashed the page | every keystroke queried Postgres; a partial UUID → 500; page called `.map` on the error object | fixed (debounce, 400 validation, ok check, error banner) |
| 48 | Audit page/route | Merchant shown as a raw UUID; could only filter by UUID | — | fixed (domain filter, `AdminMerchant`) |
| 49 | Audit page | Operator who acted was never shown | `actor_id` not selected/rendered | fixed |
| 50 | Audit CSV | Columns shifted on any comma; spreadsheet formula injection from merchant-controlled payload text | values joined with raw `,` | fixed (`lib/admin/csv.ts`) |
| 51 | Audit page | Claimed to be the "complete forensic trail of all admin operations" but showed no platform-wide actions | read `audit_events` only | fixed (merges `admin_audit_events`; subtitle corrected) |
| 52 | Audit route | Silent 500-row cut-off | `.limit(500)` unannounced | fixed (`truncated` + notice) |

| 53 | Playbook / Winnability leads CSV | Cells starting `= + - @` executed as formulas when opened in a spreadsheet; `email`/`store` come from public forms | quoted but not neutralised | fixed (shared `csvCell`) |

Known, not changed: both lead lists load at most 1000 rows (`limit(1000)`), so the export is the loaded rows, not necessarily all leads; the stats cards use exact counts.

Note: `GET /api/admin/audit` response shape changed from an array to `{ events, limit, truncated }`; the audit page was its only caller.

## Batches 9-11 — Resources, Signal Radar, Team, Passkeys (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 54 | Team API | Admin grants / deactivations / revocations not audited | no audit calls | — | fixed (`team.*` events) |
| 55 | Team PATCH | Unknown user answered 500 | `.single()` errors before the 404 branch | — | fixed (`maybeSingle`) |
| 56 | Team DELETE | Reported success for a user that did not exist | no row check | — | fixed (404) |
| 57 | Team page | Failed load showed an empty admin list; failed (de)activate ignored | no `res.ok` | — | fixed |
| 58 | Passkey revoke | Not audited | — | — | fixed (`passkey.revoked`) |
| 59 | Signal Radar `/all` | "Recurring phrases" read 1000 rows while asking for 2500 | `.limit(2500)` capped by PostgREST | row cap | fixed (`fetchAllRows`, capped at 2500) |
| 60 | Resources generation stats | Failed read = zero generated / 0% acceptance | error ignored | — | fixed (throws) |

Audited, no defect found: Resources hub (client code checks `res.ok`; tables are small — 72 content items, 219 queue rows, 251 archive items on prod — so the 1000-row cap does not bite; covered by existing route tests and an e2e spec), Signal Radar client components (their empty `catch {}` blocks only wrap `sessionStorage`, the correct pattern), Passkeys page and routes (checked responses; last-passkey lock-out guard; existing tests), Help.

## Follow-up — Overview 500 on dev (found by the owner)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 61 | Overview `/api/admin/metrics` | 500 "column evidence_packs.dispute_type does not exist" on dev after batch 1 | Vercel runtime log; column absent on dev AND prod | the select named a nonexistent column; the old code ignored the error so the Overview's pack-based KPIs (automation success, save rate, top blockers, failing types) were silently 0/empty everywhere, and batch 1's paged read exposed it | fixed (`packHealth`, dispute reason via `disputes`) |
| 62 | Overview | Status lists missed `saved_to_shopify_verified` (124 prod packs), `save_failed` | prod status counts | status names drifted from the code | fixed |

Regression I introduced: batch 1 replaced an ignored-error read with one that throws, which turned this latent bug into a visible 500 on dev. Verified before this fix that every other column my batches select exists on dev and prod (only `disputes.primary_domain` was absent, and that was a mistake in the check list: the API derives it from the `shops` join).

Definition to confirm: the save rate counts packs parked in `ready` (awaiting approval) as not-yet-saved, so it reads ~24% on prod. That is the pre-existing formula; say if you want parked packs excluded.

## Follow-up — browser pass on dev (2026-11-12, owner's session)

Every admin page loaded without console errors on dev; interactive checks passed (audit filters incl. partial id and domain, dispute detail timeline + add note, Shops filters, pipeline sample payload now renders — confirming the tracing fix). Found and fixed:

| # | Page | Symptom | Root cause | Status |
|---|---|---|---|---|
| 63 | Shop detail | "Total invoiced $387" for a shop that never paid | plan price x window (label-based) | fixed (`invoicedDays`, "No payment recorded") |
| 64 | Overview | 8 KPI cards wrapped 6 + 2 on the 6-column grid | I added 2 cards in batch 1 | fixed (4 columns) |

Two test notes ("Admin sweep test note - safe to delete", "second test note") were added to dev dispute `3c67cfb1-cf39-4db7-a455-9f6700ba7129` while testing; there is no delete path for notes.

- **#65 Top bar bell:** clicking did nothing and the red dot was always on (hard-coded). A decorative placeholder from the design with no handler. Fixed: `AdminNotifications` + `/api/admin/notifications`.

- **#67 Top bar search:** was a read-only placeholder. Now a multi-search over shops, disputes, templates and jobs (`AdminSearch` + `/api/admin/search`).
- **#66 Fraud Intel on prod, first load after release:** "canceling statement due to statement timeout". The new RPC took ~2.9 s on prod data (dev has no orders, so it looked instant) and a cold call crossed the 8 s limit. Fixed with `20261112140000` (single `GROUPING SETS` pass, ~1.3 s, output verified identical); applied to dev and prod. Lesson: time admin aggregates on prod-sized data before release.

## Merchant display (R2) — closed

Every admin page now prints a merchant as storefront domain with the myshopify alias beneath (`AdminMerchant`): Overview/Operations (leaderboard + recent events), Disputes, Shops (reference), Shop detail, Jobs, Webhooks, Billing, Audit, Outcome Analysis, Defence Package runs, Gorgias (3 tables), Intelligence (picker label `domain (alias)`). `tests/unit/adminMerchantDisplayGuard.test.ts` fails if a page renders a bare `shop_domain` as JSX text outside a documented allowlist (the renderer, the delete dialog, the Shops list, the shop-detail header).

## Open — to confirm
- Prod entitlement row `active` + subscription GID + no `first_paid_cycle_started_at` (1 shop): genuinely never charged, or `sendFirstPaidCycleEmail` never fired? Currently shown as `unconfirmed`, not revenue. Needs owner's knowledge of that merchant.
- Prod shop on Growth label with no `plan_entitlements` row (1 shop): onboarding gap (cf. memory: token-exchange installs skipped entitlement grant).

## Status

Static audit + read-only prod measurement complete for every admin page: batches 1-11 shipped to `develop` (PRs #1135-#1144; #1144 = Team / Passkeys / Resources / Signal Radar). Class sweep: no unchecked `r.json()` chains remain in `app/admin` or `components/admin`; remaining empty `catch` blocks only wrap `sessionStorage` or a cosmetic header fetch.

### Still open (needs the owner)
- **Live sweep (Phase 3):** click-through of every page on dev with console + network capture. Needs a signed-in dev admin session (passkey gate). Nothing here has been verified in a browser.
- **Prod migrations** (apply with the `master` promotion, before the code deploys there): `20261112120000_admin_fraud_intel_buckets.sql`, `20261112130000_admin_audit_events.sql`. Applied to dev only.
- **Verify after deploy:** `/admin/defence-package/pipeline` shows a sample payload (tracing include added; not testable locally).
- **Two shops labelled Growth with no payment record** (see "Open — to confirm"): owner to say whether they should be paying.
- **Known, unchanged:** Playbook / Winnability lead lists load at most 1000 rows, so their CSV export is the loaded rows.
- **Production release:** nothing has been merged to `master`; promotion needs an explicit go per change (CLAUDE.md #9).
