/**
 * Chronology of Events — single source of truth for the bullets that
 * render under the "Chronology of Events" section in BOTH the PDF
 * (`lib/defence/pdf/DefencePackageDocument.tsx`) and the embedded
 * HTML view (`DefencePackageHtmlView.tsx`).
 *
 * Before 2026-05-19 each renderer had its own copy of this function.
 * They agreed by coincidence as long as their inputs matched, but
 * they diverged the moment the workspace API stopped surfacing the
 * rich `timelineEvents` array. The merchant saw 2 synthetic events
 * in the embedded view while the bank's PDF showed the full 8-event
 * Shopify timeline.
 *
 * This module is the canonical implementation. Both renderers MUST
 * import `buildChronologyEvents()` from here — duplicating the logic
 * in a renderer file is a bug.
 *
 * Inputs are intentionally minimal: a `transactionContext` object
 * carries the rich `timelineEvents` array (when present) and the
 * synthetic-fallback fields (transactionDate, orderName, cardNetwork,
 * cardLast4). The `facts` array supplies customer_communication
 * timestamps for the fallback path's third event.
 */

import type { EvidenceFact } from "./types";

/** One bullet on the rendered Chronology of Events list. */
export interface ChronologyEvent {
  at: string;
  text: string;
}

/**
 * Minimal transaction context the chronology builder needs. The
 * concrete callers (PDF `DefencePackageMeta`, HTML view
 * `DisputeContextLike`) pass a superset of this shape.
 */
export interface ChronologyContext {
  /** Full event timeline from the pack's access_log section.
   *  Threaded through by:
   *    - PDF: `meta.timelineEvents` (set by `buildDefencePackageJob`)
   *    - HTML view: `dispute.timelineEvents` (set by the workspace
   *      API from `deriveOrderContext`)
   *  Both routes ultimately read `orderContext.timelineEvents`.
   *
   *  When present and non-empty, the rich path takes precedence.
   *  The synthetic fallback below is dead code in that case. */
  timelineEvents?: Array<{ at: string; text: string }> | null;

  /** Synthetic-fallback fields. Only used when `timelineEvents` is
   *  absent (old packs predating orderSource events capture). */
  transactionDate?: string | null;
  orderName?: string | null;
  cardNetwork?: string | null;
  cardLast4?: string | null;
}

/**
 * Build the chronology bullets for one defence package.
 *
 * Priority:
 *   1. `context.timelineEvents` — rich Shopify Order.events. Sorted
 *      ascending so the merchant reads them in chronological order.
 *      Capped at 20 by `orderSource.ts`.
 *   2. Synthetic fallback — derive 2 events from transactionDate
 *      (placed + authorisation). Add a 3rd event when an approved
 *      `customer_communication` fact carries a `lastMessageAt`.
 *
 * The fallback fires ONLY when the rich array is missing — which
 * means: packs built before `orderSource.ts` started capturing
 * `timelineEvents` (~2025-08), or freshly-built packs where the
 * Shopify Order.events API returned nothing (e.g. POS orders).
 */
/**
 * Shopify's Swedish money formatting glues the "kr" symbol onto the
 * amount *and* appends the ISO code — e.g. "A kr628.00 SEK payment was
 * processed on Klarna." The doubled currency ("kr…SEK") reads wrong in
 * bank-facing prose, so we drop the redundant "kr" prefix, leaving
 * "628.00 SEK". Only strips "kr" when it directly precedes a number that
 * is *also* suffixed by the ISO code — a plain "kr628.00" with no ISO
 * code is left untouched (removing the only currency marker would lose
 * information). Applied to the rich Shopify timeline text verbatim.
 */
export function normalizeChronologyText(text: string): string {
  return (
    text
      // "kr628.00 SEK" → "628.00 SEK"; "kr 605,22 SEK" → "605,22 SEK".
      .replace(/\bkr\s?(\d[\d.,\s]*\s+[A-Z]{3})\b/g, "$1")
      // Shopify's chargeback line adds its own fee to the disputed amount
      // ("totaling $120.75 CAD + $15.00 USD"). The fee is not the
      // customer's money and does not match the disputed amount (#352543).
      .replace(/(opened a chargeback totaling .+?)\s+\+\s+.+?\.$/i, "$1.")
      // Packs built before 2026-09-24 carry the old wording, which claimed
      // the recipient; the record says delivered, not who took it.
      .replace(/^Carrier confirmed delivery of the shipment to the recipient\.$/i, "Carrier recorded the shipment as delivered.")
  );
}

/**
 * Bank-facing chronology hygiene — an ALLOW-LIST, by deliberate design.
 *
 * The rich path forwards Shopify's `Order.events` verbatim (orderSource.ts).
 * That timeline is open-ended free text: Shopify and *every app a merchant
 * installs* (Rebuy, Flow, an OMS, a loyalty app, …) invent their own event
 * verbs, and new ones appear whenever a merchant installs another app. A
 * deny-list is therefore whack-a-mole — we would forever chase new noise
 * verbs into bank documents, and one class ("Shopify Protect is no longer
 * active for this order") is actively self-incriminating (CLAUDE.md — bank
 * non-disclosure; Coverage Gate).
 *
 * So we invert it: the bullets that reach a bank are HARD-DEFINED. Only
 * events that positively match a recognized **evidentiary category** below
 * are kept. Everything else — payout accounting, "order archived",
 * confirmation-number chatter, duplicate/pending payment states, and the
 * next app's brand-new verb — is dropped by default. A surprise line is
 * silently excluded, never silently leaked. The dropped tail is returned
 * by `partitionChronologyEvents` so callers can log it for review.
 *
 * Matching is case-insensitive. Each pattern is scoped to a clear,
 * defensible evidentiary meaning — never a broad substring that admits noise.
 */
export type ChronologyCategory =
  | "order_placed"
  | "payment"
  | "fulfillment_shipment"
  | "shipping_confirmation"
  | "delivery_notification"
  | "carrier_delivery"
  | "chargeback";

/**
 * The allow-list: category → the patterns that positively identify it.
 * A line is kept iff it matches at least one pattern here.
 */
const CHRONO_ALLOW: Array<{ category: ChronologyCategory; patterns: RegExp[] }> = [
  {
    // Order creation / placement on the storefront.
    category: "order_placed",
    patterns: [/\border was placed\b/i, /\bplaced (?:this )?order\b/i, /\border placed\b/i],
  },
  {
    // Money movement that authenticates the transaction: a payment being
    // processed/captured, or an authorization/authentication being placed.
    // Explicitly NOT payout accounting ("added to / deducted from your …
    // payout") and NOT the noisy "capture is pending" interim state.
    category: "payment",
    patterns: [
      /payment was (?:processed|captured|authorized|authorised)/i,
      /was (?:authorized|authorised) using a/i,
      /was captured using a/i,
      /payment was authenticated|payment authentication/i,
    ],
  },
  {
    // The ACTUAL shipment leaving — includes the app-generated "marked N
    // items as fulfilled" wording, not the OMS "requested/accepted
    // fulfillment" routing chatter.
    category: "fulfillment_shipment",
    patterns: [/\bfulfilled\b.*\bitems?\b/i, /marked \d+ items? as fulfilled/i, /shipment was tendered to the carrier/i],
  },
  {
    // Merchant→customer shipping confirmation (proof the customer was told
    // the goods were on the way to the address on file).
    category: "shipping_confirmation",
    patterns: [/shipping confirmation email/i, /shipment was tracked as/i],
  },
  {
    // Merchant→customer delivery notifications: "out for delivery" and
    // "delivered" emails to the address on file. Evidentiary for
    // not-received / fraud — the customer was told the goods arrived.
    category: "delivery_notification",
    patterns: [
      /shipment (?:out for delivery|delivered) email was sent/i,
      /(?:out for delivery|delivered) email was sent/i,
    ],
  },
  {
    // Carrier delivery milestones — FIXED wording emitted by
    // fulfillmentChronologyEvents (orderSource.ts). Keep in sync with it.
    category: "carrier_delivery",
    patterns: [
      /carrier confirmed delivery/i,
      /carrier recorded the shipment as delivered/i,
      /carrier delivered the shipment to a pickup point/i,
      /collected the shipment at the pickup point/i,
      /carrier reported the shipment returned to sender/i,
    ],
  },
  {
    // The chargeback / dispute itself — ONLY the event that OPENS the case.
    // A bare /chargeback/ match wrongly kept payout-accounting lines
    // ("$X deducted from your payout because of a chargeback") — merchant
    // bookkeeping with no evidentiary value, and emphasizing the loss is
    // self-harm in a bank document. Scope to the dispute-open verb only.
    category: "chargeback",
    patterns: [
      /opened a chargeback/i,
      /chargeback was (?:opened|filed|initiated)/i,
      /customer (?:opened|filed|initiated) a (?:chargeback|dispute)/i,
    ],
  },
];

/**
 * Classify a chronology line against the allow-list. Returns the matched
 * evidentiary category, or `null` when the line is NOT recognized bank
 * evidence (→ dropped). Pure and exported so tests pin exactly what is
 * and isn't admitted.
 */
export function classifyChronologyEvent(text: string): ChronologyCategory | null {
  for (const { category, patterns } of CHRONO_ALLOW) {
    if (patterns.some((re) => re.test(text))) return category;
  }
  return null;
}

/**
 * Partition a normalized chronology array into the bank-facing `kept` events
 * (allow-listed) and the `droppedUnknown` texts (everything not recognized),
 * so the excluded tail is visible for review rather than disappearing
 * silently. Pure — no I/O here.
 */
export function partitionChronologyEvents(
  events: ChronologyEvent[],
): { kept: ChronologyEvent[]; droppedUnknown: string[] } {
  const kept: ChronologyEvent[] = [];
  const droppedUnknown: string[] = [];
  for (const e of events) {
    if (classifyChronologyEvent(e.text)) kept.push(e);
    else droppedUnknown.push(e.text);
  }
  return { kept, droppedUnknown };
}

const CHRONO_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a chronology event's `at` timestamp for display in BOTH the PDF
 * and the embedded HTML view. Renders a raw ISO string
 * (`2026-06-06T07:08:42Z`) as a clean, unambiguous, bank-facing UTC
 * date-time: `Jun 6, 2026, 07:08 UTC`.
 *
 * The bullets showed the raw ISO string before (both renderers printed
 * `e.at` verbatim) — which read as corrupt/machine output to the merchant
 * and the bank. UTC is kept explicit (not localized to the viewer) so the
 * PDF and HTML always agree and the bank sees an unambiguous instant.
 *
 * Defensive: an unparseable value is returned unchanged rather than
 * rendering "Invalid Date".
 */
export function formatChronologyTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return iso; // leave odd values untouched
  const yyyy = d.getUTCFullYear();
  const mon = CHRONO_MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${yyyy}, ${hh}:${mm} UTC`;
}

export function buildChronologyEvents(
  context: ChronologyContext,
  facts: EvidenceFact[] = [],
): ChronologyEvent[] {
  // Path 1: rich timeline. Same priority order both surfaces share.
  const rich = context.timelineEvents;
  if (Array.isArray(rich) && rich.length > 0) {
    const normalized = [...rich]
      .map((e) => ({ ...e, text: normalizeChronologyText(e.text) }))
      .sort((a, b) => a.at.localeCompare(b.at));
    // Bank-facing hygiene: keep ONLY allow-listed evidentiary events.
    // Shopify's raw Order.events is an open-ended free-text stream that
    // includes payout accounting, "order archived", confirmation-number
    // chatter, duplicate payment states, and app-specific verbs — none of
    // which prove the transaction and some of which are self-incriminating
    // (payout debits emphasize the loss). `partitionChronologyEvents`
    // drops everything that isn't a recognized category. This is the single
    // wiring point both renderers share (PDF + HTML view), so the filter
    // can never be silently skipped by one surface.
    const { kept, droppedUnknown } = partitionChronologyEvents(normalized);
    if (droppedUnknown.length > 0) {
      // Log the excluded tail (numbers collapsed so identical shapes
      // dedupe) — review it to promote genuinely useful new event types
      // into the allow-list instead of them vanishing blindly.
      //
      // MUST be stderr (console.error), never stdout: this module also runs
      // inside the PDF subprocess worker, whose stdout IS the PDF byte
      // stream (the parent asserts it starts with "%PDF-"). A console.info
      // here prefixed the log onto the PDF bytes and failed every render
      // with dropped lines ("pdf_render_failed: … first 200 bytes:
      // [chronology] dropped …"). stderr is collected separately.
      const shapes = [...new Set(droppedUnknown.map((t) => t.replace(/\d[\d.,]*/g, "#")))];
      console.error(
        `[chronology] dropped ${droppedUnknown.length} non-evidentiary timeline line(s); shapes: ${shapes.slice(0, 10).join(" | ")}`,
      );
    }
    return withShipmentEvents(kept, facts);
  }

  // Path 2: synthetic fallback. Only fires when the pack lacks captured events.
  const events: ChronologyEvent[] = [];
  if (context.transactionDate) {
    events.push({
      at: context.transactionDate,
      text: `Order placed on the merchant's storefront${
        context.orderName ? ` (${context.orderName})` : ""
      }.`,
    });
    events.push({
      at: context.transactionDate,
      text: `Authorisation captured against the cardholder's ${
        context.cardNetwork ?? "card"
      }${context.cardLast4 ? ` ending in ${context.cardLast4}` : ""}.`,
    });
  }
  for (const f of facts) {
    if (f.category === "customer_communication") {
      const v = f.value as Record<string, unknown> | null | undefined;
      const at = typeof v?.lastMessageAt === "string" ? v.lastMessageAt : null;
      if (at) {
        events.push({
          at,
          text: `Customer correspondence with the merchant${
            v?.customerConfirmsOrder === true
              ? " — order receipt confirmed by the customer"
              : ""
          }.`,
        });
      }
    }
  }
  return withShipmentEvents(events.sort((a, b) => a.at.localeCompare(b.at)), facts);
}

/**
 * Multi-parcel orders: ONE timeline (#360980, 2026-09-23 — the letter printed
 * a chronology paragraph and, below it, a second bullet list).
 *
 *   - Each dated carrier event from the delivery fact's `shipments` joins the
 *     bullets, naming its product: "GOFO's tracking record shows The Back to
 *     School Bundle in transit (tracking …)" at the event's own time.
 *   - Shopify's "marked 1 item as fulfilled" lines name their product, matched
 *     by the fulfilment's own timestamp (within two minutes).
 *   - A generic carrier-delivery line at the same moment as a parcel's named
 *     delivery is dropped: the named one says it with the product.
 *
 * No-op when no delivery fact carries `shipments`.
 */
function withShipmentEvents(events: ChronologyEvent[], facts: EvidenceFact[]): ChronologyEvent[] {
  const fact = facts.find((f) => {
    if (f.category !== "delivery_proof" && f.category !== "shipping_tracking") return false;
    const s = (f.value as Record<string, unknown> | null)?.shipments;
    return Array.isArray(s) && s.length > 1;
  });
  if (!fact) return events;
  const shipments = (fact.value as Record<string, unknown>).shipments as Array<Record<string, unknown>>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const itemsOf = (s: Record<string, unknown>): string | null => {
    const names = (Array.isArray(s.items) ? (s.items as Array<Record<string, unknown>>) : [])
      .map((it) => str(it.title))
      .filter((t): t is string => t !== null);
    return names.length ? names.join(", ") : null;
  };

  const annotated = events.map((e) => {
    if (!/marked \d+ items? as fulfilled/i.test(e.text)) return e;
    const at = Date.parse(e.at);
    const match = shipments.find((s) => {
      const t = Date.parse(str(s.fulfillmentEventAt) ?? "");
      return !Number.isNaN(t) && !Number.isNaN(at) && Math.abs(t - at) <= 120_000;
    });
    const items = match ? itemsOf(match) : null;
    return items ? { ...e, text: e.text.replace(/\.?\s*$/, ` (${items}).`) } : e;
  });

  const carrierEvents: ChronologyEvent[] = [];
  for (const s of shipments) {
    const items = itemsOf(s) ?? "the shipment";
    const carrier = str(s.carrier) ?? "The carrier";
    const ref = s.referenceIsTrackingNumber === true ? str(s.reference) : null;
    const tracking = ref ? ` (tracking ${ref})` : "";
    if (s.proofType === "in_transit" && str(s.inTransitSince)) {
      carrierEvents.push({
        at: str(s.inTransitSince) as string,
        text: `${carrier}'s tracking record shows ${items} in transit${tracking}.`,
      });
    } else if (
      (s.proofType === "delivered_confirmed" || s.proofType === "signature_confirmed") &&
      str(s.deliveredAt)
    ) {
      carrierEvents.push({
        at: str(s.deliveredAt) as string,
        text: `${carrier} records delivery of ${items}${tracking}.`,
      });
    }
  }
  // The order's own generic delivery line ("Carrier confirmed delivery of the
  // shipment to the recipient.") at the same moment as a parcel's named
  // delivery says the same thing twice (#360980, 2026-09-24) — keep the one
  // that names the parcel.
  const namedDeliveries = carrierEvents
    .filter((c) => / records delivery of /.test(c.text))
    .map((c) => Date.parse(c.at));
  const deduped = annotated.filter((e) => {
    if (!/carrier confirmed delivery|carrier recorded the shipment as delivered/i.test(e.text)) return true;
    const at = Date.parse(e.at);
    return !namedDeliveries.some((t) => !Number.isNaN(at) && Math.abs(t - at) <= 120_000);
  });
  return [...deduped, ...carrierEvents].sort((a, b) => a.at.localeCompare(b.at));
}
