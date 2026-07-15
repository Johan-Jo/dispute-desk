# Carrier Delivery Verification — direct carrier-API adapters (DHL first)

**Status:** planned — not started (v2, revised 2026-07-15)
**Origin:** 2026-07-15 DHL Freight investigation on cay-collective (dispute #891BECCC / order #12809)
**Related memory:** `project_delivery_confirmation_shopify_gap`
**Diagnostic script:** `scripts/inspect-dhl-order-12809.ts` (parameterized by order GID, read-only)
**Carrier-mix audit SQL:** `scripts/sql/audit-pack-carrier-mix.sql`

> **Out of scope (handled separately, non-blocking):** carrier terms of use,
> legal authorization, data-sharing permission, required attribution, and data
> retention terms are handled in a separate workstream. They are noted here once
> and must NOT block PR 1A–1D. This plan contains no legal-review gate, consent
> flow, or retention implementation.

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
directly, reconciles the result with the existing sources, and feeds the same
normalized delivery fields the rest of the pipeline already consumes. Not a
tracking product — we look up single shipments only when a dispute needs
evidence.

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
DHL is unambiguously the P0 adapter. Once PR 1A lands, this audit becomes a plain
`group by` over `shopify_fulfillment_trackings` and, together with the
unsupported-carrier demand data (§7), drives every future adapter decision.

## 3. Carrier roster

Priorities: **P0** = observed in prod disputes AND broken today — build now.
**Conditional** = build when a live merchant, onboarding merchant, signed
prospect, or meaningful production dispute mix requires it (see §7 demand
signal). No carrier integration is built speculatively or "to prove the
architecture" — genericity is proven by a fake test adapter (§9, PR 1B).

| # | Carrier | Priority | API (as researched) | Notes |
|---|---------|----------|---------------------|-------|
| 1 | **DHL** (all divisions: Freight, Express, eCommerce, Parcel) | **P0** | DHL **Unified Shipment Tracking API** (developer.dhl.com) — explicitly covers DHL Freight incl. Sweden; free tier 250 calls/day; has Push API (not used in v1). **Verified against developer.dhl.com 2026-07-15.** | Credentials already provisioned — see §4. TRAP: for DHL Freight fulfillments the stored tracking `number` is DHL's *customer confirmation number* (e.g. `5198…0574`); the real tracking id lives only in the tracking URL query param `tracking-id=` — the adapter MUST parse the URL (§5.3) |
| 2 | **FedEx** | Conditional | FedEx Track API (developer.fedex.com) | Not yet observed in prod packs. Implement when real merchant demand appears — NOT as an automatic second adapter |
| 3 | **PostNord** | Conditional | PostNord Track & Trace API (developer.postnord.com); auth model reported as OAuth2 client-credentials with a business-account requirement — **unverified, revalidate before implementation** | Native Shopify sync works today for cay; adapter would be a fallback. PostNord signature/POD is a separate, service-gated API — do not chase (structurally ~0 since 2026-01) |
| 4 | **Bring** | Conditional | Bring Tracking API (developer.bring.com) | Classifier already handles Bring quirk: `DELIVERED_SENDER` = returned, not delivered |
| 5 | **GLS** | Conditional | GLS Track & Trace (per-country REST) | Listed carrier, currently syncing; low urgency |
| 6 | **UPS** | Conditional | UPS Track API (developer.ups.com) | |
| 7 | **USPS** | Conditional | USPS Tracking API (developers.usps.com) | US merchants — none live yet |
| 8 | **DPD** | Conditional | DPD tracking APIs (per-country business units) | |
| 9 | **PostNL** | Conditional | PostNL Shipment status API | |
| 10 | **Colissimo / La Poste** | Conditional | La Poste Suivi (developer.laposte.fr) | |
| 11 | **Correos (ES)** / **CTT (PT)** | Conditional | Correos / CTT tracking APIs | ES/PT locale merchants |

**Reverification rule for every non-DHL carrier:** the API rows above are
plan-time research notes, NOT implementation-ready facts. Before implementing
any conditional adapter, reverify from the carrier's current official
documentation: API availability, supported regions, authentication method,
credential type, business-account requirement, pricing, rate limits, permitted
use, available shipment events, proof-of-delivery availability, signature
availability, personal-data fields, and webhook/push support.

**Key/credential policy:** these are **DisputeDesk platform keys** (we call the
carrier API on the merchant's behalf; tracking lookups need no merchant secret) —
merchants never paste keys. Exception: business-account-gated carriers may
require the *merchant's* account; if we ever need merchant credentials, collect
them via a portal form, never email (`feedback_vendor_portal_first`).

## 4. DHL credentials & configuration (settled — do not reopen)

The DHL credentials are **already created and configured** as:

```env
DHL_API_KEY=
DHL_API_SECRET=
```

These names are final. Do not rename them, do not drop `DHL_API_SECRET`, do not
introduce `DHL_TRACKING_API_KEY`, and do not re-litigate the credential format.
The adapter uses **both** values as configured.

Implementation requirements:

- **Server-side only.** The credentials are read only in server code (pack
  builder / job worker). Never exposed to any client bundle, route response, or
  error message.
- **Self-disablement.** If *either* variable is missing, the DHL adapter
  disables itself and reports `configuration_missing` (§5.4) — it never throws,
  never half-runs on one credential.
- **Verification by real request.** The adapter is verified with an actual
  authenticated DHL request (a known-good tracking id) during PR 1B development
  and in the PR 1D acceptance run — not assumed correct from config presence.
- **Explicit request timeouts** on every DHL call (default 10s, constant in the
  adapter; no unbounded hangs inside a pack build).
- **HTTP 429 handling:** respect `Retry-After` when present; surface
  `rate_limited` with `retryAfterSeconds` (§5.4). **No unbounded retries** —
  at most one bounded in-process retry for transient categories, then return
  the typed failure.
- **No secrets in logs or emails.** Credentials, authorization headers, and raw
  request headers never appear in structured logs, support emails, or thrown
  errors.
- **Concurrency-safe.** Multiple workers may build packs concurrently. Lookups
  are idempotent reads; cache writes to `shopify_fulfillment_trackings` are
  single-row upserts per tracking entry (no lost-update hazard, no shared
  mutable process state); notification dedup is an atomic persistent upsert
  (§6.4) so concurrent workers cannot double-send.
- **Environments:** add `DHL_API_KEY` and `DHL_API_SECRET` to Vercel
  **development, preview, and production** environments (all three), in
  addition to the existing `.env.local` values.

## 5. Architecture

New module: `lib/carriers/`

```
lib/carriers/
  types.ts          → CarrierMatch, CarrierLookupResult, NormalizedCarrierShipment, CarrierEvent
  registry.ts       → carrier identification + adapter resolution (two layers, §5.1)
  urlTracking.ts    → safe tracking-URL parsing (§5.3)
  dhl.ts            → P0 adapter (Unified Shipment Tracking API)
  fakeCarrier.ts    → test-only adapter proving carrier-neutrality (§9, PR 1B)
  alerts.ts         → support-notification classification + persistent dedup (§6, §7)
  __tests__/
```

### 5.1 Carrier identification vs adapter resolution (two layers)

The registry has **two distinct layers**, so "we know this carrier but have no
adapter" is distinguishable from "we cannot tell what this is":

1. **Identification:** a deterministic table of known carriers
   (`KNOWN_CARRIERS`) mapping `trackingInfo.company` strings, tracking-URL
   hostnames, existing normalized carrier names, and tracking-app carrier
   metadata → a normalized carrier slug (`dhl`, `postnord`, `fedex`, …).
2. **Adapter resolution:** which identified carriers have a registered adapter.

Detection outcomes per tracking entry:

- **`matched`** — identified carrier with a registered adapter → produces a
  `CarrierMatch` (§5.2).
- **`unsupported_carrier`** — carrier identified with reasonable confidence,
  but no registered adapter and not on an explicit ignore list → triggers the
  §7 notification + demand recording. No API request is attempted; this is NOT
  an API failure.
- **`unknown_carrier`** — tracking info exists but the carrier cannot be
  reliably identified (empty/garbage company, unrecognized host) → logged and
  counted only; email only if repeated volume indicates a detection regression.
- **`no_tracking`** — fulfillment has no tracking info at all → nothing to do.

### 5.2 Structured matching

`match()` returns a structured result, never a bare tracking-number string:

```ts
type CarrierMatch = {
  carrier: "dhl";                 // normalized carrier slug (union grows per adapter)
  trackingNumber: string;         // the EFFECTIVE identifier to send to the carrier API
  divisionHint?: string;          // e.g. "freight" when derivable
  matchedFrom: "url" | "number" | "company_and_number";
  confidence: "high" | "medium";
};
```

The match records **where the effective identifier came from** (Shopify tracking
number, tracking URL, company+number, or another explicitly supported source).
For the known DHL Freight case, a `tracking-id=` parsed from the tracking URL
**takes precedence** over Shopify's stored customer-confirmation number when
both are present (`matchedFrom: "url"`).

### 5.3 Tracking-URL parsing (`urlTracking.ts`)

Parse-only — the adapter must **never make an HTTP request to the
merchant-provided tracking URL**; it only extracts an identifier and calls the
official DHL API. The parser must safely handle:

- URL encoding / double encoding;
- additional and repeated query parameters (repeated `tracking-id` → treat as
  one identifier if values are identical, `ambiguous` if they conflict);
- fragments;
- malformed URLs (return no match, never throw);
- case differences in parameter names where appropriate;
- the supported DHL host variations (allowlist of DHL-owned hostnames);
- unexpected external hosts (no extraction — an arbitrary host must not be able
  to inject an identifier);
- surrounding whitespace;
- duplicate tracking identifiers;
- potentially malicious input (the URL is untrusted data end-to-end).

### 5.4 Typed lookup outcomes (no nullable returns)

`fetchTimeline(...): Promise<CarrierEvent[] | null>` is **rejected** — a null
would hide eleven different situations (success-without-terminal-event,
not-found, ambiguous match, auth failure, missing config, carrier downtime,
network error, timeout, rate limiting, invalid response, unexpected error).
The adapter returns an exhaustive discriminated union (names may be adjusted to
codebase conventions, but the outcome must stay explicit, exhaustive,
observable, testable, and mappable to support-email categories):

```ts
type CarrierLookupResult =
  | { status: "success"; shipment: NormalizedCarrierShipment }
  | { status: "not_found" }
  | { status: "ambiguous"; candidateCount: number }
  | { status: "rate_limited"; retryAfterSeconds?: number }
  | { status: "authentication_error" }
  | { status: "timeout" }
  | { status: "network_error" }
  | { status: "unavailable" }          // carrier 5xx / outage
  | { status: "invalid_response" }     // malformed JSON / unexpected schema
  | { status: "configuration_missing" }
  | { status: "unexpected_error" };

type NormalizedCarrierShipment = {
  trackingNumber: string;
  events: CarrierEvent[];              // happenedAt + carrier status code + message
  deliveryStatus: "Delivered" | "DeliveredToPickup" | "Returned" | null; // null = no terminal event yet
  terminalAt: string | null;           // ISO timestamp of the terminal event
  podName: string | null;              // recipient/POD name when the API provides one
};
```

`success` with `deliveryStatus: null` is a **successful lookup with no terminal
event** (in transit) — distinct from `not_found`. Raw carrier payloads are not
part of the normalized shape and are not persisted by default. The pack builder
handles every branch explicitly and continues safely on all non-success
outcomes (§6.1 flow).

### 5.5 Classification — reuse the PR #236 vocabulary, prefer structured codes

Carrier APIs return structured status codes (e.g. DHL `status.statusCode`),
which are more reliable than message-text regex. Each adapter maps carrier
codes to the existing native vocabulary from
`supabase/migrations/20260706170000_delivery_status_native_values.sql`:
`Delivered | DeliveredToPickup | Returned`. Where codes are ambiguous
(pickup-point deliveries reusing the "delivered" verb), fall back to
`classifyDeliveryTimeline` message rules — its multilingual pickup/neighbour/
return checks exist precisely for this. Latest-terminal-event-wins (handles
return-then-redeliver), same as the native classifier. Classification carries a
`classification_version` so reclassification after rule changes is detectable.

### 5.6 Shipment model — one order ≠ one shipment

The design must handle: multiple fulfillments; multiple tracking entries per
fulfillment; partial fulfillment; split shipments; replacement shipments;
different carriers on one order; multiple packages on the same carrier;
duplicate tracking records; disputed line items covered by different shipments;
cancelled or superseded fulfillments.

Rules:

1. **Normalize every relevant fulfillment tracking entry** into
   `shopify_fulfillment_trackings` rows (PR 1A, §9) — one row per
   (fulfillment, tracking number).
2. **Deduplicate identical tracking identifiers** (same number on multiple
   entries → one shipment, many references).
3. **Preserve the relationship** order → fulfillment → tracking entry → carrier
   result throughout (never flatten to one order-level delivery flag at ingest).
4. **Line-item coverage:** where Shopify data permits, associate each shipment
   with the fulfilled line items and quantities it covers.
5. **Complete vs partial delivery** are distinct findings. Order-level
   definitive language ("the order was delivered") is used ONLY when the
   disputed merchandise is sufficiently covered by terminal-delivered
   shipment(s). Otherwise the evidence stays **package-level** ("shipment
   {masked ref} containing {items} was delivered on {date}") — still valuable,
   never overstated.
6. **Disputed-item coverage check:** determine whether the disputed products
   are in the delivered shipment before wording any claim.
7. **Replacement vs original:** a replacement shipment after a return is one
   customer-facing story, not two independent completed deliveries — the
   chronology presents the sequence, and only the currently-authoritative
   terminal state (§5.7) drives the delivery claim.

The evidence layer must never claim the entire disputed order was delivered
merely because one package reached a terminal state.

### 5.7 Cross-source reconciliation

Sources: carrier API results, tracking-app metafields, Shopify-native
fulfillment events, previously cached carrier results. **Do not blindly trust
whichever source ran first**, and do not skip the carrier API just because
another source has *a* positive event — that misses the case where Shopify
recorded a delivery, the shipment was later returned, and only the carrier
holds the newer return event (a stale positive would reach the pack).

The current authoritative terminal state for a shipment = the **newest
sufficiently reliable terminal event for that same shipment**, comparing event
timestamps, terminal states, shipment identity, source provenance, source
confidence, and fulfillment coverage. At minimum:

- a later `Returned` prevents an older `Delivered` from being treated as the
  current positive state;
- a later redelivery may supersede an earlier return;
- `DeliveredToPickup` stays separate from `Delivered`;
- source conflicts are visible in admin provenance — the pack must not silently
  discard contradictory carrier data;
- bank-facing evidence remains subject to the existing non-disclosure /
  strengthening-facts rules: a `Returned` result may weaken or cap scoring but
  is never automatically quoted in the bank-facing rebuttal;
- **absence of a carrier result never overrides an existing positive event**
  (an API failure or `not_found` leaves prior evidence untouched).

**Bounded lookup rule** — not every carrier is queried for every pack. The
carrier API is queried for a shipment when ANY of:

1. no usable terminal signal exists for it;
2. the existing signal may be stale (non-terminal, or terminal-positive but old
   enough that a reversal is plausible for the case at hand);
3. a stronger or more precise carrier result could materially affect an INR
   case;
4. the current sources conflict;
5. the cached carrier result is non-terminal and eligible for refresh;
6. the tracking URL contains a more authoritative carrier identifier than what
   was previously looked up;
7. a previously cached lookup failed with a retryable error and the retry
   policy permits another attempt.

A cached **terminal** carrier result is normally reused without a new API call
(retention terms handled separately, per the scope note).

### 5.8 Invocation & caching

Dispute-triggered only, in the pack build path
(`lib/packs/sources/fulfillmentSource.ts` orchestration): existing sources
first (tracking-app metafields → native events, unchanged priority), then the
bounded lookup rule (§5.7) decides per-shipment whether to call the adapter.
Results are persisted to `shopify_fulfillment_trackings` (per-shipment truth)
and rolled up to the existing `shopify_orders` delivery columns
(`delivery_status`, `delivered_at_tracking`, `signed_by_name`) with a new
`tracking_source` value per carrier (`carrier_api_dhl`, …) so the Insights KPI,
admin, and pack rebuilds reuse the cached result. Volume: single-digit
lookups/day at the current merchant base — far under DHL's 250/day free tier.
No cron, no polling, no backfill sweeps.

## 6. Operational failure handling & support notifications

Carrier API errors must never break evidence-pack generation — and must never
disappear silently. Every distinct actionable carrier-integration failure sends
an operational notification email to:

```text
support@disputedesk.com
```

**Reuse the existing server-side transactional-email utility** (the
Resend-backed admin notification helper already used for new-merchant install
emails — it already swallows its own delivery errors). Do not build a separate
email delivery system.

### 6.1 Failure flow (mandatory order)

1. Catch the carrier lookup error.
2. Classify it into an error category (§6.2).
3. Generate or reuse a correlation ID (one per pack-build lookup attempt).
4. Log the failure with structured logging (§8 fields).
5. Send the support email (subject to dedup, §6.4).
6. Return the explicit non-success `CarrierLookupResult`.
7. Continue the evidence-pack build without carrier-derived evidence.
8. Never generate negative delivery language because of the failure.

A failure to SEND the support email is itself logged (`notification_error`) but
never fails the pack build.

### 6.2 Error categories

`authentication_error`, `rate_limited`, `timeout`, `network_error`,
`not_found`, `ambiguous_match`, `invalid_response`, `carrier_unavailable`,
`configuration_missing`, `unexpected_error`, `notification_error` — plus the
non-API detection categories `unsupported_carrier` and `unknown_carrier` (§7),
which are never conflated with API failures.

### 6.3 Support email contents

Include: environment (development / preview / production); carrier; adapter
name; adapter version; error category; HTTP status where available; shop ID (or
another safe internal shop identifier); Shopify order ID; dispute ID;
fulfillment ID where available; correlation ID; lookup timestamp; whether the
error appears retryable; sanitized error message; **masked** tracking reference
(e.g. last 4 characters); link to the relevant internal admin page when one
exists.

Never include: full tracking numbers; recipient names; customer email
addresses; delivery addresses; phone numbers; signatures; raw proof-of-delivery
documents; raw carrier payloads; API keys or secrets; authentication headers;
cookies; any unnecessary personal information.

### 6.4 Alert-storm prevention (persistent dedup)

Repeated emails must not be produced by automatic retries, duplicate jobs,
repeated pack rebuilds, concurrent workers on the same shipment, or temporary
queue duplication.

**Mechanism:** a persistent incidents table — serverless workers share no
process memory, so in-memory dedup alone is forbidden:

```
carrier_alert_incidents
  id                    uuid pk
  environment           text
  incident_key          text unique   -- environment + carrier + shop + (fulfillment id | masked tracking ref) + error category
  carrier               text          -- normalized slug
  shop_id               uuid
  category              text
  occurrence_count      int
  first_seen_at         timestamptz
  last_seen_at          timestamptz
  last_notified_at      timestamptz
  suppressed_until      timestamptz
  sample_correlation_id text
```

Service-role access only (RLS deny-all), following the project's existing
migration/tenancy conventions. Behavior: first occurrence of an incident key →
send email, set `suppressed_until` (default **6 hours** for operational error
categories); further occurrences inside the window → increment
`occurrence_count`, log/metric each one, send nothing; window expiry with new
occurrences → notify again. Insert-or-update is a single atomic upsert so
concurrent workers cannot double-send. Genuinely separate incidents (different
key) always produce separate notifications — errors are NOT collapsed into a
daily summary.

### 6.5 `not_found` policy

A legitimate carrier "shipment not found" for a syntactically valid identifier
is not automatically an operational error:

- **Isolated `not_found`** → structured log + metric, no immediate email.
- **Email-worthy `not_found` patterns:** repeated unexpected not-founds,
  malformed identifier extraction, a previously-working shipment suddenly
  failing, or any pattern indicating an integration regression.
- **`ambiguous_match` always emails** — DisputeDesk must never silently pick an
  arbitrary shipment.
- Authentication, configuration, schema (`invalid_response`), timeout, carrier
  outage, and rate-limit failures notify per the dedup rules.

## 7. Unsupported-carrier detection & notification

When a fulfillment carries a **recognizable carrier that has no registered
adapter**, that is not an API failure (no request was attempted) — it is
classified separately as `unsupported_carrier` and generates a notification
email to:

```text
support@dispute-us.com
```

Suggested subject: `[DisputeDesk] Unsupported carrier detected: {carrier}`.

The pack build continues normally on Shopify-native / tracking-app data. A
missing adapter never breaks pack generation, never produces negative delivery
language, never implies the shipment was not delivered, and never removes
otherwise-valid Shopify or tracking-app evidence.

### 7.1 Detection rules

Notify when ALL of:

1. the fulfillment contains tracking information;
2. the carrier is identifiable with reasonable confidence — via
   `trackingInfo.company`, a recognized carrier tracking-URL hostname, an
   existing normalized carrier name, tracking-app carrier metadata, or other
   deterministic carrier-identification logic already in the codebase;
3. no registered adapter supports that carrier;
4. the carrier is not deliberately excluded via an explicit ignore list;
5. no notification for the same carrier + merchant has been sent inside the
   dedup window.

Empty or unrecognizable carrier values are NOT `unsupported_carrier` — they are
recorded separately as **`unknown_carrier`**: logged and counted only, with an
email only if repeated volume indicates a detection regression.

### 7.2 Email contents

Include: environment; detected (normalized) carrier name; original sanitized
Shopify carrier value; which source identified it (company / URL hostname /
other); tracking URL **hostname only** (never the complete URL or query
parameters); shop ID or safe internal shop identifier; Shopify order ID;
dispute ID where available; fulfillment ID; correlation ID; detection
timestamp; recent occurrence count for this carrier where available; link to
the relevant internal admin page where available; a clear statement that no
DisputeDesk adapter currently supports this carrier.

Never include: complete tracking numbers; tracking URL query parameters;
recipient or customer details; addresses; signatures; raw Shopify payloads;
credentials or secrets.

### 7.3 Dedup

Key: `environment + "unsupported_carrier" + normalized_carrier + shop_id` —
per merchant+carrier, NOT per order (no email per affected dispute). Same
persistent `carrier_alert_incidents` storage as §6.4. Behavior:

- first occurrence for a merchant+carrier → send;
- suppress repeats for the same merchant+carrier for a longer window
  (default **7 days**), while continuing to increment occurrence metrics;
- re-notify when the window expires with continued occurrences, or when the
  occurrence count crosses a meaningful threshold (e.g. 10 / 100 / 1000);
- a different merchant using the same unsupported carrier produces its own
  separate notification.

### 7.4 Product-demand signal

Unsupported-carrier detections are structured product-demand data — future
adapter priority comes from real merchant usage, not speculation. Track per
(normalized carrier, shop): affected fulfillment count; affected dispute count;
first and most-recent detected timestamps; whether an adapter has since been
registered (computed against the registry at read time). The
`carrier_alert_incidents` rows plus a small aggregate view must answer: which
unsupported carriers appear most often, how many merchants use each, how many
disputes are affected, and which adapter to implement next.
Unsupported-carrier counts are surfaced in the admin carrier audit view (or an
equivalent internal view).

## 8. Observability

Structured metrics/log events for: adapter matches (by match source);
unmatched fulfillments; lookup attempts; successful responses; shipments not
found; ambiguous responses; timeouts; network failures; rate limits;
authentication failures; missing configuration; invalid carrier responses;
carrier unavailability; unexpected errors; support emails sent; support emails
suppressed by dedup; support-email failures; cache hits; cache misses; cache
refreshes; terminal-result reuse; classification outcomes; source conflicts;
partial-delivery findings; complete-delivery findings; plus
`unsupported_carrier_detected`, `unsupported_carrier_email_sent`,
`unsupported_carrier_email_suppressed`, `unsupported_carrier_email_failed`,
`unknown_carrier_detected`.

Recorded fields: carrier; adapter name; adapter version; classification
version; lookup source; fetch timestamp; correlation ID; normalized result;
retryability; environment; safe internal order and shop identifiers.

Never recorded: API credentials; authorization headers; full tracking numbers;
customer names; customer addresses; signatures; raw proof-of-delivery
documents; unnecessary raw carrier payloads.

## 9. PR breakdown

Persistence lands **before** the carrier integration that depends on it.

### PR 1A — normalized fulfillment-tracking persistence

New table `shopify_fulfillment_trackings` (project's existing naming / ID /
migration / RLS / tenancy conventions) — NOT three scalar columns on
`shopify_orders`, because one order can hold many fulfillments and many
tracking numbers. Fields (adjust to conventions): internal ID; shop ID;
Shopify order ID; Shopify fulfillment ID; normalized carrier name; original
`trackingInfo.company`; tracking number; tracking URL; effective carrier
identifier; identifier source; carrier adapter; fulfillment status; shipment
status; fulfilled line-item coverage; quantity coverage; created timestamp;
updated timestamp; last carrier lookup timestamp; last carrier lookup result;
terminal-state timestamp; tracking source; adapter version; classification
version. Raw carrier payloads are NOT stored by default.

Ingest/backfill queries already fetch `trackingInfo` — project it into the new
table. Also in this PR: the `carrier_alert_incidents` table (§6.4). Migration
applied same-session via `npm run db:migrate:dev` (guarded). The §2 audit SQL
is rewritten as a plain `group by` over the new table.

### PR 1B — adapter framework + DHL adapter

Carrier adapter types; two-layer registry (§5.1); structured carrier matching
(§5.2); DHL URL parsing (§5.3); typed lookup outcomes (§5.4); DHL status
normalization + classifier fallback (§5.5); request timeout; bounded retry and
rate-limit handling (§4); support-email notifications + persistent dedup (§6);
unsupported/unknown-carrier detection, notification, and demand recording (§7);
structured logging (§8); deterministic **redacted** fixtures; tests (§10).

Includes the **fake test adapter** (`fakeCarrier.ts`) proving the framework is
carrier-neutral without a second production integration: the registry supports
multiple adapters; carrier matching is independent of DHL; typed outcomes work
across adapters; normalization contains no DHL-specific assumptions; error
handling is not coupled to DHL; support notifications work for any carrier;
source reconciliation is carrier-neutral.

Ops: add `DHL_API_KEY` / `DHL_API_SECRET` to Vercel development, preview, and
production.

### PR 1C — evidence-pack integration & reconciliation

Bounded invocation rules (§5.7); multi-shipment evaluation + disputed-line-item
coverage (§5.6); cross-source reconciliation; cache reuse + refresh rules;
delivery evidence rows; chronology integration; scoring effects; provenance;
admin source display (`feedback_admin_is_source_of_truth`); safe failure
continuation; i18n tokens for the new evidence copy ×6 locales (structural
rules: tokens emitted from `lib/`, never resolved English); docs
(`docs/technical.md` § *Carrier Delivery Verification*) and merchant-facing
help where applicable — same commit.

### PR 1D — controlled production verification

The known cay-collective DHL Freight case is the acceptance test (§11).
**Explicit approval required before any production mutation or evidence-pack
rebuild.**

### Conditional — FedEx and later carriers

FedEx is implemented **when a live merchant, onboarding merchant, signed
prospect, or meaningful production dispute mix requires it** — not as an
automatic next PR. Architectural genericity is already proven by the fake
adapter in PR 1B; no speculative carrier integration is built for
architectural demonstration. All other carriers follow the same demand trigger
(§7.4 data), each as a small PR against the fixed interface, with the §3
reverification checklist completed first.

**Related but separate backlog (not this plan):** honest empty state for
"Confirmed deliveries 0%" when a shop has zero delivery-signal sources
(tracked in `project_delivery_confirmation_shopify_gap` follow-ups).

## 10. Test matrix

**Adapter / lookup:** delivered; pickup-point delivery (`DeliveredToPickup`);
returned; in-transit (success, no terminal event); missing `DHL_API_KEY`;
missing `DHL_API_SECRET`; authentication failure; request timeout; network
error; HTTP 429 with `Retry-After`; carrier 5xx response; malformed JSON;
unexpected response schema; empty successful response; legitimate shipment not
found; repeated unexpected not-found pattern; ambiguous multiple shipments.

**URL parsing:** URL-derived tracking ID takes precedence over stored
confirmation number; malformed tracking URL; encoded tracking URL; repeated
`tracking-id` parameters (identical and conflicting); DHL tracking URL with
extra query parameters; unsupported external host rejected; multiple tracking
IDs; duplicate tracking entries; whitespace / malicious input never throws.

**Multi-shipment (§5.6):** one order with one shipment; one order with two
delivered shipments; one delivered + one in-transit; one delivered + one
returned; partial fulfillment covering only some disputed products; duplicate
tracking entries; multiple fulfillments using the same tracking number;
replacement shipment after an earlier return; shipment covering unrelated line
items; disputed line items split across shipments.

**Reconciliation (§5.7):** conflicting Shopify and DHL states; older delivery
followed by newer return (return wins); return followed by redelivery
(redelivery wins); absence of a carrier result never overrides an existing
positive event.

**Notifications (§6):** support notification emitted; duplicate support
notification suppressed by persistent dedup; notification-email failure
logged; notification-email failure does not break pack generation; no
sensitive values in the email; no sensitive values in structured logs.

**Unsupported/unknown carrier (§7):** recognized unsupported carrier via
`trackingInfo.company`; recognized unsupported carrier via tracking-URL
hostname; supported carrier does not trigger the alert; empty carrier does not
trigger an unsupported-carrier alert; unknown carrier recorded separately;
first unsupported-carrier occurrence sends an email; duplicate
merchant-and-carrier occurrence suppressed; same carrier from a different
merchant sends a separate notification; email delivery failure logged and
non-fatal; no full tracking number or complete tracking URL in the email;
detection does not interfere with Shopify-native or tracking-app evidence;
detection never generates negative delivery evidence.

**Safety:** no negative delivery evidence generated from absence or API
failure; pack generation succeeds despite a total carrier outage.

## 11. Acceptance criteria (PR 1D)

Primary proof — dispute `#891BECCC`, Shopify order `#12809`, merchant
cay-collective:

- effective DHL tracking identifier parsed from the tracking URL
  (`matchedFrom: "url"`); Shopify's stored customer-confirmation number is NOT
  treated as the real shipment identifier;
- terminal event dated `2026-06-04`, event text indicating pickup by receiver,
  service point `DIREKTEN LÖDÖSE Servicepoint`;
- normalized as `DeliveredToPickup`;
- cited honestly in the evidence pack (servicepoint-pickup wording, ×6 locales);
- NOT counted as ordinary `Delivered` in the KPI;
- source shown as DHL carrier API in provenance — never presented as
  Shopify-supplied;
- evidence-pack generation succeeds even if the DHL lookup fails;
- a simulated actionable DHL error sends exactly one deduplicated email to
  `support@disputedesk.com`, containing sufficient operational context and no
  sensitive tracking or customer data;
- a fixture using a recognizable but unregistered carrier completes the
  evidence-pack build, preserves any existing evidence, records the
  unsupported carrier (§7.4), and sends one deduplicated notification to
  `support@dispute-us.com` without exposing sensitive tracking or customer
  data.

Verify with `scripts/inspect-dhl-order-12809.ts` before and after the
integration. **No production mutation or rebuild without explicit approval.**

## 12. Preserved product constraints (unchanged)

- Dispute-triggered lookup only — no continuous shipment monitoring, no cron,
  no general tracking product.
- Merchants never paste DisputeDesk's DHL credentials; `DHL_API_KEY` and
  `DHL_API_SECRET` remain the configured credentials.
- Absence is never evidence of non-delivery.
- Carrier failures never break evidence-pack generation; errors are logged and
  actionable failures notify `support@disputedesk.com`; support-email failures
  never break evidence-pack generation.
- `DeliveredToPickup` remains separate from `Delivered` in KPI calculations.
- Returned status may affect scoring but is never automatically exposed in the
  bank-facing narrative (bank non-disclosure / strengthening-facts rules).
- Source provenance is visible in admin.
- No speculative P2/P3 (conditional) integrations without merchant demand.
- No arbitrary requests to merchant-provided carrier tracking-page URLs —
  parse-only, then official carrier APIs.
- Six-locale structural i18n rules remain mandatory; tokens are passed
  structurally from `lib/` and never resolved as embedded English text.
- Tracking-app metafields and Shopify-native events remain supported; carrier
  API data supplements and reconciles the existing evidence pipeline — it does
  not replace it.

## 13. Open questions

1. **Notification addresses** — this revision specifies
   `support@disputedesk.com` for operational carrier-API failures (§6) and
   `support@dispute-us.com` for unsupported-carrier notifications (§7), per the
   2026-07-15 revision instructions. Both differ from the address used
   elsewhere in the product (`support@disputedesk.app`, cf. `LEADS_FORM_TO`).
   Confirm both mailboxes exist and are monitored before PR 1B ships the
   senders; the addresses are config values, so correcting them later is a
   one-line change.
2. **PostNord business account** — do we (or cay) have one? Gates a future
   PostNord adapter; not needed for P0.
3. **Push APIs** (DHL has one) — skip for v1; dispute-triggered pull is enough
   and avoids webhook infrastructure. Revisit only if lookup volume ever
   threatens rate limits.
4. **Merchant-credential carriers** — if a merchant ever needs one, design the
   portal form flow then; out of scope for P0.
