# Embedded App Redesign — Findings (Pre-Implementation)

## 1. Critical decision: Theme app extension vs Admin-only

**Resolved: Admin-only. No theme app extension.**

### Evidence

- **`shopify.app.toml`**: Contains `embedded = true` (Admin embedded app), webhooks, `[app_proxy]`, `[pos]`. There is **no** `[extensions]` section and no reference to a theme app extension.
- **`extensions/` directory**: Does **not** exist in the repository (glob returned 0 files; `dir extensions` confirmed "No extensions dir").

### Implication

- The "second installation step" is **not** "Activate app embed" in the theme editor (no storefront widget).
- The step should be **"Open in Shopify Admin"** or **"Pin the app"**: guide the merchant to open DisputeDesk from **Shopify Admin → Apps** (and optionally pin it). No deep link to theme editor; optional deep link to the app in Admin if needed.
- **Onboarding flow**: Add a single setup step (e.g. `open_in_admin` or `activate_embed` used as "Open in Admin") with copy and a button that uses **App Bridge `Redirect.dispatch`** to open the Shopify Admin Apps page (or the app URL) so the merchant can open/pin the app. No theme extension deploy or `activateAppId` logic.

**Proceed with Admin-only. Do not add a theme app extension unless product requests storefront presence later.**

---

## 2. Figma screen inventory (Figma Make file key: 5o2yOdPqVmvwjaK8eTeUUx)

Figma **Make** files are code-based: they expose **source files** (React pages), not traditional Figma node IDs. `get_metadata` is not supported for Make files; `get_design_context` with empty `nodeId` returns the list of source file URIs. The following mapping is derived from the Make project structure and `App.tsx` routing.

### Mapping: Figma Make source → DisputeDesk embedded route

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
| `src/app/pages/shopify/shopify-analytics.tsx` | (dashboard or separate) | Analytics; in Make shown under `/shopify/analytics`. Current codebase has no `/app/analytics`; can be folded into dashboard or added later. |
| `src/app/pages/shopify/shopify-shell.tsx` | Layout/nav (embedded layout + nav) | Shell: top bar, sidebar, app nav (Dashboard, Disputes, Evidence Packs, Rules, Plan, Settings). Adapt in `app/(embedded)/layout.tsx` or shared nav component. |

### Components to reference (Figma Make)

- **Configuration guide / setup checklist**: `shopify-home.tsx` has a dismissible "Complete your setup" banner; `setup-checklist-widget.tsx`, `onboarding-wizard.tsx` in Make. Map to DisputeDesk `SetupChecklistCard` and new configuration guide card.
- **Billing**: `shopify-plan-management.tsx` → implement layout and "14-day free trial" copy; reuse existing billing API.

### Note on node IDs

Figma Make does not use frame/node IDs in the same way as Figma Design. For design-to-code, use the **source file contents** from the MCP resource URIs (e.g. `file://figma/make/source/5o2yOdPqVmvwjaK8eTeUUx/src/app/pages/shopify/shopify-home.tsx`) as the reference. No per-frame `get_design_context` nodeId is available for Make.

---

## 3. Next steps (before writing component code)

1. **Confirm with stakeholder**: Proceed with **Admin-only** "Open in Admin" step (no theme extension). If you prefer a different label (e.g. "Pin the app"), confirm copy.
2. **Implementation order**: Dashboard + configuration guide (with "Open in Admin" step) → dev/live banner → billing page → setup wizard → disputes list/detail → remaining screens. Use Polaris where possible; add custom CSS only where necessary.
3. **App Bridge**: All external navigation (e.g. to Admin) must use **App Bridge `Redirect.dispatch`**, not `window.open` or plain `<a href>`.

---

## Update (2026-03-18): Evidence Packs page parity

- Updated `app/(embedded)/app/packs/page.tsx` to match the website/portal Evidence Packs library layout:
  - Header CTAs: `Start from template` + `Create Pack`
  - Dismissible info banner
  - Search + status tabs (All/Active/Draft/Archived)
  - Table rows with row actions (`Activate` for drafts, `Edit`, `Delete`)
  - Empty state includes a `Recommended Templates` block with install actions
  - Template install uses the existing `POST /api/templates/:id/install` flow and routes to the installed pack detail.

- Template wizard integration on embedded is still pending (future work after packs page parity).

## Update (2026-04-07): Embedded disputes list — dashboard column parity

- `app/(embedded)/app/disputes/page.tsx` uses Polaris **Page** / **Layout** / **Card** (not three standalone HTML sections). The disputes table columns match the embedded dashboard **Recent Disputes** widget; navigation to detail is via **View details** and the order link, not whole-row click. See `docs/technical.md` (Review Queue + Dashboard Stats).
