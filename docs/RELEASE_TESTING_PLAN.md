# Release Testing Plan

Repeatable verification process before any larger update is promoted to production
(Vercel `master`). Owner: maintainer. Last reviewed: 2026-05-06.

> **Highest-risk uncovered area as of this review:** the browser-driven
> review → submit → save-to-Shopify flow. Route-level gates and per-family
> payload composition are now locked in CI (see §4 row 9), but no
> Playwright spec exercises a merchant clicking "Save to Shopify" against
> a stubbed Shopify endpoint. The blocker is a Shopify test-mode session
> bridge for the embedded app — see §12 for what landed and what's next.

---

## 1. Why this exists

DisputeDesk automates Shopify chargeback evidence. A bad release can silently:

- break Shopify embedded auth (merchant locked out)
- corrupt evidence pack generation (wrong fields written to Shopify)
- regress evidence strength classification (auto-save gate misfires)
- bypass billing/quota checks (free usage on paid plans)
- break the dispute sync pipeline (missed deadlines)

The cost of a regression in any of those areas is high — merchant trust, refund
liability, App Store review escalation. This plan defines the standard checks
that must pass before any "big update" lands on `master`.

---

## 2. Current test setup (snapshot)

| Layer | Location | Command | What it covers |
|---|---|---|---|
| Type safety | repo-wide | `npx tsc --noEmit` | Strict TS, no emitted output |
| Lint | repo-wide | `npm run lint` (eslint.config.mjs) | Style + a11y + Next rules |
| Unit + API integration | `tests/**/*.test.ts`, `lib/**/__tests__/*.test.ts`, `lib/**/tests/*.test.ts` | `npm test` (`vitest run`) | ~70 files: API routes, automation, packs, argument engine, encryption, Shopify scopes, field mapping |
| Coverage (scoped) | `lib/automation/**`, `lib/packs/**`, `lib/shopify/**` | `npm run test:coverage` | Hard-gated business logic |
| E2E | `e2e/*.spec.ts` | `npm run test:e2e` (Playwright on port 3099) | 3 specs: portal sign-in + sections, portal setup checklist, admin Resources Hub |
| Smoke (DB pipeline) | `scripts/smoke-test.mjs` | `node scripts/smoke-test.mjs` | Seeds a dispute, runs pipeline, asserts state via `pg` |
| Smoke (Resources Hub) | `scripts/smoke-resources-hub.mjs` | `npm run smoke:resources-hub` | Hub publish + retrieval |
| Golden fixtures | `tests/golden/` | `npm run test:golden` | Locks engine outputs (coverage, fatal-loss, case strength, Shopify field mapping) for 5 canonical dispute scenarios. Pure-function — no I/O. Also runs as part of `npm test`. |
| Visual regression | `e2e/visual/` | `npm run test:visual` | Single-page baseline today (`/auth/sign-in`). See `e2e/visual/README.md` for scope and how to add more. |
| Build | repo-wide | `npm run build` | Next.js production build |
| Security audit | repo-wide | `npm audit --audit-level=critical` | Critical CVEs only |
| Forbidden-copy guards | source + translations | CI grep steps | "submit response" copy, canonical category writes outside registry, vague summary copy, deprecated relevance pills |

**CI today (`.github/workflows/ci.yml`)** runs all of: typecheck, lint, vitest,
audit, 4 grep guards. It does **not** run E2E, the DB smoke, or the build. Build
is run locally per CLAUDE.md. E2E requires `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`
in `.env.local` and a connected shop.

**Folder reality vs. proposed structure:**

- Existing: `tests/unit/`, `tests/api/`, `tests/contract/`, `tests/integration/setupFlow.test.ts` (lone file), `lib/**/__tests__/`, `e2e/`.
- Proposal does **not** rename or move existing tests — that's churn. New
  integration tests should land in `tests/api/` (existing convention) or
  `tests/integration/` (mostly empty, available for non-route integration).

---

## 3. Mandatory automated checks

These run on every release candidate, no exceptions. Any failure is a release
blocker unless explicitly accepted (see §10).

```
npm ci                             # clean install — guarantees lockfile parity
npx tsc --noEmit                   # type errors
npm run lint                       # ESLint
npm test                           # vitest run — all unit + API integration
npm run build                      # Next.js production build
npm audit --audit-level=critical   # only critical CVEs block
```

**Aggregate command** (added to `package.json` — see §11):

```
npm run release:verify
```

Equivalent to chaining the five commands above. Runs locally on PowerShell or
bash. Use this before tagging a release branch or merging a "big update" PR.

---

## 4. Critical regression test areas

Each row maps a critical area to existing coverage and gaps. "Gap" rows are the
backlog of tests to add over time — they do **not** need to be filled before
this plan goes into use. The release checklist (§9) includes a manual-verify
step for any gap row.

| # | Area | Existing automated coverage | Gap / manual step |
|---|---|---|---|
| 1 | Shopify embedded app loads | `tests/unit/sessionToken.test.ts`, `tests/unit/shopifyScopes.test.ts` | **Manual:** open `/app` from Shopify Admin, confirm App Bridge handshakes (no console errors) |
| 2 | Auth/session handling | `tests/unit/sessionToken.test.ts`, `tests/api/auth/confirm-route.test.ts`, `e2e/portal-sections.spec.ts` (portal sign-in) | **Manual:** install on a fresh dev store, complete OAuth, verify online + offline session rows in Supabase `shopify_sessions` |
| 3 | Dispute list loads | `tests/unit/syncDisputesNewAlertDedupe.test.ts` | **Manual:** open `/app/disputes`, confirm desktop table + mobile cards render with seeded data |
| 4 | Dispute detail page loads | `tests/api/packs/packDetailRoute.test.ts`, `tests/api/disputes/...` | **Manual:** open `/app/disputes/[id]`, confirm Overview / Evidence / Review&Submit tabs render without runtime errors |
| 5 | Evidence pack generation | `lib/packs/__tests__/generateEvidenceAttachmentPdf.test.ts`, `lib/packs/__tests__/checklistReconcile.test.ts`, `lib/packs/sources/__tests__/*` (3DS, coverage, device/location) | `scripts/smoke-test.mjs` for the full pipeline (requires live Supabase) |
| 6 | Evidence strength classification | `lib/argument/__tests__/canonicalEvidence.test.ts`, `caseStrength.test.ts`, `categoryBadge.test.ts`, `classifyEvidenceRow.test.ts`, `lib/automation/__tests__/{completeness,autoSaveGate,fatalLoss,pipelineMatrix}.test.ts` | **Manual:** spot-check a fraud / INR / refund_issued case in staging — strength label and `heroVariant` match expected matrix |
| 7 | Evidence field mapping → Shopify | `tests/unit/fieldMapping.test.ts`, `tests/unit/shopifyDisputeEvidenceFileConstraints.test.ts`, `tests/unit/evidenceSectionsUsedInDefense.test.ts`, `tests/contract/shopifyDisputes.test.ts` | **Manual:** save a pack to Shopify in staging, open the dispute in Shopify Admin, confirm evidence appears in the expected field per reason (uncategorizedText for fraud, etc.) |
| 8 | File upload permissions/flow | `tests/api/files/samples.test.ts`, `tests/api/files/samplesDelete.test.ts` | **Manual:** upload a real PDF + image in staging, confirm it lands in the private bucket and shows in the pack |
| 9 | Review/submit flow | `tests/api/packs/failedPackGuards.test.ts` (404/409), `tests/api/packs/saveToShopifyRoute.test.ts` (422 gates + 202 happy path + audit + jobs.insert + status flip), `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts` (per-family payload composition) | **Manual:** end-to-end on a staging dispute — Overview → Evidence → Review & Submit → Save to Shopify; confirm `packs.status` transitions and audit row written. The browser-driven E2E is still missing (see §12). |
| 10 | Dashboard metrics | (no dedicated test) | **Manual:** open `/app` overview after seeding disputes, confirm KPI cards (open / under review / saved) match `disputes` rows |
| 11 | Billing / plan restrictions | (no dedicated test) | **Manual:** with a free-plan shop, attempt a paid action (e.g. exceed pack quota); confirm `lib/billing/checkQuota.ts` blocks and surfaces the correct CTA |
| 12 | Resources Hub (locale parity) | `npm run audit:hub-locales:fail`, `npm run smoke:resources-hub` | Run both before any hub-content-bearing release |
| 13 | DB migrations | n/a | Per CLAUDE.md non-negotiable: agent runs `npm run db:migrate` in same session as the migration file. Verify on staging before prod |

---

## 5. Test levels and where each lives

| Level | What goes here | Path |
|---|---|---|
| **Unit** — pure functions, no I/O | parsers, classifiers, scoring, encryption, narrow helpers | `tests/unit/`, `lib/**/__tests__/` (colocated, preferred for new code) |
| **Integration** — API route or server-action with mocked Supabase / Shopify | route handlers, pack builders touching multiple sources | `tests/api/` (existing), `tests/integration/` (available for non-route integration) |
| **Contract** — Shopify response shape lock | `tests/contract/` |
| **E2E** — real browser, real Next dev server | portal sign-in, dispute list/detail, save-to-Shopify happy path | `e2e/` |
| **Smoke** — live Supabase, end-to-end pipeline | full automation pipeline, hub publish | `scripts/smoke-*.mjs` |
| **Manual checklist** — anything that can't safely be automated yet (Shopify Admin OAuth, App Bridge load, Shopify-side evidence save inspection) | `docs/release-checklists/` per-release files (see §6 + §9) |

**Conventions for new tests:**

- New colocated unit tests go in `lib/<area>/__tests__/<fn>.test.ts`.
- New API route tests mirror the route path under `tests/api/`.
- New E2E specs land in `e2e/<feature>.spec.ts`. Keep them resilient — selectors
  by `data-testid` or accessible role, never by class name. Read sign-in
  credentials from env, never hardcoded.

---

## 6. The "big update" rule

A change is a **big update** — and must run the full release verification — if
it touches any of:

- **Auth:** `lib/shopify/sessions/**`, `lib/supabase/**`, `app/api/auth/**`, `middleware.ts`, OAuth scopes (`shopify.app.toml`, `SHOPIFY_SCOPES`).
- **Shopify API:** any GraphQL query under `lib/shopify/**`, contract tests, webhook handlers (`app/api/webhooks/**`).
- **Evidence generation:** `lib/packs/**`, `lib/argument/**`, `lib/automation/**`.
- **Evidence scoring:** `lib/argument/canonicalEvidence.ts`, `caseStrength.ts`, `categoryBadge.ts`, `classifyEvidenceRow.ts`, anything imported by them.
- **Submission / save-to-Shopify:** `app/api/packs/[packId]/save-to-shopify/**`, `lib/packs/buildPack.ts`.
- **Billing:** `lib/billing/**`, `app/api/billing/**`.
- **Database schema:** any new file under `supabase/migrations/`.
- **Dashboard metrics:** `app/(embedded)/app/page.tsx` or anything under `lib/automation/` that feeds it.
- **Core UI flows:** `app/(embedded)/app/disputes/**`, `app/(portal)/portal/**` top-level routes.

A change that only touches docs, marketing pages, copy in `messages/`, or
lower-impact areas (e.g. resources hub) follows the **standard** path — only
§3 mandatory checks, no manual checklist required.

If in doubt: run the full plan. The cost of running it is low; the cost of
shipping a regression in one of the listed areas is high.

---

## 7. Release checklist (per release)

For every "big update" release, copy
`docs/release-checklists/TEMPLATE.md` to a dated file under
`docs/release-checklists/YYYY-MM-DD-<short-name>.md`, fill it in as you go, and
commit it alongside the release tag.

The template covers:

1. **Commands to run** (from §3 + relevant smokes).
2. **Staging verification** — the manual rows from §4 that apply to this
   change. Cross out N/A rows; do not silently skip.
3. **Screenshots / logs to inspect:**
   - Vercel deploy log for the staging build (no warnings about missing env).
   - Browser devtools console on `/app` (no red errors after App Bridge load).
   - Supabase Logs → recent `packs`, `jobs`, `audit_events` rows from the test
     dispute.
   - Shopify Admin → dispute detail view, evidence section populated.
4. **Blockers (must fix before prod):**
   - Any failing command from §3.
   - Any console error during App Bridge load.
   - Wrong Shopify field populated (e.g. fraud → uncategorizedText empty).
   - `auto_save_decision` doesn't match the matrix in `lib/automation/__tests__/pipelineMatrix.test.ts`.
   - Billing quota not enforced.
   - DB migration not applied to staging Supabase project.
5. **Acceptable known issues:**
   - ESLint warnings (not errors) that already existed on `master`.
   - Moderate npm audit advisories already triaged (audit gate is set to
     `--audit-level=critical`).
   - Cosmetic copy issues filed as a follow-up ticket and linked in the
     checklist.

---

## 8. Suggested file/folder layout (delta only)

This plan does **not** restructure existing code. The only new artifacts:

```
docs/RELEASE_TESTING_PLAN.md                # this file
docs/release-checklists/
  TEMPLATE.md                               # copy-per-release
  README.md                                 # one-liner: how to use the template
```

Existing test directories stay where they are:

```
tests/unit/         # existing — keep
tests/api/          # existing — keep (this is integration)
tests/contract/     # existing — keep
tests/integration/  # existing (1 file) — available for non-route integration
e2e/                # existing — keep
lib/**/__tests__/   # existing — preferred for new colocated unit tests
scripts/smoke-*.mjs # existing — keep
```

When the gap rows in §4 are filled, follow §5 conventions for placement.

---

## 9. Commands cheat-sheet

```powershell
# Mandatory automated (the gate)
npm ci
npm run release:verify          # = lint + tsc + test + build (see §11)
npm audit --audit-level=critical

# Optional but recommended for big updates
npm run test:coverage           # confirms hard-gated business logic still covered
npm run test:e2e                # requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD in .env.local
node scripts/smoke-test.mjs     # requires live Supabase + SUPABASE_URL_POSTGRES
npm run smoke:resources-hub     # only if release touches the hub

# Migrations (mandatory if any supabase/migrations/ file changed)
npm run db:migrate              # against staging FIRST, then prod

# Manual staging walk-through
# Open the deployed staging Vercel URL inside a Shopify dev-store admin and
# work through the manual rows in docs/release-checklists/<your-checklist>.md
```

---

## 9b. Staging smoke (operator script)

Hand-runnable in under 10 minutes against the deployed Vercel staging
build, inside a Shopify dev-store admin. Tick each line on the per-release
checklist (§3 of the template) and capture screenshots/console for §4.

1. **Embedded app opens.** Open the app from the Shopify Admin sidebar.
   Page renders without a session-expired redirect; no red errors in the
   browser devtools console after App Bridge handshake.
2. **Dashboard loads.** `/app` shows KPI cards (Open / Under review /
   Saved). Numbers match what you expect for the dev store.
3. **Disputes list loads.** `/app/disputes` shows the desktop table on a
   wide viewport AND mobile cards at 393 px. No spinner stuck.
4. **Dispute detail renders.** Click into a seeded dispute. Overview,
   Evidence, and Review & Submit tabs all render — no blank panes, no
   runtime errors.
5. **Evidence pack generates.** On a dispute without a pack: trigger
   "Build pack" (or wait for auto-build). Pack appears with strength
   pill + checklist within ~30 s.
6. **Save to Shopify succeeds.** Click "Save to Shopify" on a non-covered,
   non-fatal-loss case. UI confirms success → cross-check in Shopify
   Admin → dispute detail → evidence section is populated in the
   reason-correct field (fraud → `uncategorizedText`, INR → fulfillment
   text, etc.).
7. **Subsequent update succeeds.** Edit a section, save again. Shopify
   accepts the second update without 4xx.
8. **No critical console errors.** Throughout the walk-through, the
   browser devtools console shows no red errors (warnings OK if already
   present on `master`).
9. **Mobile sanity.** Reload `/app/disputes` and `/app/disputes/[id]` at
   393 px (Pixel 5 emulation) — triage cards render, urgency + amount
   are visible above the fold, no horizontal overflow.

If any line fails, it goes in the checklist's §5 (blockers). HIGH-risk
releases must complete every line; MEDIUM-risk releases complete the
lines relevant to the change.

---

## 10. Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| E2E flake from the live Next dev server (`webServer` in playwright.config) | medium | Already mitigated: 2 retries on CI, `reuseExistingServer` locally. Keep E2E thin and resilient |
| `scripts/smoke-test.mjs` requires `.env.local` and a live Supabase — not runnable in CI | medium | Acceptable: it's a release-time check, not a per-PR check. Document this clearly in §9 (done) |
| Manual checklist rows get skipped under deadline pressure | high | Per-release file lives in git (`docs/release-checklists/`); reviewer can refuse to merge without it. Ties accountability to the commit |
| New test gaps in §4 (billing, dashboard metrics, review/submit) stay open indefinitely | medium | Track as backlog tickets; the manual checklist surfaces the gap every release until automated |
| Forbidden-copy CI greps drift out of date | low | They live in `.github/workflows/ci.yml`; reviewed alongside any UX-copy change |
| `release:verify` passes locally but CI fails (env drift) | low | CI runs the same commands minus `build`; agree to run `npm run build` locally per CLAUDE.md before tagging |
| Plan itself drifts from reality | medium | Re-review on every quarterly roadmap update; bump "Last reviewed" date at the top |

---

## 11. Implementation steps (small, safe diff)

The diff that ships with this plan:

1. **Add `docs/RELEASE_TESTING_PLAN.md`** — this file.
2. **Add `docs/release-checklists/README.md`** — one-liner explaining the
   template.
3. **Add `docs/release-checklists/TEMPLATE.md`** — fill-in-the-blank checklist.
4. **Add a `release:verify` script to `package.json`** —
   `"release:verify": "npm run lint && npx tsc --noEmit && npm test && npm run build"`.
   Chaining with `&&` works on both PowerShell 7+ (the dev shell per CLAUDE.md)
   and bash (CI). No new dependencies.
5. **Update `docs/technical.md`** with a one-line pointer to this plan under a
   new "Release verification" heading. (Per `feedback_docs_update.md`, docs are
   updated in the same commit as the change.)

Out of scope for this diff (deliberate — listed for transparency):

- Adding new automated tests for billing / dashboard metrics / review-submit
  (each is a separate PR; tracked as backlog).
- Wiring `release:verify` into a GitHub Action — current CI already runs the
  underlying steps; a separate "release" workflow can come later if useful.
- Moving existing `tests/api/*` into `tests/integration/*` — pure churn for no
  behavioural change.
- Adding the smoke script to CI — it requires live Supabase; keep it as a
  release-time local check.

---

## 12. Top backlog: review/submit/save-to-Shopify E2E

The `/app/disputes/[id]` → Review & Submit → "Save to Shopify" flow is the
**highest-risk uncovered area** in the test pyramid today. A regression
here ships wrong evidence into Shopify (or no evidence at all), and the
merchant only finds out after the bank decision. Coverage today:

- ✅ Pack-build route: `tests/api/packs/packDetailRoute.test.ts`
- ✅ Field mapping: `tests/unit/fieldMapping.test.ts`,
  `lib/shopify/__tests__/composeShopifyMutationPayload.test.ts`,
  `tests/golden/` (5 fixtures lock the keys-populated decision)
- ✅ Save-to-Shopify route gates: `tests/api/packs/saveToShopifyRoute.test.ts`
  (404/422/400/500 paths, 202 happy path with `jobs.insert` shape +
  pack flip to `saving` + `evidence_saved_to_shopify` audit emit)
- ✅ Per-family mutation payload byte-equivalence:
  `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts`
  (FRAUDULENT, PRODUCT_NOT_RECEIVED, PRODUCT_UNACCEPTABLE, DUPLICATE)
- ❌ End-to-end: no Playwright spec exercises the merchant clicking
  "Save to Shopify" against a stubbed Shopify endpoint
- ✅ Read-back verification orchestration:
  `lib/shopify/__tests__/verifyEvidenceReadback.test.ts` — 11 tests
  covering happy path, empty/whitespace text classification, write-only
  routing, file-field GID equality (match + mismatch + omitted
  inputValues back-compat), and defensive paths for malformed Shopify
  responses
- ✅ Route-level Playwright spec via portal auth:
  `e2e/save-to-shopify.spec.ts` — 2 tests (404 for unknown pack via
  authenticated portal session, 401 SESSION_REQUIRED without auth).
  Catches middleware portal-fallback regressions and route-registration
  drift. Run via `npm run test:e2e` against staging or a local
  Playwright-managed dev server.

**Remaining priorities (separate PRs):**

1. **Seeded happy-path E2E** — sign in, seed an `evidence_packs` row
   with `status="ready"`, POST to the route, assert 202 + `jobs.insert`
   + pack flip to `"saving"`, then clean up. Requires
   `SUPABASE_URL_POSTGRES` and a transactional seed/cleanup helper.
2. **Full embedded click-the-button E2E** — `/app/disputes/[id]` →
   "Save to Shopify" inside Shopify Admin. Blocked on a Shopify
   test-mode session bridge (~325 LOC across HIGH-risk auth files +
   security review). Defer until the staging walk-through (§9b step 6)
   stops being sufficient.

This priority is duplicated in the per-release checklist's risk table so
it stays visible until automated.
