/**
 * Pins the source-level collapse of the two delivery field keys
 * (`shipping_tracking` + `delivery_proof`) into ONE proof-labeled line
 * item — the fix for the duplicate "Delivery confirmation" rows that
 * appeared on every dispute-detail surface (Overview summary, Overview
 * strength list, Evidence tab, Review & Submit tab all read this one
 * `deriveEvidenceLineItems` output).
 *
 * Verified against prod dispute #12936: PostNord tracked, carrier
 * NOT_DELIVERED, proofType `delivered_unverified`.
 */

import { describe, it, expect } from "vitest";
import { deriveEvidenceLineItems } from "@/lib/argument/evidenceLineItem";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

// The verified #12936 fulfillment section payload (shared by both keys).
const DELIVERY_PAYLOAD = {
  proofType: "delivered_unverified",
  deliveredAt: null,
  signedByName: null,
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "NOT_DELIVERED",
      createdAt: "2026-06-07T14:39:06Z",
      deliveredAt: null,
      estimatedDeliveryAt: "2026-06-09T18:00:00Z",
      tracking: [
        {
          url: "https://tracking.postnord.com/se/?id=00573132901672098616",
          number: "00573132901672098616",
          carrier: "PostNord SE",
        },
      ],
    },
  ],
};

function checklistItem(field: string): ChecklistItemV2 {
  return {
    field,
    label: field === "shipping_tracking" ? "Shipping Tracking" : "Delivery Proof",
    status: "available",
    source: "auto_shopify",
    blocking: false,
    priority: "critical",
    collectionType: "conditional_auto",
  } as ChecklistItemV2;
}

function derive(proofType: string, extraPayload: Record<string, unknown> = {}) {
  const payload = { ...DELIVERY_PAYLOAD, proofType, ...extraPayload };
  const payloadByField = new Map<string, unknown>([
    ["shipping_tracking", payload],
    ["delivery_proof", payload],
  ]);
  return deriveEvidenceLineItems({
    checklist: [checklistItem("shipping_tracking"), checklistItem("delivery_proof")],
    facts: [],
    payloadByField,
    contributions: { strong: [], moderate: [] },
    packSavedToShopify: false,
    excludedFields: new Set<string>(),
    attachmentUploadFailures: new Map<string, string>(),
    inclusionOverrides: new Map(),
    reasonFamily: "delivery",
  });
}

describe("delivery row collapse — one row, not two", () => {
  it("collapses shipping_tracking + delivery_proof into a single line item", () => {
    const rows = derive("delivered_unverified");
    const deliveryRows = rows.filter(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    );
    expect(deliveryRows).toHaveLength(1);
  });

  it("labels the unverified row 'Shipping & tracking', never a bare 'Delivery confirmation'", () => {
    const rows = derive("delivered_unverified");
    const row = rows.find(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    )!;
    expect(row.displayLabelToken?.key).toBe("disputes.deliveryProof.shippedUnconfirmed");
    // Must NOT be the generic signal label.
    expect(row.displayLabelToken?.key).not.toBe("disputes.signalLabel.delivery");
  });

  it("carries concrete facts + tracking link from the payload", () => {
    const rows = derive("delivered_unverified");
    const row = rows.find(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    )!;
    expect(row.trackingNumber).toBe("00573132901672098616");
    expect(row.trackingUrl).toBe(
      "https://tracking.postnord.com/se/?id=00573132901672098616",
    );
    expect(row.factsTokens && row.factsTokens.length).toBeGreaterThan(0);
    // Shipped-via + not-delivered segments present.
    const keys = (row.factsTokens ?? []).map((tok) => tok.key);
    expect(keys).toContain("disputes.deliveryProof.factsShippedVia");
    // eta present in the #12936 payload → the eta variant.
    expect(keys).toContain("disputes.deliveryProof.factsNotDeliveredEta");
  });

  it("escalates the label when the carrier confirmed delivery", () => {
    const carrier = derive("delivered_confirmed", { deliveredAt: "2026-06-09T10:00:00Z" });
    const cRow = carrier.find(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    )!;
    expect(cRow.displayLabelToken?.key).toBe("disputes.deliveryProof.carrierConfirmed");

    const sig = derive("signature_confirmed", { signedByName: "J. Smith" });
    const sRow = sig.find(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    )!;
    expect(sRow.displayLabelToken?.key).toBe("disputes.deliveryProof.signature");
  });

  it("replaces the generic context reason with proof-specific why-context", () => {
    const rows = derive("delivered_unverified");
    const row = rows.find(
      (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
    )!;
    // Only when included as context/bank evidence.
    if (row.submissionMethod === "context_only" || row.submissionMethod === "bank_argument") {
      expect(row.reasonToken.key).toBe("disputes.deliveryProof.whyShippedUnconfirmed");
    }
  });
});
