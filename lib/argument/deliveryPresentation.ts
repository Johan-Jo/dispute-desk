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
import type { I18nKey } from "@/lib/i18n/token";

/** One carrier tracking reference, ready to render as a link. */
export interface TrackingLink {
  carrier: string | null;
  number: string | null;
  url: string | null;
}

export interface DeliveryPresentation {
  /** Specific, proof-state-aware label key. */
  labelKey: I18nKey;
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
    const num = typeof number === "string" && number.trim() ? number.trim() : null;
    const car =
      typeof carrier === "string" && carrier.trim() ? carrier.trim() : null;
    const link =
      typeof url === "string" && /^https?:\/\//i.test(url.trim())
        ? url.trim()
        : null;
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

/**
 * Build the delivery-row presentation from a fulfillment payload. Returns
 * a proof-state-specific label key and any tracking references. The caller
 * (Overview evidence list) resolves `labelKey` and renders `trackingLinks`
 * as clickable links.
 */
export function buildDeliveryPresentation(
  payload: Record<string, unknown> | null | undefined,
): DeliveryPresentation {
  const proofType = resolveProofType(payload);
  return {
    labelKey: PROOF_LABEL_KEY[proofType],
    trackingLinks: extractTrackingLinks(payload),
  };
}
