# Release checklist — <SHORT NAME>

- **Date:** YYYY-MM-DD
- **Branch / commit:** `<branch>` @ `<sha>`
- **Author:** <name>
- **Reviewer:** <name>
- **Why this is a "big update":** <which area from RELEASE_TESTING_PLAN.md §6>
- **Risk level:** `LOW` | `MEDIUM` | `HIGH` (see classification below)

## 0. Risk classification

Pick the risk level by inspecting what the change touches.

| Level | Trigger | Required before prod |
|---|---|---|
| **LOW** | docs, marketing pages, copy in `messages/`, resources hub, isolated cosmetic UI | §1 mandatory checks only |
| **MEDIUM** | non-critical embedded/portal UI, internal admin tools, scripts, non-schema infra | §1 + applicable §3 staging walk-through rows |
| **HIGH** | auth, Shopify API, evidence generation, evidence scoring, evidence mapping, submission / save-to-Shopify, billing, DB schema, dashboard metrics, embedded navigation | **Full release verification:** §1 + `npm run test:e2e` + `npm run test:visual` (when UI) + `npm run test:golden` + `node scripts/smoke-test.mjs` + every applicable §3 row + Shopify-side inspection (§4). All blockers in §5 must be empty before tagging. |

**HIGH default.** If you cannot decisively show a change is LOW or MEDIUM, treat it as HIGH. Cost of over-checking is one hour; cost of under-checking is a merchant incident.

---

## 1. Mandatory automated checks (§3)

Run locally against the release branch. Paste the final exit lines.

- [ ] `npm ci` — clean install
- [ ] `npm run release:verify` — lint + tsc + vitest + build
- [ ] `npm audit --audit-level=critical`

Optional but recommended:

- [ ] `npm run test:coverage` — coverage holds for `lib/automation`, `lib/packs`, `lib/shopify`
- [ ] `npm run test:golden` — canonical dispute fixtures unchanged (HIGH risk: required)
- [ ] `npm run test:e2e` (HIGH risk: required)
- [ ] `npm run test:visual` (HIGH risk + UI change: required)
- [ ] `node scripts/smoke-test.mjs` (live Supabase; HIGH risk: required)
- [ ] `npm run smoke:resources-hub` (only if hub touched)

## 2. Database migrations (if any)

- [ ] New migration files: `<list, or "none">`
- [ ] `npm run db:migrate` ran against **staging** Supabase
- [ ] Spot-checked the schema change in staging
- [ ] `npm run db:migrate` ran against **prod** Supabase (do this last)

## 3. Staging walk-through

Tick only the rows that apply to this change. Strike through (`~~row~~`)
rows that are N/A — do not silently skip.

- [ ] Embedded app loads in Shopify Admin (no console errors after App Bridge handshake)
- [ ] OAuth on a fresh dev store completes; sessions written to `shopify_sessions`
- [ ] `/app/disputes` renders desktop table + mobile cards with seeded data
- [ ] `/app/disputes/[id]` Overview / Evidence / Review & Submit tabs render
- [ ] Evidence pack generates for a fraud case; strength + `heroVariant` match the matrix in `lib/automation/__tests__/pipelineMatrix.test.ts`
- [ ] Save-to-Shopify writes to the correct field per reason (fraud → `uncategorizedText`, etc.); verified inside Shopify Admin
- [ ] File upload (PDF + image) lands in the private bucket and appears in the pack
- [ ] Dashboard KPI cards on `/app` match the `disputes` table counts
- [ ] Billing quota blocks at the limit on a free-plan shop and surfaces the upgrade CTA
- [ ] Coverage gate: a `PROTECTED` / `ACTIVE` `Order.shopifyProtect.status` forces `heroVariant: "covered"` and never auto-saves
- [ ] Fatal-loss gate: a `refund_issued` or `inr_no_fulfillment` case caps `overall: "weak"` and the rebuttal text does NOT cite the fatal-loss reason
- [ ] Locale parity audit clean: `npm run audit:hub-locales:fail` (only if hub touched)

## 4. Inspections (paste links / screenshots)

- [ ] Vercel staging deploy log: `<URL>` — no missing-env warnings
- [ ] Browser devtools console screenshot from `/app`
- [ ] Supabase Logs — recent `packs`, `jobs`, `audit_events` rows from the test dispute
- [ ] Shopify Admin dispute detail screenshot — evidence populated

## 5. Blockers found (must fix before prod)

- [ ] None
- Otherwise list them here with PR / commit linking the fix.

## 6. Accepted known issues (linked to follow-up tickets)

- ESLint warnings already on `master`: <list or "none">
- Moderate npm audit advisories already triaged: <list or "none">
- Cosmetic / copy follow-ups: <list with ticket links>

## 7. Sign-off

- [ ] All mandatory checks green
- [ ] All applicable manual rows ticked
- [ ] Release tagged: `<tag>`
- [ ] Promoted to prod: <date / time>
