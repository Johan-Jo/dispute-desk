/**
 * Split shipment — one order, several parcels, several carriers.
 *
 * Payload shape and every literal below are the REAL prod values from
 * blume-box dispute 4576ee51 (order #360980, $129, PRODUCT_NOT_RECEIVED),
 * read from `evidence_items.payload` on 2026-09-22.
 *
 * The defect: `buildDeliveryFacts` filled carrier, number and url from
 * three INDEPENDENT first-non-null scans across every fulfillment, so a
 * two-parcel order collapsed to whichever values came first. Here the USPS
 * fulfillment sorted first with an unusable reference, so the row rendered
 * that and DROPPED the working GOFO link — hiding the parcel carrying $89
 * of the $129 claim from an item-not-received defence.
 */

import { describe, expect, it } from "vitest";
import { deriveEvidenceLineItems } from "@/lib/argument/evidenceLineItem";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const SPLIT_PAYLOAD = {
  proofType: "delivered_unverified",
  deliveredAt: null,
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "FULFILLED",
      createdAt: "2026-09-16T18:53:06Z",
      deliveredAt: null,
      items: [{ title: "Sunburst Mineral SPF 50 Sunscreen", quantity: 1 }],
      tracking: [
        {
          carrier: "USPS",
          number: "260914OET4",
          url: "https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=260914OET4",
        },
      ],
    },
    {
      status: "SUCCESS",
      displayStatus: "IN_TRANSIT",
      createdAt: "2026-09-15T19:25:25Z",
      deliveredAt: null,
      items: [{ title: "The Back to School Bundle", quantity: 1 }],
      tracking: [
        {
          carrier: "GOFO",
          number: "YT2640221437435982",
          url: "https://www.gofo.com/us/track?searchID=YT2640221437435982",
        },
      ],
    },
  ],
};

const SINGLE_PAYLOAD = {
  proofType: "delivered_unverified",
  deliveredAt: null,
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "IN_TRANSIT",
      createdAt: "2026-09-15T19:25:25Z",
      deliveredAt: null,
      items: [{ title: "The Back to School Bundle", quantity: 1 }],
      tracking: [
        {
          carrier: "GOFO",
          number: "YT2640221437435982",
          url: "https://www.gofo.com/us/track?searchID=YT2640221437435982",
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

function deliveryRow(payload: Record<string, unknown>) {
  const payloadByField = new Map<string, unknown>([
    ["shipping_tracking", payload],
    ["delivery_proof", payload],
  ]);
  const rows = deriveEvidenceLineItems({
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
  return rows.find(
    (li) => li.field === "shipping_tracking" || li.field === "delivery_proof",
  )!;
}

describe("split shipment — every parcel is surfaced", () => {
  it("emits one entry per parcel", () => {
    expect(deliveryRow(SPLIT_PAYLOAD).parcels).toHaveLength(2);
  });

  it("keeps the working GOFO link that array position used to hide", () => {
    const gofo = deliveryRow(SPLIT_PAYLOAD).parcels!.find((p) => p.carrier === "GOFO")!;
    expect(gofo.url).toBe("https://www.gofo.com/us/track?searchID=YT2640221437435982");
    expect(gofo.number).toBe("YT2640221437435982");
  });

  it("still withholds a link for the unusable USPS reference", () => {
    // `260914OET4` is a shipping-app batch reference; USPS answers
    // "tracking number is invalid". No link beats a dead link.
    const usps = deliveryRow(SPLIT_PAYLOAD).parcels!.find((p) => p.carrier === "USPS")!;
    expect(usps.url).toBeNull();
    expect(usps.number).toBe("260914OET4");
  });

  it("never crosses one parcel's carrier with another's number", () => {
    // The three-independent-scans bug made this possible. Each entry must
    // be internally consistent: carrier, number and url read together.
    for (const parcel of deliveryRow(SPLIT_PAYLOAD).parcels!) {
      if (parcel.carrier === "GOFO") {
        expect(parcel.number).toBe("YT2640221437435982");
        expect(parcel.url).toContain("gofo.com");
      }
      if (parcel.carrier === "USPS") {
        expect(parcel.number).toBe("260914OET4");
        expect(parcel.url).toBeNull();
      }
    }
  });

  it("names each parcel's CONTENTS so two parcels are tellable apart", () => {
    const parcels = deliveryRow(SPLIT_PAYLOAD).parcels!;
    expect(parcels.find((p) => p.carrier === "GOFO")!.items).toEqual([
      "The Back to School Bundle",
    ]);
    expect(parcels.find((p) => p.carrier === "USPS")!.items).toEqual([
      "Sunburst Mineral SPF 50 Sunscreen",
    ]);
  });

  it("carries Shopify's displayStatus verbatim, un-interpreted", () => {
    // Deliberately NOT mapped to delivered/not-delivered here. "FULFILLED"
    // means handed off, not arrived; the renderer owns the wording.
    const parcels = deliveryRow(SPLIT_PAYLOAD).parcels!;
    expect(parcels.find((p) => p.carrier === "GOFO")!.displayStatus).toBe("IN_TRANSIT");
    expect(parcels.find((p) => p.carrier === "USPS")!.displayStatus).toBe("FULFILLED");
  });

  it("asserts delivery for NEITHER parcel", () => {
    // Neither carries a deliveredAt. "FULFILLED" must never be read as a
    // delivery claim, and an unlookuppable reference is UNKNOWN, not
    // negative — absence of a scan is not evidence of non-delivery.
    for (const parcel of deliveryRow(SPLIT_PAYLOAD).parcels!) {
      expect(parcel.displayStatus).not.toBe("DELIVERED");
    }
  });

  it("exposes the carrier split the heading is built from", () => {
    // The row states "shipped in 2 parcels, with 2 different carriers"
    // rather than leaving the merchant to infer it from two stacked
    // tracking lines. On an item-not-received dispute that distinction
    // matters: "one parcel arrived, the other is still moving" is a
    // different defence from "the order is late".
    const parcels = deliveryRow(SPLIT_PAYLOAD).parcels!;
    const distinctCarriers = new Set(
      parcels.map((p) => (p.carrier ?? "").trim().toLowerCase()).filter(Boolean),
    );
    expect(distinctCarriers).toEqual(new Set(["gofo", "usps"]));
    expect(parcels).toHaveLength(2);
  });

  it("leaves a SINGLE-parcel order untouched", () => {
    // Regression guard: `parcels` stays empty so the existing scalar
    // rendering path is byte-identical for the common case.
    const row = deliveryRow(SINGLE_PAYLOAD);
    expect(row.parcels ?? []).toHaveLength(0);
    expect(row.trackingNumber).toBe("YT2640221437435982");
    expect(row.trackingUrl).toBe(
      "https://www.gofo.com/us/track?searchID=YT2640221437435982",
    );
  });
});
