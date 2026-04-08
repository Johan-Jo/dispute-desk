# Embedded App Redesign — Implementation Plan

**Figma (Make):** [DisputeDesk Shopify App Design](https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design) — file key `5o2yOdPqVmvwjaK8eTeUUx`. Code-based source files; use source paths for design-to-code reference.

---

## Implementation status (2026-03-14, updated 2026-04-04)

**E1 — Shell and navigation ✅**
- `s-link` children in `s-app-nav` per App Bridge web component spec (not `<a>` tags).
- App Bridge script moved to root layout `<head>` — React adds `async`/`defer` to `<script src>` in nested Server Components; the explicit `<head>` in the root layout is the only safe placement.
- `defer` removed; App Bridge aborts with an error if loaded with `defer`, `async`, or `type=module`.

**E2 — Locale and i18n wiring ✅**
- Middleware forwards `?locale=` query param as `x-shopify-locale` request header.
- Embedded layout reads `x-shopify-locale` as `shopLocale` in `resolveLocale()` — fixes first-request language (the `dd_locale` cookie is response-only on the first request).
- Backfilled ~400 missing keys across de-DE, fr-FR, es-ES, pt-BR, sv-SE; all 5 locales now at 0 missing keys vs en-US.

**E6 — Setup wizard redesign ✅**
- `SetupWizardShell` redesigned: horizontal `WizardStepper` at top (5 steps), full-width content card, no "What this unlocks" sidebar, "Get Started →" on welcome screen.
- `WizardStepper` new component: Sync disputes → Set policies → Generate packs → Add rules → Add team, with icons, connecting lines, active/completed/pending states.
- `WelcomeGoalsStep` redesigned to Figma spec: shield icon, heading, numbered accomplishments list (5 items), stats row (5 mins / 5 steps / 100%), blue skip-info banner.
- `WIZARD_STEP_IDS` = [overview, disputes, policies, packs, rules, team]; `WIZARD_STEPPER_IDS` = [disputes, policies, packs, rules, team].
- `getNextWizardStep()` added — iterates `WIZARD_STEP_IDS` only; API now uses this so `nextStepId` always resolves to a wizard step.
- API `progress`/`allDone` now counts wizard steps only (6), not all 8.
- `setup/page.tsx` redirect falls back to `"overview"` (was `"permissions"`).
- `SetupChecklistCard` removed from dashboard (not in new Figma design).
- All 6 locales backfilled with `setup.welcome`, `setup.stepper`, `setup.getStarted` keys.

**E8 — Wizard steps: Set policies, Generate packs, Add rules ✅**
- `BusinessPoliciesStep`: 5 policy type rows (Returns, Shipping, Terms, Privacy, Contact); each row has a URL `TextField` + "Use template" `Button` that sets `source: "template"` and clears the URL field; inline note when template applied; payload saved via `POST /api/setup/step`.
- `PacksStep`: fetches `GET /api/templates` on mount; shows checkbox cards (name, description, dispute_type); pre-checks `is_recommended` templates; loading spinner + empty state; on save installs each selected template via `POST /api/templates/:id/install` then marks step done.
- `AutomationRulesStep`: checkbox cards from `RULE_PRESETS` (4 presets); pre-checks `preset-fraud-auto` + `preset-pnr-auto`; each card shows name, match summary, action badge (Auto-pack / Review); on save calls `POST /api/rules/install-preset` with selected IDs then marks step done.
- i18n: `setup.policies.*`, `setup.packs.*`, `setup.rules.*` added to all 6 locale files.

**E3 — Open in Admin step ✅**
- `OpenInAdminStep.tsx` wired to `useTranslations('setup.openInAdmin')`.
- `SetupChecklistCard.tsx` wired to existing `setup.*` i18n keys (was all hardcoded English).
- Added `setup.openInAdmin` namespace to en-US.json; backfilled all 5 non-English locales.
- `lib/embedded/openInAdmin.ts`: App Bridge Redirect as primary; `window.open` / `window.top.location.href` as fallbacks.

**E1 — Shell and nav (homework):**

- **Our repo:** We do not render an in-iframe **horizontal route nav** (tabs). `AppNavSidebar` renders `s-app-nav` with `display: none` so Shopify can read it. **`EmbeddedAppChrome`** (`components/embedded/EmbeddedAppChrome.tsx`, used in `app/(embedded)/app/layout.tsx`) renders three regions matching Figma `shopify-shell.tsx`: (1) white brand-row bar (`border-bottom #E1E3E5`, `#5E4DB2` shield tile, “DisputeDesk” title, three-dot menu); (2) feedback card (`bg-[#F1F2F4]` wrapper, white bordered card, interactive stars); (3) `bg-[#F1F2F4]` content area (`px-8 py-6`). No Polaris wrappers — all plain HTML + CSS Modules with exact Figma hex values. The disputes page (`app/(embedded)/app/disputes/page.tsx`) also drops Polaris `Page`/`Layout`/`Card` in favour of three separate HTML blocks (header h1+subtitle, actions-bar card, table card) matching Figma `shopify-disputes.tsx`.
- **Shopify docs:** [App Nav](https://shopify.dev/docs/api/app-home/app-bridge-web-components/app-nav) states that on desktop the navigation menu appears as part of the app nav, on the left of the screen (sidebar); on mobile it appears in a dropdown from the TitleBar. So by design, desktop nav is sidebar-only.
- **Title bar:** The [title bar](https://shopify.dev/docs/api/app-home/app-bridge-web-components/title-bar) is configured by the `s-page` web component (heading, primary/secondary actions, breadcrumb). We use Polaris `Page`, not `s-page`; the admin title bar is rendered **outside** the app iframe by Shopify. We cannot remove or change that from inside our app.
- **If a horizontal bar still appears:** (1) If it is inside our iframe, add a scoped CSS override in the embedded layout to hide it once we know the selector (e.g. from DevTools; Shopify may use minified classes). (2) If it is in the host (admin) chrome, we have no access to hide it; there is no documented API to show app nav only in the sidebar and not in the header. [Community](https://community.shopify.com/t/hide-embedded-app-navigation-bar/40597/2) notes that hiding the bar via CSS is possible but fragile (host-generated class names).
- **Concrete mitigation:** Add an embedded-only CSS rule to hide an in-iframe nav bar when the selector is identified; document the source of the selector in a code comment.

**Completed:** All embedded pages use real APIs and data (no stubs).

| Page | Real data sources | Notes |
|------|-------------------|-------|
| Dashboard | `GET /api/dashboard/stats`, `GET /api/disputes`, `GET /api/setup/state` | KPIs, win rate trend, dispute categories from disputes; recent disputes list |
| Rules | `GET /api/rules` | Real `match`/`action` schema; `matchSummary` formatting; `Array.isArray` response handling |
| Settings | `GET /api/billing/usage`, `GET/PATCH /api/shop/preferences` | Store domain from usage; notification prefs persisted in `shop_setup` |
| Packs | `GET /api/packs`, `GET /api/templates` | Real `documents_count`, `usage_count`, `last_used_at`; no fake completeness bar |
| Disputes | `GET /api/disputes` | Search, Filter, Export, **More actions** (Sync); HTML table (see `docs/technical.md`) |
| Billing | `GET /api/billing/usage`, `POST /api/billing/subscribe` | Plan display, trial copy |

**New APIs:**
- `GET /api/dashboard/stats?shop_id=&period=` — KPIs, win rate trend, dispute categories
- `GET /api/shop/preferences?shop_id=` — notification preferences
- `PATCH /api/shop/preferences` — update notifications

**Billing usage:** Now returns `shop_domain` for store connection display in Settings.

---

## 1. Design implementation

### 1.1 Design context

Figma **Make** files are code-based: they expose **source files** (React pages), not traditional Figma node IDs. For design-to-code, use the **source file contents** from the Make project (e.g. `src/app/pages/shopify/shopify-home.tsx`) as the reference. No per-frame `get_design_context` nodeId is available for Make.

### 1.2 Route mapping table

| Figma Make source (path) | DisputeDesk route | Notes |
|--------------------------|--------------------|--------|
| `src/app/pages/shopify/shopify-home.tsx` | `app/(embedded)/app/page.tsx` | Dashboard: setup banner, overview stats, recent disputes, charts. Uses `OnboardingWizard` when wizard visible. |
| `src/app/pages/shopify/onboarding-wizard.tsx` | `app/(embedded)/app/setup/[step]/page.tsx` | Setup wizard (multi-step onboarding). |
| `src/app/pages/shopify/shopify-disputes.tsx` | `app/(embedded)/app/disputes/page.tsx` | Disputes list. |
| `src/app/pages/shopify/shopify-dispute-detail.tsx` | `app/(embedded)/app/disputes/[id]/page.tsx` | Dispute detail. |
| `src/app/pages/shopify/shopify-packs.tsx` | `app/(embedded)/app/packs/page.tsx` | Evidence packs list. |
| `src/app/pages/shopify/shopify-rules.tsx` | `app/(embedded)/app/rules/page.tsx` | Automation rules. |
| `src/app/pages/shopify/shopify-plan-management.tsx` | `app/(embedded)/app/billing/page.tsx` | Billing / plan management. |
| `src/app/pages/shopify/shopify-settings.tsx` | `app/(embedded)/app/settings/page.tsx` | Settings. |
| `src/app/pages/shopify/shopify-analytics.tsx` | (dashboard or separate) | Analytics; can be folded into dashboard or added later. |
| `src/app/pages/shopify/shopify-shell.tsx` | Layout/nav (embedded layout + nav) | Shell: top bar, sidebar, app nav (Dashboard, Disputes, Evidence Packs, Rules, Plan, Settings). Adapt in `app/(embedded)/layout.tsx` or shared nav component. |

### 1.3 Implementation order

1. **Embedded layout + shell** — Top bar, sidebar, app nav from Figma shell; Polaris/App Bridge.
2. **Dashboard** — Home (setup banner, overview stats, recent disputes, charts).
3. **Configuration guide** — "Complete your setup" / config checklist card; deep link per §3.3.
4. **Billing page** — New layout and trial copy.
5. **Setup wizard** — Steps and copy from Figma onboarding-wizard.
6. **i18n** — Ensure locale is read from Shopify and plumbed per §5; then add/update keys in all 6 message files.
7. **Disputes list + detail** — Then packs, rules, settings; add strings to all 6 locales and QA.

---

## 2. Payment system

### 2.1 What exists

- Billing/plan management API and existing flows; trial and plan state.

### 2.2 Gaps

- **Closed for V1:** Billing uses real APIs and trial copy in i18n (`app/(embedded)/app/billing/page.tsx`). Further Figma polish is optional.
- No dev-store–specific flows required for this redesign.

### 2.3 Acceptance criteria

- Billing page shows plan/trial copy from i18n with locale wired per §5.
- All new copy in i18n with **locale wired per §5** so translations actually switch.

---

## 3. Second installation step

### 3.1 Current state

- No theme app extension in the repo (`shopify.app.toml` has no `[extensions]`; no `extensions/` directory).
- The "second step" is **Open in Shopify Admin** (or "Pin the app"): guide the merchant to open DisputeDesk from **Shopify Admin → Apps**.

### 3.1.1 Product decision table

| Option | Decision | Notes |
|--------|----------|-------|
| Theme app extension | No | Admin-only app; no storefront widget. |
| Open in Admin / Pin app | Yes | Single setup step with copy + button that opens Admin/app URL. |
| Deep link target | Admin (or theme editor if product later adds it) | Use App Bridge Redirect as primary; see §3.3. |

### 3.2 Theme extension optional

Theme app extension is **not** in scope. If product later requests storefront presence, add it as a separate initiative.

### 3.3 Deep link button (App Bridge primary, fallback only)

- **Implementation:** Use **App Bridge Redirect as PRIMARY**: `Redirect.dispatch(Redirect.Action.REMOTE, { url: themeEditorUrl, newContext: true })` (or the appropriate Admin/app URL). Use **`window.top.location.href` only as FALLBACK** when App Bridge is unavailable (e.g. outside embedded context). Do **not** use a plain `<a href>` or `window.top` as the primary navigation method.

### 3.4 Open in Admin step

- One setup step (e.g. "Open in Admin" or "Pin the app") with copy and a button.
- Button uses App Bridge `Redirect.dispatch` to open the Shopify Admin Apps page or the app URL so the merchant can open/pin the app.

### 3.5 Setup wizard changes

- Add a new step id (e.g. `open_in_admin` or `activate_embed`) to `StepId` in `lib/setup/types.ts` and to `SETUP_STEPS` in `lib/setup/constants.ts` (e.g. after "Connect your store"). Integrate the "Open in Admin" step into the setup wizard and configuration guide card; ensure host/shop params are preserved for App Bridge.

### 3.6 Acceptance criteria

- One clear "Open in Admin" (or equivalent) step with copy and button.
- Deep link uses App Bridge Redirect as primary; fallback only when necessary.
- **Copy and i18n:** All strings as i18n keys in **all 6 locales** and locale detection/wiring per §5.

---

## 4. Legacy

### 4.1 Reuse

- Existing embedded layout, nav, Polaris, App Bridge script.
- Existing billing API and plan/trial logic.
- Existing setup checklist and wizard structure; adapt copy and add "Open in Admin" step.

### 4.2 Improve

- Align UI with Figma (dashboard, billing, setup, disputes, packs, rules, settings).
- Ensure all external navigation from embedded app uses App Bridge where possible (§3.3).

### 4.3 Files table

| Area | Path / notes |
|------|----------------|
| Embedded layout | `app/(embedded)/layout.tsx` |
| Dashboard | `app/(embedded)/app/page.tsx` |
| Setup wizard | `app/(embedded)/app/setup/[step]/page.tsx` |
| Billing | `app/(embedded)/app/billing/page.tsx` |
| Disputes | `app/(embedded)/app/disputes/page.tsx`, `app/(embedded)/app/disputes/[id]/page.tsx` |
| Packs, rules, settings | `app/(embedded)/app/packs/`, `rules/`, `settings/` |
| i18n | See §5. Wire locale first; then add keys to all 6 `messages/*.json`. |

---

## 5. Embedded app locale and i18n (architecture)

### 5.1 Where locale comes from

- Locale for the embedded app must come from **Shopify**: prefer **session JWT** (session token claims) or **`locale` query param** on embed load when Shopify provides it; **Accept-Language** and **cookie** (`dd_locale`) are acceptable fallbacks. Use `resolveLocale()` / `normalizeLocale()` in `lib/i18n/locales.ts` to map to a supported BCP-47 locale.
- Without this wiring, the embedded app cannot reliably show the merchant's language; translations will not switch.

### 5.2 Plumb into provider

- The resolved locale must be **plumbed into the i18n provider** in the **embedded layout** (e.g. `NextIntlClientProvider` with `locale` and `messages`).
- The app supports **6 languages** (en-US, de-DE, fr-FR, es-ES, pt-BR, sv-SE). There is **no manual locale picker** in the embedded app; locale is driven by Shopify.

### 5.3 Implementation checklist

- [x] **Wire locale first:** Middleware forwards `?locale=` as `x-shopify-locale`; embedded layout `resolveLocale()` uses it (see §Implementation status E2).
- [x] Pass resolved `locale` and `messages` into the i18n provider so all embedded pages use it.
- [x] **Then** add/update keys: every new or changed string must exist in **all 6** `messages/*.json` files (en-US, de-DE, fr-FR, es-ES, pt-BR, sv-SE) — backfilled per E2.
- [ ] QA in multiple locales when changing copy (ongoing; not a one-time gate).

**Locale wiring is required for translations to switch; the above is implemented.**

### 5.4 Deferred (non-blocking)

- **E1 homework:** Optional CSS to hide a duplicate in-iframe nav bar once a stable selector is known (see §E1 in Implementation status).
- **Analytics route:** Figma `shopify-analytics.tsx` remains foldable into the dashboard or a later route — not required for App Store submission.

---

## 6. Research references

- [Embedded app redesign findings](embedded-redesign-findings.md) — Theme extension vs Admin-only decision; Figma Make mapping; App Bridge usage.
- Figma Make file key: `5o2yOdPqVmvwjaK8eTeUUx` — Use source file paths for design-to-code.

---

## 7. Suggested implementation order (completed)

1. **Product decision** — Open in Admin per §3.1 (done).
2. **Locale/i18n wiring per §5** — Done (E2).
3. **Figma + dashboard + config guide** — Done (shell, dashboard, App Bridge Redirect).
4. **Setup step** — Open in Admin integrated (E3).
5. **Billing page trial copy** — Done (see §2.2).
6. **Disputes and rest** — Done; ongoing locale QA per §5.3.
