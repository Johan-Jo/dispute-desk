/**
 * What the merchant SEES on a returned parcel, and what the case scores.
 *
 * Before 2026-08-20 a returned shipment collapsed into `label_created`,
 * whose copy reads "a shipping label was created but the carrier never
 * scanned the parcel". On cay-collective #13195 the carrier had scanned
 * that parcel all the way out and all the way back. Same score, opposite
 * meaning — these tests pin the distinction so it cannot collapse again.
 */

import { describe, it, expect } from "vitest";
import {
  buildDeliveryPresentation,
  resolveDeliveryReceipt,
  resolveDeliveryTitle,
} from "../deliveryPresentation";
import { categorizeEvidenceField } from "../canonicalEvidence";
import { calculateCaseStrength } from "../caseStrength";
import { gatesWith } from "@/tests/helpers/caseStrengthGates";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

/** #13195's delivery payload, in the parts every surface reads. */
const RETURNED_PAYLOAD = {
  proofType: "returned_to_sender",
  deliveredAt: null,
  fulfillments: [
    {
      fulfillmentId: "gid://shopify/Fulfillment/7329764770058",
      createdAt: "2026-06-18T15:10:25Z",
      tracking: [
        {
          carrier: "DHL Freight",
          number: "6069930029",
          url: "https://www.logistics.dhl/se-en/home/tracking/tracking-freight.html?tracking-id=373325386418989795",
        },
      ],
      carrierTracking: {
        deliveryStatus: "Returned",
        deliveredAtTracking: null,
        trackingSource: "carrier_api_dhl",
        signedByName: null,
      },
      carrierTerminalEvent: {
        message: "Shipment returned to sender",
        happenedAt: "2026-07-06T09:40:00",
      },
    },
  ],
};

describe("a returned parcel is displayed as returned, not as an unscanned label", () => {
  it("resolves a `returned` receipt state with the carrier's terminal date", () => {
    const r = resolveDeliveryReceipt(RETURNED_PAYLOAD);
    expect(r.state).toBe("returned");
    expect(r.date).toBe("2026-07-06T09:40:00");
    expect(r.carrierApiSlug).toBe("dhl");
  });

  it("titles the row with what happened and when", () => {
    const token = resolveDeliveryTitle("returned_to_sender", RETURNED_PAYLOAD);
    expect(token.key).toBe("disputes.deliveryProof.titleReturnedToSenderOn");
    expect((token.params as { date: string }).date).toBe("Jul 6");
  });

  it("never renders the label-only wording for a shipment that came back", () => {
    const p = buildDeliveryPresentation(RETURNED_PAYLOAD);
    expect(p.labelKey).toBe("disputes.deliveryProof.returnedToSender");
    expect(p.labelKey).not.toBe("disputes.deliveryProof.labelOnly");
    // The tracking link still renders — the merchant must be able to open
    // the carrier page that says the same thing.
    expect(p.trackingLinks[0]?.number).toBe("6069930029");
  });

  it("scores `invalid` — same as a bare label, because it is not delivery evidence", () => {
    expect(categorizeEvidenceField("delivery_proof", RETURNED_PAYLOAD)).toBe("invalid");
    expect(categorizeEvidenceField("shipping_tracking", RETURNED_PAYLOAD)).toBe("invalid");
  });

  it("falls back to the undated title when the carrier reported no date", () => {
    const noDate = {
      ...RETURNED_PAYLOAD,
      fulfillments: [
        {
          ...RETURNED_PAYLOAD.fulfillments[0],
          carrierTerminalEvent: undefined,
        },
      ],
    };
    expect(resolveDeliveryTitle("returned_to_sender", noDate).key).toBe(
      "disputes.deliveryProof.titleReturnedToSender",
    );
  });
});

describe("the returned-to-sender gate caps the case", () => {
  const row = (field: string, label: string): ChecklistItemV2 => ({
    field,
    label,
    status: "available",
    requirementMode: "recommended",
    priority: "recommended",
    blocking: false,
    expectedSource: "auto_shopify",
    source: "auto_shopify",
    collectionType: "conditional_auto",
  } as unknown as ChecklistItemV2);

  const checklist: ChecklistItemV2[] = [
    row("order_confirmation", "Order Confirmation"),
    row("no_return_initiated", "Return Status"),
  ];

  const payloads = {
    kind: "list" as const,
    items: [
      {
        payload: {
          fieldsProvided: ["no_return_initiated"],
          returnStatus: "NO_RETURN",
        },
      },
    ],
  };

  it("without the gate, a lone refund signal reaches moderate (the old behaviour)", () => {
    const r = calculateCaseStrength(
      checklist,
      "CREDIT_NOT_PROCESSED",
      payloads,
      gatesWith({ returnedToSender: null }),
    );
    expect(r.overall).toBe("moderate");
  });

  it("with the gate triggered, the same inputs cap at weak and go hard-to-win", () => {
    const r = calculateCaseStrength(
      checklist,
      "CREDIT_NOT_PROCESSED",
      payloads,
      gatesWith({
        returnedToSender: {
          triggered: true,
          reason: "returned_unrefunded",
          returnedAt: "2026-07-06T09:40:00",
          messageToken: {
            key: "disputes.strengthReason.returnedToSender.returned_unrefunded",
          },
        },
      }),
    );
    expect(r.overall).toBe("weak");
    expect(r.heroVariant).toBe("hard_to_win");
    expect(r.strengthReasonI18n.key).toBe(
      "disputes.strengthReason.returnedToSender.returned_unrefunded",
    );
    // A returned parcel is not "in transit" — leaving that framing on is
    // the same lie in a different place.
    expect(r.deliveryInTransit).toBe(false);
    // And no "add X to strengthen your case" nag: nothing the merchant
    // could add changes a case with no possible proof of delivery.
    expect(r.improvementHintI18n).toBeNull();
  });

  it("coverage still out-ranks it", () => {
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", payloads, {
      ...gatesWith({
        coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
        returnedToSender: {
          triggered: true,
          reason: "returned_unrefunded",
          returnedAt: null,
          messageToken: null,
        },
      }),
    });
    expect(r.heroVariant).toBe("covered");
  });
});
