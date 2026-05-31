# Resources Hub — thin-content remediation (2026-05-31)

## Why this exists

The 2026-05-08 audit (`docs/resources-hub-audit-2026-05-08.md`) found the hub was full of
thin articles that weren't getting indexed. The rebuild that followed raised the tier word-count
floors and added a word-count validator — but shipped **targets without enforcement**. On
2026-05-31 the daily autopilot still published 3 fresh ~380-word stubs (`handling-incomplete-return-chargebacks`
+ es/fr, item `69897765…`) in only 3 of 6 locales.

### Root cause (why the stubs survived the rebuild)

1. **The gate was a no-op for tier-thinness.** `v1_tierMinimumWords` hard-failed only below **300
   absolute words**; 300w→tier-floor was a *soft* warning, and `generate.ts` accepts a draft the
   moment `hard.length === 0`. The tier floors were only ever fed back as retry *hints*.
2. **The audit was read-only; the enforcement/migration-queue ("PR 5") never shipped.**
   `quality_status` / `migration_action` were null on all 310 localizations — nothing was tagged or fixed.
3. **The expansion was partial and manual.** Only 3 pillar slugs had a regen path; the script it
   chained to (`scripts/refresh-briefs-for-rewrite.mjs`) doesn't exist. ~97 localizations reached
   floor; the rest were never touched.
4. **The autopilot kept minting new stubs daily** (08:00 UTC) with no real gate and partial-locale
   publishing allowed — so it regressed instead of staying "done".

## Sizing (verified 2026-05-31 via `supabase db query --linked`)

- 310 published localizations / 57 content_items. Tier floors: pillar 3000, cluster 1500, template/FAQ 800.
- **16** stubs <700w (incl. today's 3) · **197** under-developed 700w→floor (= **35 articles** × locales) · **97** at floor.

## What was done in this pass

### Prevention (code — needs deploy to take effect server-side)
- **Tier-relative gate.** `lib/resources/generation/validators.ts` — `v1_tierMinimumWords` now
  hard-fails below `max(300, floor(tierMin * 0.6))` (A<1800 / B<900 / C<480) instead of a flat 300.
  Thin drafts now hard-fail → the retry loop forces expansion or rejects the locale.
- **Partial-locale guard.** `lib/resources/generation/localeCompleteness.ts` +
  `pipeline.ts` — when autopilot generates an incomplete locale set, the whole item is held at
  `in-editorial-review` and the publish-queue enqueue is skipped (no more half-localized articles).
- Tests: `tests/unit/validators.test.ts` (rewritten V1 boundaries), `tests/unit/localeCompleteness.test.ts`,
  `tests/unit/expandInPlace.test.ts`.

### Cleanup (live now — data ops)
- **Morning article removed.** Item `69897765…` (en/fr/es) → `is_published=false`,
  `quality_status='thin'`, `is_excluded_from_sitemap=true`, item `workflow_status='in-editorial-review'`,
  `published_at=null`, publish-queue rows deleted. Both URLs verified **404**; gone from sitemap/hreflang.
- **16 stubs noindexed.** The 13 remaining published sub-700w localizations set to
  `quality_status='thin'`, `is_excluded_from_sitemap=true`, `migration_action='expand'` (kept live but
  out of sitemap/hreflang until rebuilt).

### Rebuild tooling (code — needs deploy + OpenAI spend to run)
- `lib/resources/generation/expandInPlace.ts` — `regenerateArticleInPlace(contentItemId, {publish})`:
  loads the source archive brief (or reconstructs from the item), re-runs `generateAllLocales`
  (self-excluded from similarity/slug guards), **UPDATEs localizations in place keeping their slugs**
  (URL/hreflang stable), and backfills missing locales.
- `app/api/cron/expand-thin/route.ts` — `cronEnvGate`-protected, one item per call (300s budget).
- `scripts/expand-thin-article.mjs` (`npm run hub:expand`) — drives the route over HTTP with
  `CRON_SECRET` (same model as `run:autopilot-once`). Targets `migration_action='expand'` by default;
  flags `--dry-run`, `--limit=N`, `--publish`, or explicit content_item UUIDs.

## Remaining work (gated on a prod deploy + generation spend)

1. **Deploy** the gate + guard + expand route (`npm run shopify:deploy:*` is for Shopify config; this is a
   Vercel deploy of the Next app). The gate/guard only protect the autopilot once live.
2. **Rebuild the 7 stub items** (the 16 sub-700w locale-rows): `npm run hub:expand --limit=1` first
   (verify one end-to-end), then the rest, then `--publish`. ~16×… up to 6 locales of generation.
3. **Queue the 35 under-developed articles** (the 197 locale-rows) in green-lit waves, EN-indexed first.
   Hype-title/near-duplicate slugs below are **merge** candidates, not blind expand.

### The 35 under-developed articles (EN word count / tier floor)

| EN words | Floor | Type | Pillar | Slug |
|---:|---:|---|---|---|
| 969 | 1500 | cluster | chargebacks | shopify-chargeback-inquiry-vs-chargeback |
| 969 | 1500 | cluster | chargebacks | shopify-chargeback-proof-delivery-not-enough |
| 1016 | 1500 | cluster | chargebacks | chargeback-prevention-checklist |
| 1039 | 1500 | cluster | chargebacks | chargeback-response-time-requirements |
| 1048 | 1500 | cluster | chargebacks | defending-subscription-chargebacks-shopify |
| 1075 | 1500 | cluster | chargebacks | understanding-managing-chargebacks-dispute-guide *(rename: hype title)* |
| 1089 | 1500 | cluster | chargebacks | digital-product-chargeback-shopify-evidence-strategies |
| 1095 | 1500 | cluster | chargebacks | shopify-chargeback-evidence-product-not-received |
| 1123 | 1500 | cluster | chargebacks | shopify-chargeback-evidence-delivered-not-received |
| 1125 | 1500 | cluster | chargebacks | shopify-inquiry-vs-chargeback-differences *(dup of inquiry-vs-chargeback → merge)* |
| 1126 | 1500 | cluster | chargebacks | how-to-build-a-chargeback-evidence-pack |
| 1126 | 1500 | cluster | chargebacks | responding-fraudulent-chargebacks-shopify |
| 1162 | 1500 | cluster | chargebacks | navigating-chargebacks-dispute-operational-guide *(rename: hype title)* |
| 1167 | 1500 | cluster | chargebacks | shopify-issuer-response-won-or-lost |
| 1172 | 1500 | cluster | chargebacks | using-login-access-logs-chargeback-evidence |
| 1184 | 1500 | cluster | chargebacks | mastering-chargebacks-dispute-guide *(rename: hype title; dup → merge)* |
| 1196 | 1500 | cluster | chargebacks | visa-compelling-evidence-3-shopify-guide |
| 1212 | 1500 | cluster | chargebacks | understanding-issuer-claims-shopify-checks *(rename: hype title)* |
| 1221 | 1500 | cluster | chargebacks | mastering-chargebacks-dispute-tactical-approaches *(rename: hype title; dup → merge)* |
| 1227 | 1500 | cluster | chargebacks | shopify-chargeback-evidence-checklist |
| 1231 | 1500 | cluster | chargebacks | item-not-as-described-chargeback-shopify |
| 1235 | 3000 | **pillar/HUB** | chargebacks | shopify-chargebacks-practical-merchant-guide |
| 1263 | 1500 | cluster | chargebacks | effective-strategies-handling-chargebacks-disputes |
| 1266 | 1500 | cluster | chargebacks | chargebacks-faq-timelines-fees-next-steps |
| 1335 | 1500 | cluster | chargebacks | reducing-friendly-fraud-shopify-sales |
| 1137 | 1500 | cluster | dispute-management-software | top-chargeback-management-tools-shopify *(dup → merge)* |
| 1137 | 3000 | **pillar** | dispute-management-software | dispute-management-software-shopify-guide |
| 1204 | 1500 | cluster | dispute-management-software | top-chargeback-management-tools-shopify-merchants *(dup → merge)* |
| 1429 | 1500 | cluster | dispute-management-software | automated-evidence-packs-shopify-check |
| 1097 | 1500 | cluster | dispute-resolution | online-dispute-resolution-odr-guide |
| 1178 | 1500 | cluster | dispute-resolution | how-to-write-a-demand-letter |
| 1251 | 1500 | legal_update | dispute-resolution | policy-update-roundup |
| 1255 | 3000 | **pillar** | dispute-resolution | dispute-resolution-process-playbook |
| 1265 | 3000 | **pillar** | dispute-resolution | shopify-dispute-prevention-program |
| 1123 | 1500 | cluster | mediation-arbitration | mediation-vs-arbitration-vs-small-claims |

> Pillars (3000-floor) should be reviewed by a human before publish (autopilot already holds Tier A at
> `in-editorial-review`). The `*(dup → merge)*` rows are near-duplicate slugs — consolidate to one
> canonical + redirect rather than expanding both.
