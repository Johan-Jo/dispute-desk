# Admin section repair — evidence-led sweep (FINAL v4 (Critic: ITERATE on v3, 5 fixes applied; execution still pending approval), pending approval)

Status: pending approval. Nothing in this plan has been executed.

## Problem
The internal admin (`/admin/*`: 45 `page.tsx` files, 42 excluding the 3 bare gate pages; 66 `app/api/admin/**/route.ts`; ~16.7k lines of page code) has "a very high amount of bugs and non-functioning things". No bug list exists. Work starts at Overview (`app/admin/page.tsx` → `/api/admin/metrics`) and covers every page.

## User requirements (verbatim intent)
R1. Work page by page, Overview first; loop until every section is operable; push to `develop` sequentially.
R2. Everywhere a merchant is shown, print it like the Shops list: storefront domain (e.g. `hemochtrend.se`) with the myshopify alias (`whj8db-1q.myshopify.com`) beneath.
R3. Pay particular attention to paying subscribers and merchants on trial.

## Facts established (verified read-only)
- All 51 literal `fetch("/api/admin/...")` targets in `app/admin` resolve to a route. One dynamic `fetch(path)` at `app/admin/resources/settings/settings-client.tsx:236` is unchecked. All 23 ADMIN_NAV entries have pages. So "dead endpoint" is NOT the bug class; bugs are response-shape, data, and behaviour.
- Gate: `middleware.ts` `/api/admin/*` block (~:214) and `/admin` page block (~:594) (line numbers to re-pin): Supabase session + `internal_admin_grants` + signed passkey cookie. `/api/admin/passkeys/*` is exempt by prefix and self-gates (`passkeys/[id]/route.ts:15`).
- Merchant display: `displayShopDomain()` is the single read path (commit `6ced1ba1`, `shops.primary_domain`, falls back to alias). Shops list renders domain + small grey alias. Other pages (`disputes`, `gorgias`, `intelligence`, `shops/[id]`) read `shop_domain` directly; `/api/admin/billing` and `/metrics` select only `shop_domain`.
- Subscription state: `shops.plan` is the only signal read by `/api/admin/shops`, `/billing`, `/metrics` (MRR via `PLANS[plan].price`). None of these routes mention trial. Likely MRR/plan counts treat trialing shops as paying. To be confirmed (find where trial/subscription status is stored; `app/api/billing/callback`).
- Admin test coverage: passkeys, resources routes, webhooks route, shop purge route, 3 middleware integration tests, 1 Playwright spec. Nothing for Overview, Disputes, Shops list, Jobs, Operations, Billing, Team, Audit.
- Dev data is sparse; prod holds the representative data (CLAUDE.md #0/#9: no prod writes; no master merges without per-change in-chat go).

## Principles
1. Evidence before edits: a bug is a reproduced failure recorded in the ledger (symptom, evidence, root cause, status).
2. Fix the class: shared building blocks are created BEFORE batch 1 (see Phase 0).
3. Smallest correct diff per page; no redesign.
4. One batch per PR to `develop`, merged and re-verified before the next.
5. Prod is read-only evidence only. Verified: every admin POST is behind a click (no mount-effect writes), so the USER may load prod admin pages for GET-only inspection; the agent never clicks anything on prod and never uses the never-click controls anywhere. Prod DB reads only via `npm run db:query:prod`, guard re-confirmed per command.
6. Paying and trial merchants are first-class: their data correctness outranks everything else.

## Decision drivers
1. Dev data is unrepresentative; bugs are data/behaviour bugs.
2. Passkey gate: only the user can pass it.
3. Destructive admin actions exist; a sweep can hurt real data.

## Options
A. Static audit only — misses runtime/data defects.
B. Live dev browser sweep only — sparse data hides the bugs the user means.
C. **Evidence-led hybrid (chosen)**: three discovery sources feeding one severity-ranked ledger: (i) user's symptom list, (ii) Vercel runtime errors/logs for `/api/admin/*` on dev AND prod (read-only, data-representative), (iii) static response-shape/state audit + live dev sweep to reproduce and verify. Batches ordered by severity, with Overview first as the user asked.
Invalidated: build a new admin e2e harness first (too large); static endpoint-existence check (already passes).

## Phases
**Phase 0 — Foundations (no behaviour fixes before ledger evidence).**
 a. Worktree off `origin/develop` in `.claude/worktrees/`; ledger file `docs/plans/admin-section-repair.ledger.md` listing every control on every page with status (verified / broken / disabled-with-reason).
 b. Fixed audit list. "Paying" = `subscription_state='active' AND shops.plan <> 'free' AND shops.uninstalled_at IS NULL` (the column DEFAULTS to `'active'` and the migration backfill sets cycle-less rows to `active`, so a bare `active` filter pulls in free/uninstalled shops); record row counts before and after the filter. "Trial" = `trialing` (+ `grace`) on installed shops. Pulled pulled by `db:query:prod` read-only from `plan_entitlements` joined to `shops`; these are the named shops checked on every page. Ledger #1 = measured MRR/plan-count miscount vs Overview.
 c. Never-click list and expected-empty baseline recorded.
**Phase 1 — Discovery.** (i) User's symptom list (hard input; proceed on other sources if none). (ii) Vercel `get_runtime_errors`/`get_runtime_logs` for `/api/admin/*`, dev and prod. (iii) Static response-shape/state audit incl. `settings-client.tsx:236`. (iv) Live dev sweep via Chrome in the user's signed-in session; per-page console + network capture saved as the sweep artifact. If the user loads prod pages (GET only), same capture.
**Phase 1.5 — Shared pieces, each its own small PR (only after ledger shows need).**
 - PR-R2: `AdminMerchant` component (storefront domain line 1, alias line 2, via existing `displayShopDomain()`), `primary_domain` added to every `/api/admin/*` route returning merchants. Guard test (vitest, regex over `app/admin/**` and `components/admin/**` source): fails on any `{...shop_domain}`, `{...shopDomain}` or template-string `${...shop_domain}` occurrence rendered as text/attribute label, outside an allowlist of `AdminMerchant.tsx`, `displayShopDomain` and non-display uses (query keys, `href`/API paths, search filters). Starting allowlist is generated from the first run and reviewed in the PR; every remaining entry carries a comment.
 - PR-R3: reuse/extend `lib/billing/subscriptionState.ts` (no second source of truth); Overview/Billing/Shops/Metrics derive paying vs trial vs free from `plan_entitlements.subscription_state`; MRR counts only paying shops as defined in Phase 0b (active, non-free, installed), excluding rows `last_reconciled_at` shows the reconciler no longer reaches (`grace` decision recorded in ledger from data); trial pill + `trial_ends_at` shown.
 - PR-fetch: shared admin fetch/error helper, adopted per batch only.
**Phase 2 — Fix loop. Overview stays batch 1 (R1); from batch 2 onward order is by ledger severity, paying/trial-affecting bugs first, otherwise the default order below:**
 1 Overview + metrics · 2 Operations, Disputes (+detail/override) · 3 Shops (+detail, messages, risk) · 4 Jobs, Webhooks · 5 Fraud Intel, Intelligence, Outcome Analysis · 6 Templates, Reason Mapping, Template Health · 7 Defence Package (all subpages) · 8 Audit, Billing · 9 Resources hub · 10 Signal Radar, Gorgias, Playbook/Winnability Leads, Help · 11 LAST: Team, Passkeys (a bad fix can lock out the sweeping session; keep a second passkey enrolled first).
 Per batch: reproduce → fix → regression test if logic-bearing → `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify` + docs/technical.md update in the same PR → PR to `develop` → merge (auto-merge OK on develop) → re-verify on dev deploy → ledger → next.
**Phase 3 — Exit.** Full re-sweep; the acceptance gate is: ledger has zero open items and every page's console/network is clean except baseline-expected empty states. If 3 re-sweeps pass without reaching the gate, stop and report (that is a failed exit, not a pass). Max 3 re-sweeps; any leftover is listed in the final report with owner decision needed, never silently dropped.
**Docs** (not a separate phase; part of every batch PR): `docs/technical.md` admin section (merchant-facing help not needed unless merchant UI changes).

## Never-click list (sweep and verification)
`shops/[id]` DELETE (permanent purge), `passkeys/[id]` DELETE, `team/[id]` revoke, `resources/reset-and-rebuild`, `resources/publish-repair`, `resources/generate*` (LLM spend), `resources/send-test-email` (real email), `signal-radar/refresh`, `resources/cron/*`, `backfill-inquiry-pairs`, impersonation mint, jobs retry/requeue, webhook replay, `disputes/[id]/override` on real data, impersonation write mode. Exercised only against disposable dev records or via unit tests with mocks.

## Acceptance criteria
- Every nav page loads with no console errors and no failed network calls on dev (baseline-expected empty states excepted).
- Every control works, or is removed/disabled with a reason.
- Every `/api/admin/*` fetch has a visible failure path.
- Every merchant reference in admin renders domain + alias via `AdminMerchant`; guard test enforces it.
- Paying and trial merchants (fixed named list from Phase 0b): correct state pill and `trial_ends_at`; MRR excludes non-`active`; usage vs pack limit correct; their dispute, job, webhook, billing rows match the DB (`db:query:dev`/`db:query:prod`, guard re-confirmed per command, ref printed).
- Ledger lists every control on every page; none left unverified. Exit sweep artifact = per-page console + network capture.
- `npm test`, `tsc`, `build` green per PR; all merged to `develop`; nothing to `master` without a separate in-chat go.

## Risks
Sparse dev data (mitigated by Vercel logs + read-only prod queries); destructive actions (never-click list); lock-out (Passkeys/Team last); scope creep (ledger-only); MRR rule for `grace` is a product decision (default: not revenue; confirm); concurrent sessions (worktree).

## Open questions for the user
1. Known symptoms / worst pages first?
2. Sign in to dev admin in Chrome for the live sweep?
3. Confirm MRR should count only `active` subscriptions (trialing/grace/expired excluded).
