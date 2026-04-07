# Shopify App Store — review and submission checklist

Use this before clicking **Submit for review** in Shopify Partners. Keep
[`shopify.app.toml`](../shopify.app.toml) in sync with the live app configuration
after any scope or URL change.

## 1. Partner Dashboard (manual)

- [ ] **App URL** and **redirect URLs** match production (`application_url`, `[auth].redirect_urls` in TOML / Partners).
- [ ] **Scopes** are minimal for described functionality; justification text matches what the app reads/writes. Evidence and Payments scopes align with [`shopify.app.toml`](../shopify.app.toml) `[access_scopes].scopes`.
- [ ] **Protected Customer Data (PCD):** If the app uses `disputes/create` or `disputes/update` webhooks (registered at runtime) or accesses customer data per [Shopify PCD rules](https://shopify.dev/docs/apps/launch/protected-customer-data), request/verify the correct PCD level in Partners. Seed scripts that create orders also require PCD declaration — see [`docs/technical.md`](technical.md) (Protected Customer Data) and [`scripts/shopify/README.md`](../scripts/shopify/README.md).
- [ ] **Listing:** Privacy policy URL, support email or URL, accurate description, screenshots, pricing — completed per [App Store requirements](https://shopify.dev/docs/apps/launch/app-requirements-checklist). In-app Help includes merchant guidance for App Store vs website install (`shopify-app-store-install` in [`lib/help/articles.ts`](../lib/help/articles.ts)).
- [ ] After the app is **listed**, set **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`** in Vercel to the exact listing URL from **Partners → App → Distribution**, then redeploy. Optional: `npm run verify:app-store-url`.

## 2. Development store rehearsal (E2E)

Run on a **development store** with the production or staging app URL (tunnel if needed).

- [ ] **Install:** OAuth completes; app opens embedded with `shop` and `host` query params (see [`docs/technical.md`](technical.md) § Embedded app guard / troubleshooting).
- [ ] **Embedded shell:** `/app` loads without redirect loops; session cookies present (`sameSite: none` context).
- [ ] **Disputes:** `/app/disputes` loads; **Sync Now**, search, **Filter** (status popover), **Export** CSV, row navigation to detail; sync (manual or cron) behaves as expected (see [`docs/technical.md`](technical.md) — Disputes list page (embedded)).
- [ ] **Evidence:** Create or open a pack; **Save evidence** to Shopify works for a staff user with **Manage orders information** (Shopify Admin permission, not OAuth).
- [ ] **Billing:** If testing paid plans, subscription approval flow opens and returns to the app.
- [ ] **Uninstall:** `app/uninstalled` webhook path configured; shop data handling matches your privacy policy.

Automated checks in-repo: `npm test`, `npx tsc --noEmit`, `npm run build`. Optional live smoke: `node scripts/smoke-test.mjs` (requires env + Supabase).

## 3. Copy and policy

- [ ] No UI claims **programmatic submission** to card networks; use “save evidence to Shopify” / “submit in Shopify Admin” language (see [`CLAUDE.md`](../CLAUDE.md) / EPIC-5).

## Related docs

- [`docs/technical.md`](technical.md) — API surface, session cookies, billing, embedded troubleshooting.
- [`docs/epics/EPIC-A1-automation-pipeline.md`](epics/EPIC-A1-automation-pipeline.md) — automation scope vs App Review.
