/**
 * The shipped-but-in-transit strength reason.
 *
 * When a delivery-signal payload carries a tracking number but the carrier
 * has NOT yet confirmed delivery (`proofType: "delivered_unverified"`), the
 * case is weak (no decisive delivery), but the reason should say so
 * specifically — "parcel is with the carrier, awaiting confirmation" —
 * rather than the generic "no delivery evidence". This keeps the strength
 * engine (admin source of truth) and the merchant UI consistent.
 */

import { describe, it, expect } from "vitest";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";

function byField(
  map: Record<string, Record<string, unknown>>,
): EvidencePayloadSource {
  const obj: Record<string, { payload: Record<string, unknown> }> = {};
  for (const [k, v] of Object.entries(map)) obj[k] = { payload: v };
  return { kind: "byField", map: obj };
}

const available = (field: string): ChecklistItemV2 =>
  ({ field, status: "available" }) as unknown as ChecklistItemV2;

describe("delivery in-transit strength reason", () => {
  it("flags deliveryInTransit + uses the specific reason when tracking exists but delivery is unconfirmed", () => {
    const checklist = [
      available("order_confirmation"),
      available("shipping_tracking"),
      available("delivery_proof"),
    ];
    const source = byField({
      order_confirmation: { orderId: "1" },
      shipping_tracking: {
        proofType: "delivered_unverified",
        fulfillments: [
          {
            tracking: [
              {
                carrier: "PostNord SE",
                number: "00573132901672098616",
                url: "https://tracking.postnord.com/se/?id=00573132901672098616",
              },
            ],
          },
        ],
      },
      delivery_proof: { proofType: "delivered_unverified" },
    });

    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.overall).toBe("weak");
    expect(r.deliveryInTransit).toBe(true);
    expect(r.strengthReasonI18n.key).toBe(
      "disputes.strengthReason.weak.deliveryInTransit",
    );
  });

  it("does NOT flag in-transit when there is no tracking number/url", () => {
    const checklist = [available("delivery_proof")];
    const source = byField({
      // delivered_unverified but no tracking artifact — just a bare label
      delivery_proof: { proofType: "delivered_unverified" },
    });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.deliveryInTransit).toBeFalsy();
    expect(r.strengthReasonI18n.key).toBe(
      "disputes.strengthReason.weak.supportingOnly",
    );
  });

  it("does NOT flag in-transit once the carrier confirms delivery", () => {
    const checklist = [available("delivery_proof")];
    const source = byField({
      delivery_proof: {
        proofType: "delivered_confirmed",
        deliveredToVerifiedAddress: true,
        fulfillments: [
          { tracking: [{ carrier: "X", number: "N", url: "https://c/N" }] },
        ],
      },
    });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.deliveryInTransit).toBeFalsy();
  });
});
