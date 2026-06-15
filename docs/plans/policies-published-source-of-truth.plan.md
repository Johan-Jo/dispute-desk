# Policies → Published-on-Store as Source of Truth

**Status:** Proposed
**Created:** 2026-06-15
**Owner:** TBD

## 1. Problem

DisputeDesk's onboarding wizard ([BusinessPoliciesStep.tsx](../../components/setup/steps/BusinessPoliciesStep.tsx)) offers three flows for store policies: **own** (URL/upload), **template** ("use our policies"), and **mixed**. The **template** flow is conceptually broken for chargeback evidence.

A store policy only has evidentiary value to a bank if it was **published and visible to the customer at the time of purchase**. The card networks and Shopify make this explicit:

- Shopify's `refundPolicyDisclosure` evidence field literally asks "*when and where you showed the customer your refund policy*."
- On a *credit-not-processed* dispute, Shopify wants the refund/return policy **and proof of where the customer saw it**.
- Competitors (Chargeflow, Justt, Signifyd) **collect the merchant's published policies** and cite where they were shown. None of them generate a policy and submit it as if it were live.

Today's "template" flow takes DisputeDesk-authored boilerplate, stores it in `policy_snapshots`, and folds it into the bank-facing defense PDF via [policySource.ts](../../lib/packs/sources/policySource.ts) — text that lives **only in our database, with no storefront URL behind it**.

The problem is **provability, not honesty.** (An earlier framing worried this "overstates disclosure" — that's largely a timing edge case: for a freshly-installed app, almost every dispute is for an order placed *after* the merchant adopted the policy, so the policy genuinely was live. We drop that argument.) The real issue:

- **A policy that lives only in our DB isn't provable to the bank.** Its evidentiary weight comes from being *findable on the merchant's storefront* — a live URL the bank could click (the footer links: Refund policy, Shipping, etc.).
- Shopify's `refundPolicyDisclosure` field asks "*where did you show the customer this policy?*" A `shopify_published` policy answers that with a citable URL. A template-in-our-DB has no "where" — it reads as "the merchant told their dispute tool this is their policy," which a bank discounts.

So the distinction is **provable (has a live storefront URL) vs. unprovable (DB-only)**. The "own / upload" flow is already on the right side of this and matches industry practice. The fix is to make **published-on-store the primary, citable evidence path**, and reframe templates as a **setup aid** that funnels merchants toward publishing — so their policy gets a citable URL — not as something we cite directly. Merchant-facing copy sells this as "this makes your policy count," **not** as a disclosure scolding.

## 2. Current State (verified)

- **Schema** ([005_rules_policies.sql](../../supabase/migrations/005_rules_policies.sql), [025](../../supabase/migrations/025_policy_snapshots_privacy_contact.sql), [storage_path migration](../../supabase/migrations/20260519015032_policy_snapshots_storage_path.sql)): `policy_snapshots(id, shop_id, policy_type, url, content_hash, extracted_text, captured_at, storage_path)`. `policy_type ∈ {refunds, shipping, terms, privacy, contact}`. **No origin column** distinguishing published / uploaded / template. **No disclosure-context column.**
- **Collector** ([policySource.ts](../../lib/packs/sources/policySource.ts)): dedups to latest per type, maps `shipping→shipping_policy`, `refunds→refund_policy`, `terms→cancellation_policy`, emits a combined `policy` section + per-type display-only sections. No strength classification, no disclosure context.
- **Apply route** ([apply/route.ts](../../app/api/policies/apply/route.ts)): inserts template/text content into `extracted_text` + `storage_path`. **This is the broken path.**
- **Upload route** ([upload/route.ts](../../app/api/policies/upload/route.ts)): inserts uploaded file at `storage_path`, no `extracted_text`.
- **Shopify**: API version `2026-01` ([client.ts](../../lib/shopify/client.ts)). **No existing query against the `Shop` object or its policies.** `Shop.shopPolicies` returns `[ShopPolicy!]!` where `ShopPolicy = { id, type: ShopPolicyType, title, body: HTML, url: URL, createdAt, updatedAt, translations }`. These are exactly the footer links (Refund policy, Shipping, Privacy, Terms of service, Cancellations, Contact).
- **Tests**: none for policies / policySource / policy_snapshots today.

## 3. Goals

1. Auto-ingest the merchant's **published** Shopify store policies on connect (and refresh), as the primary, zero-effort, **citable** evidence path.
2. Track **provenance** (published / uploaded / external-URL / template) and the **live URL** on each snapshot, so the PDF can cite where the policy is published.
3. Make **only policies with a citable source** flow into the bank-facing defense package. A template the merchant merely picked stays a draft (no storefront URL → nothing to cite) until it's published and recaptured.
4. Keep the **upload / external-URL** path for merchants whose policies aren't Shopify-hosted.

### Non-goals

- Programmatically publishing policies to the merchant's store on their behalf (we cannot, and shouldn't, silently write a merchant's legal terms). We *guide* them to publish via Shopify's own policy editor.
- Submitting policy text as structured Shopify evidence fields — the PDF remains the sole bank-facing artifact (see [composeShopifyMutationPayload.ts](../../lib/shopify/composeShopifyMutationPayload.ts)). This plan changes *what goes into the PDF*, not the Shopify submission contract.

## 4. Design

### 4.1 Schema: provenance + disclosure context

New migration `supabase/migrations/<ts>_policy_snapshots_source_disclosure.sql`:

```sql
alter table policy_snapshots
  add column if not exists source text not null default 'uploaded'
    check (source in ('shopify_published','uploaded','external_url','template')),
  -- also widen policy_type to include 'subscription' (see 4.2):
  --   drop + re-add policy_snapshots_policy_type_check with
  --   ('refunds','shipping','terms','privacy','contact','subscription')
  add column if not exists published_url text,            -- live storefront URL (the citable "where")
  add column if not exists shopify_policy_id text,         -- ShopPolicy.id, for refresh dedup
  add column if not exists policy_updated_at timestamptz;  -- ShopPolicy.updatedAt (staleness signal)

-- No active merchants, so no careful backfill needed: the 'uploaded' default
-- is harmless for the handful (if any) of pre-existing rows, and the next
-- "refresh from store" supersedes them with shopify_published snapshots.
```

Add `'shopify_published'` provenance as the highest-trust source. `source = 'template'` rows are explicitly **excluded** from bank evidence (see 4.4) — not because citing them would be dishonest, but because a DB-only draft has no storefront URL to cite.

### 4.2 Shopify query: fetch published policies

New `lib/shopify/queries/shopPolicies.ts`:

```graphql
query ShopPolicies {
  shop {
    shopPolicies {
      id
      type
      title
      body
      url
      createdAt
      updatedAt
    }
  }
}
```

Register in [registry.ts](../../lib/shopify/queries/registry.ts) so it's covered by the GraphQL contract tests. Map `ShopPolicyType` → our `policy_type`:

| ShopPolicyType            | our policy_type |
|---------------------------|-----------------|
| `REFUND_POLICY`           | `refunds`       |
| `SHIPPING_POLICY`         | `shipping`      |
| `TERMS_OF_SERVICE`        | `terms`         |
| `PRIVACY_POLICY`          | `privacy`       |
| `CONTACT_INFORMATION`     | `contact`       |
| `SUBSCRIPTION_POLICY`     | `subscription`  |
| `LEGAL_NOTICE` / others   | (ignore)        |

`subscription` is a **new** `policy_type` — add it to the `policy_snapshots` CHECK constraint in 4.1's migration (current allowed set is `refunds, shipping, terms, privacy, contact`). It only ingests when the store actually has a subscription policy; it's harmless otherwise.

> **Verify the exact enum values against the live 2026-01 schema before coding** — the docs page didn't enumerate `ShopPolicyType`. Use the introspection pattern already in [enumIntrospection.ts](../../lib/shopify/queries/enumIntrospection.ts) if needed. `body` is **HTML** — strip to text for `extracted_text`, keep a hash for change detection.

### 4.3 Ingest service + trigger points

New `lib/policies/ingestShopifyPolicies.ts`:
- Runs the query, maps types, strips HTML → text, computes `content_hash`.
- Upserts into `policy_snapshots` with `source='shopify_published'`, `published_url = ShopPolicy.url`, `shopify_policy_id`, `policy_updated_at`. Dedup by `(shop_id, policy_type, shopify_policy_id)` — only insert a new snapshot when `content_hash` changed (so we keep a true history without churn).

**Trigger points:**
1. **On OAuth/connect** — after offline token is stored (where other post-install setup runs). Zero merchant effort; policies appear pre-filled.
2. **At pack-build time (defensive refresh)** — call ingest at the top of the policy collection in the build pipeline so a pack always reflects current published policies. Cheap (one GraphQL call), and guards against stale snapshots.
3. **Manual "Refresh from store" button** in the policies UI.

### 4.4 Collector: only citable policies become evidence

In [policySource.ts](../../lib/packs/sources/policySource.ts):
- Filter the latest-per-type selection to `source IN ('shopify_published','uploaded','external_url')` — **exclude `template`** from `fieldsProvided` and from the combined `policy` section. A `template` row is a DB-only draft with no storefront URL, so there's nothing to cite.
- Add to each policy entry: `publishedUrl`, `source`, `policyUpdatedAt`. The PDF builder uses `publishedUrl` to render "*Refund policy published at `{url}`.*" — giving the bank a citable location, which is what answers Shopify's `refundPolicyDisclosure` question.
- Strength note: a `shopify_published` policy with a live `published_url` is the strong case (citable); an uploaded file with no live URL is weaker (we have the text but no URL to point to). Surface this distinction in the completeness/strength signal rather than treating all snapshots equally.

### 4.5 Onboarding step rework

In [BusinessPoliciesStep.tsx](../../components/setup/steps/BusinessPoliciesStep.tsx):

- **Default state**: show the auto-ingested published policies per type with their live URL and a green "Published on your store" status. For most merchants, this step is now **review-and-confirm**, not data entry.
- **Per type with no published policy**: show the gap ("No refund policy published on your store") and two actions:
  1. **"Use our template"** → opens template preview/edit → **but the CTA is "Copy & publish on your store"**, deep-linking to the Shopify policy editor (`admin/settings/legal` / Shopify's policy settings). Messaging sells the upside, not a warning: *"Publish this on your store so it counts as evidence — we'll capture the live version automatically."* The template is **not** stored as evidence; it's saved as `source='template'` only as a draft the merchant can re-copy.
  2. **"Link / upload existing"** → existing URL/upload flow (`source='external_url'` / `'uploaded'`), for non-Shopify-hosted policies.
- After publishing, a **"Refresh from store"** action re-runs ingest and flips the row to `shopify_published`.
- Keep `templateLang` / `policy_template_lang` for the template copy.

### 4.6 Apply route reframe

[apply/route.ts](../../app/api/policies/apply/route.ts) stops being an evidence-writer and is **repurposed to save a template draft** (`source='template'`), explicitly excluded from evidence by 4.4. The preview/edit-before-copy UX keeps working; the row just no longer feeds the bank PDF. Constraint: **nothing written by the template path may carry an evidence-eligible `source`.**

## 5. Plan of Work (commits)

1. **Migration**: `policy_snapshots` source/disclosure columns + backfill. Run `npm run db:migrate` same session.
2. **Shopify query**: `shopPolicies.ts` + registry entry; verify `ShopPolicyType` enum against live 2026-01 schema; HTML→text + hashing helper.
3. **Ingest service**: `lib/policies/ingestShopifyPolicies.ts` + unit test (mapping, dedup-by-hash, HTML strip).
4. **Wire triggers**: OAuth/connect post-install + pack-build defensive refresh.
5. **Collector**: exclude `template`, add disclosure context, strength distinction; update PDF builder to render "published at {url}". Tests for evidence-eligibility filtering.
6. **Onboarding rework**: review-and-confirm UI, publish-to-store deep link, refresh button.
7. **Apply route**: reframe to draft-only / retire.
8. **i18n**: new copy ("Published on your store", "Copy & publish on your store", disclosure sentence) across all 6 locales (en/de/es/fr/pt/sv) same session.
9. **Docs**: update `docs/technical.md` (§ policies / evidence sources) + embedded help article describing the published-source model — same commit as the feature.

## 6. Testing

- `ingestShopifyPolicies` unit: type mapping, HTML strip, dedup-by-hash, ignore unknown types.
- `policySource` unit: `template` rows excluded from `fieldsProvided`; `shopify_published` rows carry `publishedUrl`; latest-per-type still holds.
- GraphQL contract test picks up `shopPolicies.ts` via registry.
- Manual: connect a dev store with published policies → confirm auto-fill → build a pack → confirm PDF cites the live URL; a store with a missing policy → confirm gap + publish CTA.
- `npm run release:verify` (lint + tsc + vitest + build) green before done.

## 7. Resolved Decisions

- **Subscription policy** — **included** (`subscription` policy_type, 4.1/4.2).
- **Apply route** — **repurposed to draft-only** (4.6).
- **Backfill** — **no active merchants**, so no careful migration; `'uploaded'` default is fine and refresh supersedes (4.1).

## 8. To Verify During Implementation (not blocking)

1. **`ShopPolicyType` exact enum values** for 2026-01 — confirm via introspection before coding the type map (docs didn't list them).
2. **Deep-link target** for "publish on your store" — the correct Shopify Admin policy-editor path for embedded App Bridge navigation.
