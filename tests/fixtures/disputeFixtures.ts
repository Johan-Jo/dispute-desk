/**
 * Shared fixtures for the dispute-detail redesign acceptance tests.
 *
 * Each fixture builds a `ChecklistItemV2[]` + a `payloadByField` map
 * matching what the workspace pipeline produces. The fixtures mirror
 * the real screenshot scenarios used to write the spec:
 *
 *   - weakFraudFixture: the dispute the redesign was scoped against
 *     (Visa 10.4, all rows resolve to supporting / internal-only).
 *   - policiesOnlyFraudFixture: fraud with 3 policies accepted at
 *     checkout but no AVS / delivery / communication.
 *   - orderReceiptOnlyFraudFixture: fraud with only order_confirmation.
 *   - mixedInclusionFixture: covers the inclusion-summary subsection
 *     matrix (1 of each method).
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

export interface DisputeFixture {
  reason: string;
  checklist: ChecklistItemV2[];
  /** Field key → arbitrary payload object. Mirrors what
   *  `pack.evidenceItemsByField[field].payload` returns. */
  payloadByField: Map<string, unknown>;
}

function availableSupporting(field: string, label: string): ChecklistItemV2 {
  return {
    field,
    label,
    status: "available",
    priority: "recommended",
    blocking: false,
    source: "auto_shopify",
    collectionType: "auto",
  };
}

function availableCritical(field: string, label: string): ChecklistItemV2 {
  return {
    field,
    label,
    status: "available",
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
    collectionType: "auto",
  };
}

function availableManual(field: string, label: string): ChecklistItemV2 {
  return {
    field,
    label,
    status: "available",
    priority: "optional",
    blocking: false,
    source: "manual_upload",
    collectionType: "manual",
  };
}

function missingCritical(field: string, label: string): ChecklistItemV2 {
  return {
    field,
    label,
    status: "missing",
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
    collectionType: "auto",
  };
}

/**
 * Weak fraud case: every row resolves to supporting or internal-only.
 * Mirrors the screenshot used to scope the redesign. Reason FRAUDULENT,
 * 8 sections collected, 0 strong/moderate contributions.
 */
export function weakFraudFixture(): DisputeFixture {
  const checklist: ChecklistItemV2[] = [
    availableCritical("order_confirmation", "Order record"),
    availableSupporting("activity_log", "Customer activity log"),
    // ip_location_check is internal-only by default
    availableSupporting("ip_location_check", "IP & location consistency"),
    availableSupporting("customer_communication", "Customer communication"),
    availableSupporting("refund_policy", "Refund policy"),
    availableSupporting("shipping_policy", "Shipping policy"),
    availableSupporting("cancellation_policy", "Cancellation policy"),
    availableManual("supporting_documents", "Supplementary documents"),
    // missing decisive signals
    missingCritical("avs_cvv_match", "Payment authentication"),
    missingCritical("delivery_proof", "Delivery confirmation"),
  ];

  const payloadByField = new Map<string, unknown>([
    // Order record — billing/shipping country mismatch (internal-only signal)
    [
      "order_confirmation",
      {
        billingAddress: { city: "Stockholm", countryCode: "SE" },
        shippingAddress: { city: "Berlin", countryCode: "DE" },
      },
    ],
    // Activity log without decisive session proof
    ["activity_log", { decisiveSessionProof: false }],
    // IP location: different country → internal-only
    ["ip_location_check", { locationMatch: "different_country", riskLevel: "low" }],
    // Customer communication without confirmation
    ["customer_communication", { customerConfirmsOrder: false, messageCount: 2 }],
    // Policies on file but not accepted at checkout → supporting only
    ["refund_policy", { acceptedAtCheckout: false }],
    ["shipping_policy", { acceptedAtCheckout: false }],
    ["cancellation_policy", { acceptedAtCheckout: false }],
    // Generic supporting doc — no signed contract
    ["supporting_documents", { fileType: "pdf", signedContract: false }],
  ]);

  return { reason: "FRAUDULENT", checklist, payloadByField };
}

/**
 * Fraud + policies only: 3 policies accepted at checkout (which the
 * canonical categorizer treats as `strong`), but zero decisive fraud
 * signals. Must remain Weak per the fraud decisive-signal filter.
 */
export function policiesOnlyFraudFixture(): DisputeFixture {
  const checklist: ChecklistItemV2[] = [
    availableSupporting("refund_policy", "Refund policy"),
    availableSupporting("shipping_policy", "Shipping policy"),
    availableSupporting("cancellation_policy", "Cancellation policy"),
    missingCritical("avs_cvv_match", "Payment authentication"),
    missingCritical("delivery_proof", "Delivery confirmation"),
    missingCritical("customer_communication", "Customer communication"),
  ];

  const acceptedPayload = {
    acceptedAtCheckout: true,
    acceptanceTimestamp: "2026-05-15T10:00:00Z",
  };

  const payloadByField = new Map<string, unknown>([
    ["refund_policy", acceptedPayload],
    ["shipping_policy", acceptedPayload],
    ["cancellation_policy", acceptedPayload],
  ]);

  return { reason: "FRAUDULENT", checklist, payloadByField };
}

/**
 * Fraud + order receipt only. `order_confirmation` is `supportingOnly`
 * in the registry, so it never elevates regardless of payload.
 * Must remain Weak.
 */
export function orderReceiptOnlyFraudFixture(): DisputeFixture {
  const checklist: ChecklistItemV2[] = [
    availableCritical("order_confirmation", "Order record"),
    missingCritical("avs_cvv_match", "Payment authentication"),
    missingCritical("delivery_proof", "Delivery confirmation"),
  ];

  const payloadByField = new Map<string, unknown>([
    [
      "order_confirmation",
      {
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "NYC", countryCode: "US" },
      },
    ],
  ]);

  return { reason: "FRAUDULENT", checklist, payloadByField };
}

/**
 * Mixed-inclusion fixture: at least one row of each `submissionMethod`
 * value, used to verify the SubmissionSummaryPanel subsection matrix.
 */
export function mixedInclusionFixture(): DisputeFixture {
  const checklist: ChecklistItemV2[] = [
    availableCritical("avs_cvv_match", "Payment authentication"),        // bank_argument (positive)
    availableCritical("order_confirmation", "Order record"),              // context_only (supportingOnly)
    availableSupporting("ip_location_check", "IP & location consistency"), // internal_only (negative)
    availableManual("supporting_documents", "Supplementary documents"),  // context_only by default
    {
      field: "delivery_proof",
      label: "Delivery confirmation",
      status: "waived",
      priority: "recommended",
      blocking: false,
      source: "auto_shopify",
      collectionType: "conditional_auto",
      waiveReason: "evidence_unavailable",
      waivedAt: "2026-05-17T12:00:00Z",
      waivedBy: "merchant",
    },
    missingCritical("customer_communication", "Customer communication"), // not_included
  ];

  const payloadByField = new Map<string, unknown>([
    // AVS + CVV both match → strong, positive bank argument
    ["avs_cvv_match", { avsResultCode: "Y", cvvResultCode: "M" }],
    // Order record — addresses match (no internal-only signal from billing)
    [
      "order_confirmation",
      {
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "NYC", countryCode: "US" },
      },
    ],
    // IP mismatch → internal-only
    ["ip_location_check", { locationMatch: "different_country", riskLevel: "high" }],
    // Generic supporting docs — no decisive payload
    ["supporting_documents", { fileType: "pdf", signedContract: false }],
  ]);

  return { reason: "FRAUDULENT", checklist, payloadByField };
}
