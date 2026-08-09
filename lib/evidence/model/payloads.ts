/**
 * Typed, field-discriminated evidence payloads.
 *
 * WHY. `EvidenceFact.value` is `Record<string, unknown>` today, so every
 * consumer re-interprets raw collector JSON its own way — four independent
 * tracking-number extractors, five IP-eligibility gates, two "is this in the
 * PDF" predicates. A typed union closes that door: consumers receive
 * normalized values and cannot invent new readings of the raw record.
 *
 * NORMALIZATION IS NOT OPTIONAL. A prod survey on 2026-08-04 found that EVERY
 * field carries at least two shapes, because collectors changed over time and
 * `pack_json` was never migrated:
 *
 *   avs_cvv_match       111 packs `avsResultCode`      · 11 packs `avs_result_code`
 *   ip_location_check   121 packs full ipinfo shape    · 11 packs `ipMatchesBilling`
 *   delivery_proof       69 packs `fulfillments[]`     ·  4 packs flat `trackingNumber`
 *   activity_log        121 packs `timelineEvents`     · 22 packs `eventCount`
 *   policies            124 packs `policies`           ·  8 packs `refundUrl`
 *   customer_account_info 91 packs without `disputeFreeHistory` · 30 with
 *
 * The legacy shapes are historical — the newest snake_case pack is
 * 2026-01-19 and all are decided — so this is not a live merchant-facing bug.
 * But re-deriving the model on read (which the plan requires) touches those
 * packs, and a normalizer that only knows the current shape would silently
 * report "no AVS result" for a dispute that has one. Reading a decided case
 * wrongly is how a post-mortem reaches the wrong conclusion.
 *
 * Every legacy arm below is annotated with the prod count that justifies it.
 * Nothing here is speculative back-compat.
 */

import {
  readPaymentVerification,
  type VerificationOutcome,
} from "@/lib/argument/paymentVerification";
import type { AvsAuthority, AvsNormalizedResult, CardNetwork } from "@/lib/argument/avsCodeMap";
import type { EvidenceFieldKey } from "./domains";

/* ── Shared value types ──────────────────────────────────────────────── */

export type DeliveryProofType =
  | "signature_confirmed"
  | "delivered_confirmed"
  | "delivered_unverified"
  | "label_created";

export interface TrackingEntry {
  carrier: string | null;
  number: string | null;
  url: string | null;
}

export interface FulfillmentInstance {
  /** Shopify GID when present — the stable per-parcel identity. */
  fulfillmentId: string | null;
  status: string | null;
  deliveredAt: string | null;
  tracking: TrackingEntry[];
}

export interface ConversationInstance {
  /** Helpdesk conversation / message id when present. */
  conversationId: string | null;
  channel: "gorgias" | "shopify_timeline" | "manual";
  lastMessageAt: string | null;
  customerConfirmsOrder: boolean;
}

export interface UploadInstance {
  evidenceItemId: string | null;
  filename: string | null;
  mimeType: string | null;
  storagePath: string | null;
}

/* ── The discriminated union ─────────────────────────────────────────── */

export type EvidencePayload =
  | {
      fieldKey: "delivery_proof" | "shipping_tracking";
      proofType: DeliveryProofType | null;
      deliveredAt: string | null;
      /**
       * `deliveredToVerifiedAddress` was removed from this arm on 2026-08-07
       * (PR-C1). It was an unsubstantiated STRONG upgrade derived from a
       * billing-vs-shipping city comparison, and it is now a retired payload
       * key stripped before normalization — see
       * `lib/evidence/model/retiredKeys.ts`. It is deliberately NOT kept as an
       * always-false field: a typed `false` invites a consumer to reason about
       * it. `collectedByCustomer` was never in this union.
       */
      signedByName: string | null;
      /** One entry per parcel. The multi-instance source for P2a splitting. */
      fulfillments: FulfillmentInstance[];
    }
  | {
      fieldKey: "tds_authentication";
      authenticated: boolean;
      liabilityShift: boolean;
      merchantConfirmed: boolean;
      eci: string | null;
      dsTransactionId: string | null;
      version: string | null;
      flow: string | null;
      exemption: string | null;
    }
  | {
      fieldKey: "avs_cvv_match";
      /**
       * PR-C3: the canonical model carries the NORMALIZED verification, not a
       * pair of letters for each consumer to re-read. Everything below is
       * derived by `lib/argument/paymentVerification.ts` — the map is not
       * duplicated here and no raw letter is reinterpreted.
       */
      network: CardNetwork;
      /** Raw codes are MERCHANT-ONLY, kept for audit and display. Bank-facing
       *  prose is built in the projection layer, never by concatenating these. */
      avsResultCode: string | null;
      cvvResultCode: string | null;
      /** Factual reading of the issuer's AVS response. */
      avsNormalized: AvsNormalizedResult;
      /** Verification state of the (network, code) cell it resolved through. */
      avsAuthority: AvsAuthority;
      /** The code is outside the canonical map: diagnostic, never credit. */
      avsUnmapped: boolean;
      /** SCORING: the address matched (any of the three match flavours). */
      addressVerified: boolean;
      /** CITATION: the cell is primary-sourced — register R-E on Visa. */
      citableAddressVerified: boolean;
      /** The CVV subfact: its descriptive outcome and its match. */
      cvvOutcome: VerificationOutcome | null;
      securityCodeVerified: boolean;
      /** Fact-level citability (decision 1 + decision 3). */
      citable: boolean;
      cardholderName: string | null;
    }
  | {
      fieldKey: "customer_communication";
      conversations: ConversationInstance[];
      customerConfirmsOrder: boolean;
    }
  | {
      fieldKey: "supporting_documents" | "product_description";
      uploads: UploadInstance[];
    }
  | {
      fieldKey: "ip_location_check";
      bankEligible: boolean;
      locationMatch: string | null;
      riskLevel: string | null;
    }
  | {
      fieldKey: "fraud_risk_screening";
      positiveFactCount: number;
      isNegativeVerdict: boolean;
      riskLevel: string | null;
      recommendation: string | null;
    }
  | {
      fieldKey: "refund_record";
      refundStatus: string | null;
      amount: number | null;
      currency: string | null;
      refundedAt: string | null;
    }
  | { fieldKey: "no_return_initiated"; returnStatus: string | null }
  /**
   * `billing_address_match` had an arm here until 2026-08-09 (PR-C4). It is a
   * retired FIELD key now, so no arm exists and none may be added: the union is
   * keyed on `EvidenceFieldKey`, and the retired key is no longer one. A
   * historical `pack_json` carrying it still parses — the field is simply never
   * normalized, exactly like `deliveredToVerifiedAddress` on the delivery arm.
   * See `lib/evidence/model/retiredKeys.ts`.
   */
  | {
      fieldKey: "customer_account_info";
      totalOrders: number | null;
      priorUndisputedOrders: number | null;
      customerSince: string | null;
    }
  | { fieldKey: "activity_log"; eventCount: number | null; digitalAccessUsed: boolean }
  | {
      fieldKey: "refund_policy" | "shipping_policy" | "cancellation_policy";
      acceptedAtCheckout: boolean;
      url: string | null;
    }
  | { fieldKey: "order_confirmation"; orderName: string | null; channel: string | null }
  | { fieldKey: "duplicate_explanation"; note: string | null }
  | { fieldKey: "device_session_consistency"; consistent: boolean };

export type EvidencePayloadFor<K extends EvidenceFieldKey> = Extract<
  EvidencePayload,
  { fieldKey: K }
>;

/* ── Normalization ───────────────────────────────────────────────────── */

type Raw = Record<string, unknown> | null | undefined;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];

function normalizeTracking(raw: Raw): TrackingEntry[] {
  return arr(raw?.tracking).map((t) => ({
    carrier: str(t.carrier),
    number: str(t.number),
    url: str(t.url),
  }));
}

function normalizeFulfillments(raw: Raw): FulfillmentInstance[] {
  const nested = arr(raw?.fulfillments);
  if (nested.length > 0) {
    return nested.map((f) => ({
      fulfillmentId: str(f.fulfillmentId),
      status: str(f.status),
      deliveredAt: str(f.deliveredAt),
      tracking: normalizeTracking(f),
    }));
  }
  // LEGACY (4 packs, newest 2026-01): flat carrier/trackingNumber, no array.
  const flatNumber = str(raw?.trackingNumber);
  const flatCarrier = str(raw?.carrier);
  if (!flatNumber && !flatCarrier) return [];
  return [
    {
      fulfillmentId: null,
      status: str(raw?.status),
      deliveredAt: str(raw?.deliveredAt),
      tracking: [{ carrier: flatCarrier, number: flatNumber, url: null }],
    },
  ];
}

function normalizeConversations(raw: Raw): ConversationInstance[] {
  const gorgias = arr(raw?.conversations);
  if (gorgias.length > 0) {
    return gorgias.map((c) => ({
      conversationId: str(c.id) ?? str(c.conversationId),
      channel: "gorgias" as const,
      lastMessageAt: str(c.lastMessageAt) ?? str(c.updatedAt),
      customerConfirmsOrder: bool(c.customerConfirmsOrder),
    }));
  }
  // Manual paste / timeline: one conversation, count carried separately.
  const count = num(raw?.messageCount);
  if (count && count > 0) {
    return Array.from({ length: count }, (_, i) => ({
      conversationId: `manual-${i}`,
      channel: "manual" as const,
      lastMessageAt: str(raw?.lastMessageAt),
      customerConfirmsOrder: bool(raw?.customerConfirmsOrder),
    }));
  }
  if (arr(raw?.timelineEvents).length > 0) {
    return [
      {
        conversationId: null,
        channel: "shopify_timeline" as const,
        lastMessageAt: null,
        customerConfirmsOrder: bool(raw?.customerConfirmsOrder),
      },
    ];
  }
  return [];
}

/**
 * Raw collector `data` → the typed payload for `fieldKey`.
 *
 * Returns `null` only when the field has no union arm, which the domain
 * registry makes impossible for a registered evidence field — the caller
 * treats `null` as "unregistered", never as "empty".
 */
export function normalizeEvidencePayload(
  fieldKey: EvidenceFieldKey,
  raw: Raw,
): EvidencePayload | null {
  switch (fieldKey) {
    case "delivery_proof":
    case "shipping_tracking":
      return {
        fieldKey,
        proofType: (str(raw?.proofType) as DeliveryProofType | null) ?? null,
        deliveredAt: str(raw?.deliveredAt),
        signedByName: str(raw?.signedByName),
        fulfillments: normalizeFulfillments(raw),
      };

    case "tds_authentication":
      return {
        fieldKey,
        authenticated: bool(raw?.tdsAuthenticated),
        liabilityShift: bool(raw?.liabilityShift),
        merchantConfirmed: bool(raw?.tdsVerified),
        eci: str(raw?.eci),
        dsTransactionId: str(raw?.dsTransactionId),
        version: str(raw?.tdsVersion),
        flow: str(raw?.authenticationFlow),
        exemption: str(raw?.exemptionIndicator),
      };

    case "avs_cvv_match": {
      // Derived through the ONE owner (PR-C3), which also handles the LEGACY
      // shapes — snake_case `avs_result_code` (11 packs, newest 2026-01-19)
      // and the `avsResult` fact projection. A second reading of the letters
      // here is exactly the divergence the canonical model exists to remove.
      const v = readPaymentVerification(raw);
      return {
        fieldKey,
        network: v.network,
        avsResultCode: v.avs.code,
        cvvResultCode: v.cvv.code,
        avsNormalized: v.avs.normalized,
        avsAuthority: v.avs.authority,
        avsUnmapped: v.avs.unmapped,
        addressVerified: v.addressVerified,
        citableAddressVerified: v.citableAddressVerified,
        cvvOutcome: v.cvv.outcome,
        securityCodeVerified: v.securityCodeVerified,
        citable: v.citable,
        cardholderName: v.cardholderName,
      };
    }

    case "customer_communication":
      return {
        fieldKey,
        conversations: normalizeConversations(raw),
        customerConfirmsOrder: bool(raw?.customerConfirmsOrder),
      };

    case "supporting_documents":
    case "product_description":
      return {
        fieldKey,
        uploads: arr(raw?.uploads).map((u) => ({
          evidenceItemId: str(u.id),
          filename: str(u.fileName) ?? str(u.filename),
          mimeType: str(u.mimeType) ?? str(u.fileType),
          storagePath: str(u.storagePath),
        })),
      };

    case "ip_location_check":
      return {
        fieldKey,
        // LEGACY (11 packs): `ipMatchesBilling` predates `bankEligible`.
        bankEligible: bool(raw?.bankEligible) || bool(raw?.ipMatchesBilling),
        locationMatch: str(raw?.locationMatch),
        riskLevel: str(raw?.riskLevel),
      };

    case "fraud_risk_screening":
      return {
        fieldKey,
        positiveFactCount: arr(raw?.positiveFacts).length,
        isNegativeVerdict: bool(raw?.isNegativeVerdict),
        riskLevel: str(raw?.riskLevel),
        recommendation: str(raw?.recommendation),
      };

    case "refund_record":
      return {
        fieldKey,
        refundStatus: str(raw?.refundStatus),
        amount: num(raw?.amount),
        currency: str(raw?.currency),
        refundedAt: str(raw?.refundedAt),
      };

    case "no_return_initiated":
      return { fieldKey, returnStatus: str(raw?.returnStatus) };

    case "customer_account_info":
      return {
        fieldKey,
        totalOrders: num(raw?.totalOrders),
        // Absent on 91 of 121 packs — `effectivePriorOrders` exists precisely
        // because `totalOrders` INCLUDES the disputed order.
        priorUndisputedOrders: num(raw?.priorUndisputedOrders),
        customerSince: str(raw?.customerSince),
      };

    case "activity_log":
      return {
        fieldKey,
        // LEGACY (22 packs): `eventCount` predates `timelineEventCount`.
        eventCount: num(raw?.timelineEventCount) ?? num(raw?.eventCount),
        digitalAccessUsed: bool(raw?.digitalAccessUsed),
      };

    case "refund_policy":
    case "shipping_policy":
    case "cancellation_policy":
      return {
        fieldKey,
        acceptedAtCheckout: bool(raw?.acceptedAtCheckout),
        // LEGACY (8 packs): flat `refundUrl` / `shippingUrl` / `cancellationUrl`
        // instead of a `policies` object.
        url:
          str(raw?.url) ??
          str(raw?.[fieldKey.replace("_policy", "Url")]) ??
          null,
      };

    case "order_confirmation":
      return { fieldKey, orderName: str(raw?.orderName), channel: str(raw?.channel) };

    case "duplicate_explanation":
      return { fieldKey, note: str(raw?.note) };

    case "device_session_consistency":
      return { fieldKey, consistent: bool(raw?.consistent) };

    default:
      return null;
  }
}

/**
 * How many real instances this payload holds. Drives multi-record splitting;
 * `1` for single-cardinality fields by construction.
 */
export function instanceCount(payload: EvidencePayload): number {
  switch (payload.fieldKey) {
    case "delivery_proof":
    case "shipping_tracking":
      return Math.max(payload.fulfillments.length, 1);
    case "customer_communication":
      return Math.max(payload.conversations.length, 1);
    case "supporting_documents":
    case "product_description":
      return Math.max(payload.uploads.length, 1);
    default:
      return 1;
  }
}
