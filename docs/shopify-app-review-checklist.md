# Shopify App Store — review and submission checklist

Use this before clicking **Submit for review** in Shopify Partners. Keep
[`shopify.app.toml`](../shopify.app.toml) in sync with the live app configuration
after any scope or URL change.

> **For each submission, copy [`docs/release-checklists/APP_STORE_TEMPLATE.md`](release-checklists/APP_STORE_TEMPLATE.md)
> to a dated file (`YYYY-MM-DD-app-store-submission.md`) and tick through it.
> The doc you're reading describes WHAT to verify; the template captures
> WHEN/WHO/STATUS for each individual submission.**

## 1. Partner Dashboard (manual)

- [ ] **App URL** and **redirect URLs** match production (`application_url`, `[auth].redirect_urls` in TOML / Partners).
- [ ] **Scopes** are minimal for described functionality; justification text matches what the app reads/writes. Evidence and Payments scopes align with [`shopify.app.toml`](../shopify.app.toml) `[access_scopes].scopes`. Trimmed 2026-05-07 to 10 production scopes; seed-only `write_*` scopes moved to the separate `SHOPIFY_SEED_CLIENT_ID` Partners app.
- [ ] **Protected Customer Data (PCD):** the app accesses customer email + name + order addresses, so PCD declaration is required. Use `disputes/create` and `disputes/update` (registered at runtime) per [Shopify PCD rules](https://shopify.dev/docs/apps/launch/protected-customer-data). Seed scripts that create orders run under the seed app.
- [ ] **Listing:** Privacy policy URL, support email or URL, accurate description, screenshots, pricing — completed per [App Store requirements](https://shopify.dev/docs/apps/launch/app-requirements-checklist). In-app Help includes merchant guidance for App Store vs website install (`shopify-app-store-install` in [`lib/help/articles.ts`](../lib/help/articles.ts)).
- [ ] After the app is **listed**, set **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`** in Vercel to the exact listing URL from **Partners → App → Distribution**, then redeploy. Optional: `npm run verify:app-store-url`.

## 1.5 GDPR mandatory webhooks (App Store gate)

Shopify requires three webhooks for any app touching customer data. Subscribed in `shopify.app.toml` since 2026-05-07; handlers in `app/api/webhooks/{customers-data-request,customers-redact,shop-redact}/`.

- [ ] `customers/data_request` returns 200 + writes audit row + emails the admin via Resend
- [ ] `customers/redact` anonymizes that customer's PII across `disputes` (NULL `customer_email` + `customer_display_name`) and recursively scrubs matching email/name fields out of `evidence_packs.pack_json`
- [ ] `shop/redact` cascade-deletes from 24 per-shop tables (children before parents, `shops` row last)
- [ ] All three are idempotent on re-delivery (verified by 26 unit tests across the three route handlers + the `scrubCustomerData` helper)
- [ ] Smoke-tested via Partner Dashboard → Webhooks → "Send test notification" against the production deployment

## 1.6 Privacy policy

Lives at `https://disputedesk.app/en/privacy` (English, authoritative; other locales fall back to English with a notice).

- [ ] `[REVIEW WITH COUNSEL]` sticker at the top of `app/[locale]/privacy/page.tsx` has been actioned — qualified legal review completed before submission
- [ ] Sub-processor list (§5 of the policy) matches reality (Supabase, Vercel, Resend, IPinfo, OpenAI, Cal.com, Shopify); update in the same commit when adding/removing a vendor
- [ ] `privacy@disputedesk.app` mailbox exists and forwards to a monitored inbox

## 1.7 App proxy decision

App proxy section was removed from `shopify.app.toml` on 2026-05-07 — DisputeDesk does not use storefront proxying. If a future `shopify app config push` rejects the missing block, restore the placeholder block per the comment at the bottom of the toml.

- [ ] `shopify app config push` succeeds against current toml (no `[app_proxy]` block)

## 2. Development store rehearsal (E2E)

Run on a **development store** with the production or staging app URL (tunnel if needed).

- [ ] **Install:** OAuth completes; app opens embedded with `shop` and `host` query params (see [`docs/technical.md`](technical.md) § Embedded app guard / troubleshooting).
- [ ] **Embedded shell:** `/app` loads without redirect loops; session cookies present (`sameSite: none` context). **In-iframe chrome:** optional feedback card appears above page content; dismiss feedback once and confirm it stays hidden after reload (`EmbeddedAppChrome`). Shopify Admin title bar shows "DisputeDesk" with the purple shield icon on all embedded pages.
- [ ] **Disputes:** `/app/disputes` loads; search, **Filter** (status popover), **Export** CSV, **Sync now** from **More actions** (⋯), **View details** link to dispute detail (columns match dashboard Recent Disputes); sync (manual or cron) behaves as expected (see [`docs/technical.md`](technical.md) — embedded disputes list).
- [ ] **Evidence:** Create or open a pack; **Save evidence** to Shopify works for a staff user with **Manage orders information** (Shopify Admin permission, not OAuth).
- [ ] **Billing:** If testing paid plans, subscription approval flow opens and returns to the app.
- [ ] **Uninstall:** `app/uninstalled` webhook path configured; shop data handling matches your privacy policy. Confirm the 48h-later `shop/redact` webhook fires + the cascade reaches every per-shop table (Supabase shows zero rows for the redacted shop_id).

Automated checks in-repo: `npm test`, `npx tsc --noEmit`, `npm run build`. Optional live smoke: `node scripts/smoke-test.mjs` (requires env + Supabase).

## 3. Copy and policy

- [ ] No UI claims **programmatic submission** to card networks; use “save evidence to Shopify” / “submit in Shopify Admin” language (see [`CLAUDE.md`](../CLAUDE.md) / EPIC-5).

## Design vs production (embedded)

Figma or marketing screenshots may show the **full** Shopify Admin frame (top bar, merchant sidebar, Apps nav). **Outer chrome is Shopify** — not rendered by this repo. **Inside the iframe**, DisputeDesk renders **`EmbeddedAppChrome`** (dismissible feedback card, `bg-[#F1F2F4]` content area) and then each route's content. The Shopify Admin title bar always displays "DisputeDesk" with the purple shield icon via `<s-page heading="DisputeDesk" />` in the shared embedded layout. The disputes list uses Polaris **Page** / **Layout** / **Card** with a Figma-aligned inner table (`disputes-list.module.css`); columns align with the dashboard **Recent Disputes** widget. Full-frame screenshots will still differ outside the iframe; see [`docs/technical.md`](technical.md) § Embedded app troubleshooting (Figma full-frame vs embedded canvas + in-iframe chrome).

## Related docs

- [`docs/technical.md`](technical.md) — API surface, session cookies, billing, embedded troubleshooting.
- [`docs/epics/EPIC-A1-automation-pipeline.md`](epics/EPIC-A1-automation-pipeline.md) — automation scope vs App Review.
