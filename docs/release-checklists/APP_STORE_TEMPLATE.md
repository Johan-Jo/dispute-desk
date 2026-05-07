# Shopify App Store submission checklist — DisputeDesk

Copy this file to `docs/release-checklists/YYYY-MM-DD-app-store-submission.md`
when you're preparing a submission. Fill it in as you go and commit the
filled file alongside the submission record.

This is a **one-time gate** ceremony, separate from the per-release
[`TEMPLATE.md`](TEMPLATE.md). Per-release checks verify that a code change
hasn't regressed; this checklist verifies that the app meets Shopify App
Store + GDPR + CCPA requirements before public listing.

The full plan and rationale lives in
[`docs/shopify-app-review-checklist.md`](../shopify-app-review-checklist.md).

---

- **Submission date:** YYYY-MM-DD
- **Reviewer:** <name>
- **Production URL:** https://disputedesk.app
- **Partner Dashboard app ID:** <copy from Partners>
- **Distribution status before submission:** unlisted / listed

## 0. Risk classification

This submission is automatically **HIGH risk** — App Store review failures
typically take 5-14 days to remediate (resubmit + re-queue). Run every
section below; do not silently skip.

## 1. Configuration parity (Partners + repo)

- [ ] `shopify.app.toml` `application_url` matches Partners → App URL
- [ ] `shopify.app.toml` `[auth].redirect_urls` matches Partners → Allowed redirection URL(s)
- [ ] `shopify.app.toml` `[access_scopes].scopes` matches Partners → API access scopes
- [ ] `.env.example` `SHOPIFY_SCOPES` matches `shopify.app.toml` (drift-guard: `tests/unit/shopifyScopes.test.ts`)
- [ ] Webhook subscriptions in `shopify.app.toml` registered AND visible in Partners → Webhooks
- [ ] `shopify.app.toml` `client_id` matches Partners
- [ ] Pinned API version (`[webhooks].api_version`) matches `SHOPIFY_API_VERSION` in `.env.local` and Vercel

## 2. Scope justification

The minimum production scope set as of 2026-05-07. If you're adding any:
prepare a one-paragraph justification per scope before submission — Shopify
reviewers will ask.

| Scope | Used by | Why required |
|---|---|---|
| read_orders | dispute evidence builder | Pull order details (line items, totals, addresses) |
| read_customers | dispute evidence builder | Customer email + name on the disputed order |
| read_products | dispute evidence builder | Product titles + descriptions for "item as described" defense |
| read_fulfillments | dispute evidence builder | Tracking + delivery timestamps |
| read_shipping | dispute evidence builder | Shipping zones + transit estimates |
| read_shopify_payments_disputes | sync_disputes job | Fetch disputes for the merchant |
| read_shopify_payments_dispute_evidences | save-to-shopify verify path | Read-back verification |
| write_shopify_payments_dispute_evidences | save-to-shopify | Submit evidence text fields |
| read_shopify_payments_dispute_file_uploads | file evidence layer | Verify uploaded file GIDs |
| write_shopify_payments_dispute_file_uploads | file evidence layer | Upload focused PDFs to native dispute file slots |

- [ ] No `write_*` scopes in production beyond `write_shopify_payments_dispute_*`
- [ ] Seed-only scopes (`write_draft_orders`, `write_fulfillments`, etc.) confirmed to be on the separate `SHOPIFY_SEED_CLIENT_ID` Partners app, not the production app

## 3. GDPR mandatory webhooks

Three webhooks Shopify requires for any app touching customer data. Listed
in `shopify.app.toml [[webhooks.subscriptions]]`. Handlers in `app/api/webhooks/`.

- [ ] `customers/data_request` — `app/api/webhooks/customers-data-request/route.ts`
  - Verifies HMAC, writes audit row, emails admin via Resend, returns 200
  - 5 unit tests in `tests/api/webhooks/customersDataRequest.test.ts`
- [ ] `customers/redact` — `app/api/webhooks/customers-redact/route.ts`
  - Anonymizes matched disputes + scrubs `pack_json`, writes audit row, returns 200
  - 6 unit tests in `tests/api/webhooks/customersRedact.test.ts`
  - Compliance audit row deliberately does NOT contain customer PII (verified by test)
- [ ] `shop/redact` — `app/api/webhooks/shop-redact/route.ts`
  - Cascade-deletes from 24 per-shop tables in dependency order, returns 200
  - 6 unit tests in `tests/api/webhooks/shopRedact.test.ts`
- [ ] **Smoke test:** trigger each webhook from Partner Dashboard → Webhooks → "Send test notification" against your staging deployment. Confirm 200 response.
- [ ] Webhook URLs in Partners (if managed manually) match the toml URIs

## 4. Privacy policy

Live at `https://disputedesk.app/en/privacy` (and `/de`, `/es`, `/fr`, `/pt`, `/sv` paths fall through to English with a notice).

- [ ] [REVIEW WITH COUNSEL] sticker in `app/[locale]/privacy/page.tsx` has been actioned — qualified legal review completed
- [ ] Sub-processor list in §5 of the policy matches actual vendors (Supabase, Vercel, Resend, IPinfo, OpenAI, Cal.com, Shopify)
- [ ] `privacy@disputedesk.app` mailbox exists and forwards to a monitored inbox
- [ ] Last-updated date is current
- [ ] Privacy policy URL set in Partners → App listing → Privacy Policy URL

## 5. PCD (Protected Customer Data) declaration

The app reads `customer.email`, `customer.first_name`, `customer.last_name`,
plus order shipping/billing addresses and order details. This is PCD per
[Shopify's rules](https://shopify.dev/docs/apps/launch/protected-customer-data).

- [ ] PCD level requested in Partner Dashboard → Customer data
- [ ] Justification text matches the scopes in §2 above
- [ ] Approved status confirmed in Partners (PCD approval is asynchronous; can take days)

## 6. Listing assets

- [ ] App name + handle finalized
- [ ] App icon (1024×1024 PNG, no transparency, brand-aligned)
- [ ] Featured banner (3000×940 PNG)
- [ ] Screenshots (1600×900 PNG, minimum 3 — embedded app views)
- [ ] App video (optional — 30-90s walkthrough)
- [ ] Short pitch (≤140 chars)
- [ ] Long description (key features, benefits, target merchant)
- [ ] Pricing model + plan tiers
- [ ] Support email
- [ ] Support URL or in-app help link

## 7. Dev store rehearsal

Per [`docs/shopify-app-review-checklist.md`](../shopify-app-review-checklist.md) §2.

- [ ] Install on a fresh dev store via the production app URL
- [ ] OAuth completes; embedded shell loads inside Shopify Admin without redirect loops
- [ ] Title bar shows "DisputeDesk" with shield icon on every embedded page
- [ ] `/app/disputes` loads, search/filter/export/sync work
- [ ] Create or open an evidence pack; "Save evidence" works
- [ ] If listing paid plans: subscription approval flow opens and returns to the app
- [ ] Uninstall the app from Shopify Admin → confirm `app/uninstalled` webhook fires (logs visible)
- [ ] Wait 48h after uninstall (or trigger manually via Partners) → confirm `shop/redact` webhook fires + cascade completes (Supabase shows zero rows for that shop_id across the redacted tables)

## 8. Copy and policy

- [ ] No "submit response" / "submit to card network" / "file dispute response" anywhere in UI (CI grep guard already enforces this on every push)
- [ ] In-app help correctly describes that DisputeDesk saves evidence; Shopify does the actual submission

## 9. Pre-submission release verification

- [ ] `npm run release:verify` green on the SHA being submitted
- [ ] CI green on the same SHA (push to master triggers full e2e suite)
- [ ] All e2e tests pass on staging including the seeded save-to-shopify spec
- [ ] No critical npm audit advisories (`npm audit --audit-level=critical`)

## 10. Sign-off

- [ ] All sections above ticked or struck-through (with reason if struck)
- [ ] Submission record committed to this file
- [ ] Submission ticket ID from Partners: <fill on submit>
- [ ] Initial review feedback (Shopify response, typically within 5-7 business days):
- [ ] Resubmissions if needed: <list with dates>
- [ ] Listed publicly on: <date>
