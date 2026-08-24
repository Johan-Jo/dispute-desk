/**
 * Carrier Delivery Verification — adapter type contracts.
 * Plan: docs/plans/carrier-delivery-verification.plan.md §5.
 *
 * Design invariants (do not weaken):
 *  - Lookup outcomes are an EXHAUSTIVE discriminated union — never a
 *    nullable array. `success` with `deliveryStatus: null` means "lookup
 *    worked, shipment has no terminal event yet" (in transit), which is
 *    a different fact from `not_found`.
 *  - `match()` returns a STRUCTURED result recording where the effective
 *    identifier came from — for DHL Freight the stored tracking number is
 *    DHL's customer confirmation number and the real id lives only in the
 *    tracking URL (`tracking-id=`).
 *  - Absence of a carrier result is never evidence of non-delivery.
 */

import type { ReturnReason } from "@/lib/shopify/deliveryEventClassifier";

/** Normalized carrier slugs known to the identification registry.
 *  Grows as adapters are added; `fake_carrier` exists only for the
 *  carrier-neutrality test adapter (never registered in production). */
export type CarrierSlug =
  | "dhl"
  | "postnord"
  | "fedex"
  | "ups"
  | "usps"
  | "gls"
  | "bring"
  | "dpd"
  | "postnl"
  | "colissimo"
  | "correos"
  | "ctt"
  | "fake_carrier";

/** One tracking entry as Shopify stores it on a fulfillment. */
export interface TrackingEntryInfo {
  company: string | null;
  number: string | null;
  url: string | null;
}

/** Structured match — plan §5.2. */
export interface CarrierMatch {
  carrier: CarrierSlug;
  /** The EFFECTIVE identifier to send to the carrier API. */
  trackingNumber: string;
  /** e.g. "freight" when derivable — informational only. */
  divisionHint?: string;
  matchedFrom: "url" | "number" | "company_and_number";
  confidence: "high" | "medium";
}

/** One carrier-reported shipment event, normalized. */
export interface CarrierEvent {
  happenedAt: string;
  /** Carrier's structured status code when provided (e.g. DHL
   *  `statusCode`), null otherwise. */
  statusCode: string | null;
  message: string | null;
}

/** Delivery vocabulary (PR #236 + collected-at-pickup extension):
 *  - `Delivered`          — doorstep delivery to the recipient's address.
 *  - `CollectedAtPickup`  — the customer COLLECTED the parcel at a service
 *    point (ID-verified in SE/Nordics) — confirmed customer receipt,
 *    strong INR evidence, but never an address-delivery claim.
 *  - `DeliveredToPickup`  — arrived at a pickup point, collection pending.
 *  - `Returned`           — back to sender. */
export type CarrierDeliveryStatus =
  | "Delivered"
  | "CollectedAtPickup"
  | "DeliveredToPickup"
  | "Returned";

export interface NormalizedCarrierShipment {
  trackingNumber: string;
  /** Full event timeline, newest first. */
  events: CarrierEvent[];
  /** null = successful lookup, no terminal event yet (in transit). */
  deliveryStatus: CarrierDeliveryStatus | null;
  /** ISO timestamp of the authoritative terminal event, when any. */
  terminalAt: string | null;
  /** Recipient/POD name when the carrier reports one. */
  podName: string | null;
  /** WHY the shipment went back, when `deliveryStatus === "Returned"` and
   *  the carrier said. `null` otherwise — and `null` is the common answer.
   *  A hint for the merchant UI, never a bank-facing claim on its own.
   *  See `classifyReturnReason` in lib/shopify/deliveryEventClassifier. */
  returnReason: ReturnReason | null;
}

/** Exhaustive lookup outcome — plan §5.4. Every branch is explicit,
 *  observable, testable, and maps to a support-email category. */
export type CarrierLookupResult =
  | { status: "success"; shipment: NormalizedCarrierShipment }
  | { status: "not_found" }
  | { status: "ambiguous"; candidateCount: number }
  | { status: "rate_limited"; retryAfterSeconds?: number }
  | { status: "authentication_error" }
  | { status: "timeout" }
  | { status: "network_error" }
  | { status: "unavailable" }
  | { status: "invalid_response" }
  | { status: "configuration_missing" }
  | { status: "unexpected_error" };

export type CarrierLookupStatus = CarrierLookupResult["status"];

export interface CarrierAdapter {
  slug: CarrierSlug;
  /** Semantic version marker persisted alongside cached results. */
  version: string;
  /** Structured match, or null when this adapter cannot resolve a
   *  usable identifier from the entry. Pure — no I/O. */
  match(info: TrackingEntryInfo): CarrierMatch | null;
  /** Fetch + normalize the shipment timeline. NEVER throws — every
   *  failure mode returns its typed branch. */
  fetchTimeline(trackingNumber: string): Promise<CarrierLookupResult>;
}

/** Registry detection outcome per tracking entry — plan §5.1.
 *  `unsupported_carrier` (identified, no adapter) is NOT an API failure
 *  and is never conflated with one. */
export type CarrierDetection =
  | { outcome: "matched"; carrier: CarrierSlug; match: CarrierMatch; adapter: CarrierAdapter }
  | {
      /** Identified carrier with a registered adapter, but no usable
       *  identifier could be resolved (e.g. conflicting URL ids). */
      outcome: "identifier_unresolved";
      carrier: CarrierSlug;
    }
  | { outcome: "unsupported_carrier"; carrier: CarrierSlug; identifiedFrom: "company" | "url" }
  | { outcome: "unknown_carrier" }
  | { outcome: "no_tracking" };
