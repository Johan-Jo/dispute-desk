# Carrier Delivery Verification — direct carrier-API adapters (DHL first)

**Status:** planned — not started
**Origin:** 2026-07-15 DHL Freight investigation on cay-collective (dispute #891BECCC / order #12809)
**Related memory:** `project_delivery_confirmation_shopify_gap`
**Diagnostic script:** `scripts/inspect-dhl-order-12809.ts` (parameterized by order GID, read-only)
**Carrier-mix audit SQL:** `scripts/sql/audit-pack-carrier-mix.sql`

---

## 1. Problem

Delivery confirmation is the single strongest evidence class for item-not-received
(INR) chargebacks, and we currently only get it when **someone else** writes it into
Shopify:

1. **Shopify native tracking** writes `Fulfillment.events` / `deliveredAt` — but
   ONLY when `trackingInfo.company` exactly matches Shopify's supported-carriers
   list (shopify.dev, FulfillmentTrackingInfo). Verified live on cay prod:
   - `PostNord SE` (on the list) → order #12936 has 22 events incl. delivered ✔
   - `DHL Freight` (NOT on the list — only DHL Express / DHL eCommerce / DHL
     eCommerce Asia are) → order #12809 has **zero** events, fulfillment untouched
     since creation ✘
2. **Tracking-app metafields** (AfterShip, Shipway, ParcelPanel, Wonderment,
   TrackingMore — `lib/shopify/trackingApps.ts`) — only if the merchant pays for
   and installs one.

When neither source fires, the dispute page can only say "no delivery confirmation
has reached Shopify" (honest-copy fix, PR #295) while the carrier's own tracking
page shows a terminal delivered state. On #12809 the DHL Freight page showed
"Picked up by receiver" (2026-06-04, DIREKTEN LÖDÖSE Servicepoint) — decisive INR
evidence we could not cite because Shopify never received it.

**Goal:** a dispute-triggered adapter layer that queries carrier tracking APIs
directly and feeds the same normalized delivery fields the rest of the pipeline
already consumes. Not a tracking product — we look up single shipments only when
a dispute needs evidence.

## 2. Real carrier mix (prod evidence packs, 2026-07-15)

`scripts/sql/audit-pack-carrier-mix.sql` over `evidence_packs.pack_json`
(`"carrier"` values written by `lib/packs/sources/fulfillmentSource.ts`):

| Carrier (verbatim `trackingInfo.company`) | Packs | Shopify native sync? |
|---|---|---|
| PostNord SE | 5 | ✔ on supported list (verified syncing) |
| DHL Freight | 3 | ✘ NOT on list → zero events |
| DHL | 2 | ✘ bare "DHL" is not a listed string (list has DHL Express / DHL eCommerce / DHL eCommerce Asia) |
| GLS | 1 | ✔ listed |
| Bring | 1 | ✔ listed |

DHL (Freight + bare) = 5 of 12 carrier mentions and 100% of the *broken* ones.
DHL is unambiguously the P0 adapter.

## 3. Carrier roster

Priorities: **P0** = observed in prod disputes AND broken today. **P1** = build
next to prove the adapter interface is generic / anticipated for onboarding
(FedEx-shipping merchants are a target segment). **P2** = observed in prod but
native sync currently works — adapter is a fallback for merchants whose setup
doesn't sync. **P3** = classifier vocabulary already supports them
(`lib/shopify/deliveryEventClassifier.ts` research set); build on demand when a
merchant's dispute mix warrants it.

| # | Carrier | Priority | API | Auth | Cost / limits | Notes |
|---|---------|----------|-----|------|---------------|-------|
| 1 | **DHL** (all divisions: Freight, Express, eCommerce, Parcel) | **P0** | DHL **Unified Shipment Tracking API** (developer.dhl.com) — explicitly covers DHL Freight incl. Sweden; has Push API | API key + secret. **Already in `.env.local` as `DHL_API_KEY` / `DHL_API_SECRET`** — still needs adding to Vercel dev + prod envs | Free tier 250 calls/day — ample for dispute-triggered lookups | TRAP: for DHL Freight fulfillments the stored tracking `number` is DHL's *customer confirmation number* (e.g. 5198980574); the real tracking id (373325386394209542) lives only in the tracking URL query param `tracking-id=` — the adapter MUST parse the URL |
| 2 | **FedEx** | P1 | FedEx **Track API** (developer.fedex.com) | OAuth2 client-credentials (API key + secret per project) | Free | Not yet observed in prod packs; expected from prospective merchants. Build as adapter #2 to prove the interface generalizes |
| 3 | **PostNord** | P2 | PostNord **Track & Trace API** (developer.postnord.com) | OAuth2 client-credentials — requires a PostNord **business account** | Business-account gated | Native sync works today for cay; adapter is the fallback for PostNord merchants without a syncing integration. Signature/POD is a SEPARATE PostNord API and only exists when the merchant bought an attended/signature service — do not chase (structurally ~0 since 2026-01) |
| 4 | **Bring** | P2 | Bring **Tracking API** (developer.bring.com) | API key via Mybring account | Free | Classifier already handles Bring quirk: `DELIVERED_SENDER` = returned, not delivered |
| 5 | **GLS** | P2 | GLS Track & Trace (per-country REST; unit varies: gls-group.eu) | Varies by country unit | Varies | Listed carrier, currently syncing; low urgency |
| 6 | **UPS** | P3 | UPS **Track API** (developer.ups.com) | OAuth2 client-credentials | Free | |
| 7 | **USPS** | P3 | USPS **Tracking 3.0 API** (developers.usps.com) | OAuth2 | Free | US merchants — none live yet |
| 8 | **DPD** | P3 | DPD tracking APIs (per-country business units) | Varies | Varies | |
| 9 | **PostNL** | P3 | PostNL **Shipment status API** | API key (business account) | Business-gated | |
| 10 | **Colissimo / La Poste** | P3 | La Poste **Suivi v2** (developer.laposte.fr) | API key | Free tier | |
| 11 | **Correos (ES)** / **CTT (PT)** | P3 | Correos / CTT tracking APIs | Business-gated | Varies | ES/PT locale merchants |

API details for P1–P3 rows are from 2026-07 research at plan-time — **re-verify
each carrier's current auth model + rate limits at implementation time.**
The DHL row was verified against developer.dhl.com on 2026-07-15.

**Key/credential policy:** these are **DisputeDesk platform keys** (we call the
carrier API on the merchant's behalf; tracking lookups need no merchant secret) —
merchants never paste keys. Exception: business-account-gated carriers (PostNord,
PostNL, Correos/CTT) may require the *merchant's* account; if we ever need
merchant credentials, collect them via a portal form, never email
(`feedback_vendor_portal_first`).

## 4. Architecture

New module: `lib/carriers/`

```
lib/carriers/
  types.ts        → CarrierAdapter interface + normalized result types
  registry.ts     → resolveCarrierAdapter(company, trackingUrl) — detection
  dhl.ts          → P0 adapter (Unified Shipment Tracking API)
  fedex.ts        → P1 adapter (Track API)
  __tests__/
```

### 4.1 Adapter interface

```ts
interface CarrierAdapter {
  /** Can this adapter handle the fulfillment's tracking info?
   *  Returns the REAL tracking number (URL-parsed when the stored
   *  number is not the tracking id — see DHL Freight trap) or null. */
  match(info: { company: string | null; number: string | null; url: string | null }): string | null;

  /** Fetch the shipment timeline from the carrier API.
   *  Returns normalized events (happenedAt + status code + message)
   *  or null on any error — a carrier-API failure must NEVER fail
   *  a pack build. */
  fetchTimeline(trackingNumber: string): Promise<CarrierEvent[] | null>;
}
```

### 4.2 Classification — reuse the PR #236 vocabulary, prefer structured codes

Carrier APIs return **structured status codes** (e.g. DHL `status.statusCode:
delivered`), which are more reliable than message-text regex. Each adapter maps
carrier codes to the existing native vocabulary from
`supabase/migrations/20260706170000_delivery_status_native_values.sql`:
`Delivered | DeliveredToPickup | Returned`. Where a carrier's codes are ambiguous
(pickup-point deliveries reusing the "delivered" verb), fall back to
`classifyDeliveryTimeline` message rules — its multilingual pickup/neighbour/
return checks exist precisely for this.

Latest-terminal-event-wins (handles return-then-redeliver), same as the native
classifier.

### 4.3 Invocation point — dispute-triggered only

In `lib/packs/sources/fulfillmentSource.ts` (pack build path):

1. Existing sources first: tracking-app metafields → native carrier events
   (unchanged priority).
2. **NEW fallback:** if neither produced a delivery signal AND the fulfillment
   has tracking info AND a registered adapter matches → call the carrier API,
   classify, and feed the result into the same downstream shape
   (`carrierTracking`, delivery evidence rows, chronology, signature extraction
   where the API provides a POD name).
3. Persist the result to `shopify_orders` (`delivery_status`,
   `delivered_at_tracking`, `signed_by_name` when available) with a new
   `tracking_source` value per carrier: `carrier_api_dhl`, `carrier_api_fedex`, …
   — so the Insights KPI, admin, and any pack REBUILD reuse the cached result
   without a second API call.

Volume math: lookups happen only for disputed orders with no existing delivery
signal — single-digit calls/day for the current merchant base, far under DHL's
250/day free tier. No backfill sweeps, no polling. (If a non-terminal status is
cached, a pack rebuild may re-fetch; add a simple "skip re-fetch if terminal"
guard.)

### 4.4 Config / gating

- Per-carrier env keys, adapter self-disables when unset:
  `DHL_API_KEY` + `DHL_API_SECRET` (present in `.env.local`; **add to Vercel
  dev + prod**), later `FEDEX_API_KEY` + `FEDEX_API_SECRET`, etc.
- No cron. No new route (server-side calls from the pack builder / job worker
  only). If a probe/debug route is ever added under `app/api/admin/**`, it is
  admin-gated read-only and deleted after use.

## 5. Chargeback-safety rules (carry-over, non-negotiable)

1. **Absence ≠ not delivered.** A carrier-API miss (no match, API error, no
   terminal event) must never generate negative language. Only positive signals
   flow into evidence.
2. **`DeliveredToPickup` ≠ `Delivered` in the KPI** (unchanged from PR #236).
   BUT it IS decisive INR evidence — the pack should cite it verbatim and
   honestly ("picked up by receiver at {servicepoint}, {date}"), which is exactly
   the #12809 case. New i18n tokens ×6 locales, structural-i18n rules apply
   (tokens from `lib/`, never resolved English).
3. **Bank non-disclosure:** rebuttal text cites only strengthening facts; a
   `Returned` classification must never leak into bank-facing copy as "carrier
   says returned" — it caps strength via the existing scoring path instead.
4. Carrier-API data is labeled with its source in evidence provenance
   (`tracking_source`), same as `shopify_native` vs tracking-app values — the
   admin section must show which source supplied delivery
   (`feedback_admin_is_source_of_truth`).
5. Adapter failures are logged and swallowed — pack build never breaks on a
   carrier outage.

## 6. PR breakdown

**PR 1 — adapter framework + DHL adapter (P0).**
`lib/carriers/` (types, registry, dhl), URL-parsing for the `tracking-id=` trap,
status-code mapping + classifier fallback, wire into `fulfillmentSource`,
persist-to-`shopify_orders` cache, tests (fixture timelines: delivered /
picked-up-by-receiver / returned / in-transit / API error), docs
(`docs/technical.md` § new *Carrier Delivery Verification* section), i18n tokens
for the servicepoint-pickup evidence row ×6 locales.
**Acceptance:** rebuild the #891BECCC pack on cay (dev-mirrored or prod with
explicit go) → the DHL Freight lookup returns the 2026-06-04
"picked up by receiver" event and the pack cites it. Verify with
`scripts/inspect-dhl-order-12809.ts` before/after.
Ops: add `DHL_API_KEY`/`DHL_API_SECRET` to Vercel dev + prod.

**PR 2 — persist `tracking_company` / `tracking_number` / `tracking_url` on
`shopify_orders`** (migration + ingest/backfill queries already fetch
`trackingInfo` — just project it). Purpose: carrier detection without pack-JSON
regex, roster audits (`audit-pack-carrier-mix.sql` becomes a plain `group by`),
and future "which merchants ship with X" questions. Run migration same-session
via `npm run db:migrate:dev` (guarded).

**PR 3 — FedEx adapter (P1).** Proves the interface generalizes beyond DHL.
Needs FedEx developer keys first (platform account — create at
developer.fedex.com). Same test matrix as PR 1.

**PR 4+ — P2/P3 adapters on demand** (PostNord, Bring, GLS, UPS, USPS, DPD,
PostNL, Colissimo, Correos/CTT), each a small PR against the fixed interface.
Trigger: a real merchant dispute mix that needs one, not speculative build-out.

**Related but separate backlog (not this plan):** honest empty state for
"Confirmed deliveries 0%" when a shop has zero delivery-signal sources
(tracked in `project_delivery_confirmation_shopify_gap` follow-ups).

## 7. Open questions

1. **PostNord business account** — do we (or cay) have one? Gates the P2
   PostNord adapter; not needed for P0/P1.
2. **Push APIs** (DHL has one) — skip for v1; dispute-triggered pull is enough
   and avoids webhook infrastructure. Revisit only if lookup volume ever
   threatens rate limits.
3. **Merchant-credential carriers** (PostNL, Correos, CTT) — if a merchant needs
   one, design the portal form flow then; out of scope for P0/P1.
