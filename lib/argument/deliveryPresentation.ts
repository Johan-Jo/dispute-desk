/**
 * Delivery-row presentation helper.
 *
 * The two delivery evidence field keys (`delivery_proof`,
 * `shipping_tracking`) share `signalId: "delivery"` and the same generic
 * label key (`disputes.signalLabel.delivery` → "Delivery confirmation").
 * That label is correct ONLY when the carrier or recipient actually
 * confirmed delivery. On a shipped-but-not-yet-delivered order it
 * overstates the evidence — the merchant sees "Delivery confirmation"
 * next to a "Supporting" pill and a "no decisive delivery evidence"
 * verdict, which reads as self-contradictory.
 *
 * This helper maps the collector-written `proofType` discriminator (see
 * `categorizeEvidenceField` in canonicalEvidence.ts) to a *specific*
 * label key, and extracts the carrier + tracking number(s) so the UI can
 * render a clickable tracking link for the unconfirmed / in-transit case.
 *
 * Label ↔ proofType (mirrors the categorizer's strength mapping):
 *   signature_confirmed  → "Delivery confirmation (signature)"  [strong]
 *   delivered_confirmed  → "Delivery confirmation (carrier)"    [moderate/strong]
 *   delivered_unverified → "Shipping & tracking"                [supporting]
 *   label_created        → "Shipping label created"             [invalid]
 *
 * Lib code emits i18n keys, never English. The `labelKey` returned here is
 * resolved by the UI's root translator.
 */

import type { DeliveryProofType } from "@/lib/argument/canonicalEvidence";
import type { I18nKey, I18nToken } from "@/lib/i18n/token";

/** One carrier tracking reference, ready to render as a link. */
export interface TrackingLink {
  carrier: string | null;
  number: string | null;
  url: string | null;
}

export interface DeliveryPresentation {
  /** Proof-tier label key (signature/carrier/shipped/label). Kept for
   *  tier ranking + the in-transit strength-reason check — display
   *  surfaces should prefer `titleToken`. */
  labelKey: I18nKey;
  /** Fact-stating display title: WHAT happened and WHEN — "Delivered
   *  Jun 4", "Collected at pickup point Jun 4", "At pickup point —
   *  awaiting collection" — instead of the categorical "Delivery
   *  confirmation (carrier)". */
  titleToken: I18nToken;
  /** Carrier-API provenance: the adapter slug (e.g. "dhl") when a
   *  carrier_api_* source supplied the delivery state — the source
   *  caption must then say so instead of "From Shopify order data". */
  carrierApiSlug: string | null;
  /** Carrier + tracking references pulled from the fulfillment payload.
   *  Empty when the payload carries none. */
  trackingLinks: TrackingLink[];
}

const PROOF_LABEL_KEY: Record<DeliveryProofType, I18nKey> = {
  signature_confirmed: "disputes.deliveryProof.signature",
  delivered_confirmed: "disputes.deliveryProof.carrierConfirmed",
  delivered_unverified: "disputes.deliveryProof.shippedUnconfirmed",
  label_created: "disputes.deliveryProof.labelOnly",
};

/** Narrow the raw payload's `proofType` to the canonical enum, defaulting
 *  the same way the categorizer does: an explicit value wins; a manual
 *  upload (no proofType but a fileName) reads as `delivered_unverified`;
 *  otherwise `label_created`. Keeps the label consistent with the score. */
function resolveProofType(
  payload: Record<string, unknown> | null | undefined,
): DeliveryProofType {
  const p = payload ?? {};
  const explicit =
    typeof p.proofType === "string" ? (p.proofType as DeliveryProofType) : null;
  if (
    explicit === "signature_confirmed" ||
    explicit === "delivered_confirmed" ||
    explicit === "delivered_unverified" ||
    explicit === "label_created"
  ) {
    return explicit;
  }
  const looksLikeManualUpload =
    typeof p.fileName === "string" && (p.fileName as string).length > 0;
  return looksLikeManualUpload ? "delivered_unverified" : "label_created";
}

/** Tracking-URL query/hash params that carry the shipment number, by
 *  convention across tracking pages (17track `nums=`, DHL `tracking-id=`,
 *  generic `tracking_numbers=` …). Shopify fulfillments sometimes ship a
 *  tracking URL with an EMPTY `number` field (live example: PostNord SE
 *  via 17track, dispute c89276b6 2026-07-16) — the number is recoverable
 *  from the URL, so recover it instead of rendering "carrier · —". */
const TRACKING_NUMBER_PARAMS = new Set([
  "nums",
  "num",
  "tracking_numbers",
  "trackingnumber",
  "trackingnumbers",
  "tracknumber",
  "tracknumbers",
  "tracking-id",
  "trackingid",
  "shipmentid",
]);

/** Recover the tracking number from a known tracking-URL param. Handles
 *  params in both the query string and the hash fragment (17track puts
 *  `nums=` after `#`). Comma-separated lists take the first entry.
 *  Shared with `evidenceLineItem.buildDeliveryFacts` so every surface
 *  recovers the same number. */
export function numberFromTrackingUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const paramSources = [
    parsed.searchParams,
    new URLSearchParams(parsed.hash.replace(/^#/, "")),
  ];
  for (const params of paramSources) {
    for (const [key, value] of params) {
      if (!TRACKING_NUMBER_PARAMS.has(key.toLowerCase())) continue;
      const first = value.split(",")[0]?.trim() ?? "";
      // Require a plausible shipment ref — guards against picking up
      // flags/locale values on unknown pages sharing a param name.
      if (/^[A-Za-z0-9][A-Za-z0-9 -]{4,}$/.test(first)) return first;
    }
  }
  return null;
}

/** Pull carrier + tracking number + URL out of the fulfillment payload.
 *  The fulfillment collector writes `fulfillments[].tracking[]` with
 *  `{ carrier, number, url }`. Older/manual payloads may carry a flat
 *  `trackingNumber` / `trackingUrl` — accept those too. Deduped by number. */
function extractTrackingLinks(
  payload: Record<string, unknown> | null | undefined,
): TrackingLink[] {
  const p = payload ?? {};
  const links: TrackingLink[] = [];
  const seen = new Set<string>();

  const push = (
    carrier: unknown,
    number: unknown,
    url: unknown,
  ): void => {
    const car =
      typeof carrier === "string" && carrier.trim() ? carrier.trim() : null;
    const link =
      typeof url === "string" && /^https?:\/\//i.test(url.trim())
        ? url.trim()
        : null;
    const num =
      (typeof number === "string" && number.trim() ? number.trim() : null) ??
      (link ? numberFromTrackingUrl(link) : null);
    // Skip an entry that carries nothing renderable.
    if (!num && !link && !car) return;
    const key = num ?? link ?? car!;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ carrier: car, number: num, url: link });
  };

  const fulfillments = Array.isArray(p.fulfillments) ? p.fulfillments : [];
  for (const f of fulfillments) {
    const tracking =
      f && typeof f === "object" && Array.isArray((f as Record<string, unknown>).tracking)
        ? ((f as Record<string, unknown>).tracking as unknown[])
        : [];
    for (const t of tracking) {
      if (t && typeof t === "object") {
        const tr = t as Record<string, unknown>;
        push(tr.carrier, tr.number, tr.url);
      }
    }
  }

  // Flat fallback (manual uploads / legacy payloads).
  if (links.length === 0) {
    push(p.carrier ?? p.trackingCarrier, p.trackingNumber, p.trackingUrl);
  }

  return links;
}

const SHORT_MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

/** ISO → "Mon D" (UTC). Null on garbage so the segment drops out. Shared
 *  date shape with evidenceLineItem's facts line. */
export function shortEvidenceDate(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Reconciled receipt state for the whole payload, read from the
 *  per-fulfillment `carrierTracking` the collector wrote (the reconciled
 *  winner per shipment — see lib/packs/sources/fulfillmentSource.ts).
 *  Display precedence: a doorstep delivery outranks a collection, which
 *  outranks an awaiting-collection arrival. `date` is the customer-
 *  receipt timestamp when one exists. */
export interface DeliveryReceipt {
  state: "delivered" | "collected" | "awaiting_collection" | null;
  date: string | null;
  carrierApiSlug: string | null;
}

const RECEIPT_RANK: Record<string, number> = {
  Delivered: 3,
  CollectedAtPickup: 2,
  DeliveredToPickup: 1,
};

export function resolveDeliveryReceipt(
  payload: Record<string, unknown> | null | undefined,
): DeliveryReceipt {
  const p = payload ?? {};
  let bestStatus: string | null = null;
  let bestAt: string | null = null;
  let carrierApiSlug: string | null = null;

  const fulfillments = Array.isArray(p.fulfillments) ? p.fulfillments : [];
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const ct = (f as Record<string, unknown>).carrierTracking;
    if (!ct || typeof ct !== "object") continue;
    const tr = ct as Record<string, unknown>;
    const status = typeof tr.deliveryStatus === "string" ? tr.deliveryStatus : null;
    const source = typeof tr.trackingSource === "string" ? tr.trackingSource : "";
    if (source.startsWith("carrier_api")) {
      carrierApiSlug = source.replace(/^carrier_api_?/, "") || "carrier";
    }
    if (!status || !(status in RECEIPT_RANK)) continue;
    if (!bestStatus || RECEIPT_RANK[status] > RECEIPT_RANK[bestStatus]) {
      bestStatus = status;
      bestAt =
        typeof tr.deliveredAtTracking === "string" ? tr.deliveredAtTracking : null;
    }
  }

  const topLevelDeliveredAt =
    typeof p.deliveredAt === "string" ? p.deliveredAt : null;
  const state =
    bestStatus === "Delivered"
      ? "delivered"
      : bestStatus === "CollectedAtPickup"
        ? "collected"
        : bestStatus === "DeliveredToPickup"
          ? "awaiting_collection"
          : topLevelDeliveredAt
            ? "delivered"
            : null;
  return {
    state,
    date: bestAt ?? topLevelDeliveredAt,
    carrierApiSlug,
  };
}

/** Fact-stating title for a delivery row: what happened + when. Falls
 *  back to the proof-tier wording when the payload carries no receipt
 *  state (older packs). Shared by the Overview evidence card and the
 *  collapsed delivery line item so every surface tells the same story. */
export function resolveDeliveryTitle(
  proofType: DeliveryProofType,
  payload: Record<string, unknown> | null | undefined,
): I18nToken {
  const NS = "disputes.deliveryProof";
  const receipt = resolveDeliveryReceipt(payload);
  const date = shortEvidenceDate(receipt.date);

  if (proofType === "signature_confirmed") {
    return date
      ? { key: `${NS}.titleSignedOn`, params: { date } }
      : { key: `${NS}.titleSigned` };
  }
  if (proofType === "delivered_confirmed") {
    if (receipt.state === "collected") {
      return date
        ? { key: `${NS}.titleCollectedOn`, params: { date } }
        : { key: `${NS}.titleCollected` };
    }
    return date
      ? { key: `${NS}.titleDeliveredOn`, params: { date } }
      : { key: `${NS}.titleDelivered` };
  }
  if (proofType === "delivered_unverified") {
    if (receipt.state === "awaiting_collection") {
      return { key: `${NS}.titleAwaitingCollection` };
    }
    return { key: PROOF_LABEL_KEY.delivered_unverified };
  }
  return { key: PROOF_LABEL_KEY.label_created };
}

/**
 * Build the delivery-row presentation from a fulfillment payload. Returns
 * the proof-tier label key, a fact-stating display title, carrier-API
 * provenance, and any tracking references. The caller (Overview evidence
 * list) resolves the tokens and renders `trackingLinks` as clickable links.
 */
export function buildDeliveryPresentation(
  payload: Record<string, unknown> | null | undefined,
): DeliveryPresentation {
  const proofType = resolveProofType(payload);
  return {
    labelKey: PROOF_LABEL_KEY[proofType],
    titleToken: resolveDeliveryTitle(proofType, payload),
    carrierApiSlug: resolveDeliveryReceipt(payload).carrierApiSlug,
    trackingLinks: extractTrackingLinks(payload),
  };
}
