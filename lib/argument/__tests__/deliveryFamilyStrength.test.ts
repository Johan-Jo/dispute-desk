/**
 * Item-not-received (delivery family) rollup rule.
 *
 * For PRODUCT_NOT_RECEIVED, a single STRONG delivery signal (carrier
 * confirmed delivery to the verified customer address) reaches MODERATE
 * overall on its own — it directly refutes "I never received it". Under the
 * strict count formula 1 strong + 0 moderate would be Weak; the delivery
 * family overrides that. Two strong signals still reach Strong.
 */
import { describe, it, expect } from "vitest";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";

function byField(map: Record<string, Record<string, unknown>>): EvidencePayloadSource {
  const obj: Record<string, { payload: Record<string, unknown> }> = {};
  for (const [k, v] of Object.entries(map)) obj[k] = { payload: v };
  return { kind: "byField", map: obj };
}
const available = (field: string): ChecklistItemV2 =>
  ({ field, status: "available" }) as unknown as ChecklistItemV2;

describe("delivery-family rollup (INR)", () => {
  // PR-C1: a STRONG delivery signal now comes only from a genuine signature /
  // POD (`signature_confirmed`). The family rollup rule under test is
  // unchanged; only the way the strong signal is produced is.
  it("a signed delivery alone → MODERATE (was weak)", () => {
    const checklist = [available("order_confirmation"), available("shipping_tracking"), available("delivery_proof")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      shipping_tracking: { proofType: "signature_confirmed" },
      delivery_proof: { proofType: "signature_confirmed" },
    });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.strongCount).toBe(1); // delivery signal, deduped
    expect(r.moderateCount).toBe(0);
    expect(r.overall).toBe("moderate");
    // Copy: strong-signal-drives-moderate, not the weak "partial support".
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.moderate.strongOnly");
  });

  it("delivered_confirmed alone → MODERATE (non-receipt plan §6.1.3; was weak)", () => {
    const checklist = [available("delivery_proof")];
    const source = byField({
      // Carrier-confirmed delivery is moderate. The retired keys are present
      // here on purpose: a historical pack must not lift this to strong.
      delivery_proof: {
        proofType: "delivered_confirmed",
        deliveredToVerifiedAddress: true,
        collectedByCustomer: true,
      },
    });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.strongCount).toBe(0);
    expect(r.moderateCount).toBe(1);
    expect(r.overall).toBe("moderate");
    // The pre-revision rollup rated it weak; the ladder reads the pair.
    expect(r.overallBeforeRev5).toBe("weak");
  });

  it("blume-box #352543 shape: carrier-confirmed, dated, complete coverage → MODERATE", () => {
    const r = calculateCaseStrength(
      [available("shipping_tracking"), available("delivery_proof")],
      "PRODUCT_NOT_RECEIVED",
      byField({
        shipping_tracking: { proofType: "delivered_confirmed", deliveredAt: "2026-07-06T19:53:02Z", deliveryCoverage: "complete" },
        delivery_proof: { proofType: "delivered_confirmed", deliveredAt: "2026-07-06T19:53:02Z", deliveryCoverage: "complete" },
      }),
      NO_GATES,
    );
    expect(r.overall).toBe("moderate");
  });

  it("signature covering ALL the disputed goods → STRONG, flagged as newly strong", () => {
    const r = calculateCaseStrength(
      [available("delivery_proof")],
      "PRODUCT_NOT_RECEIVED",
      byField({ delivery_proof: { proofType: "signature_confirmed", deliveryCoverage: "complete" } }),
      NO_GATES,
    );
    expect(r.overall).toBe("strong");
    expect(r.overallBeforeRev5).toBe("moderate");
  });

  it.each(["partial", "unknown", "none"])(
    "signature on %s coverage → MODERATE at most",
    (deliveryCoverage) => {
      const r = calculateCaseStrength(
        [available("delivery_proof")],
        "PRODUCT_NOT_RECEIVED",
        byField({ delivery_proof: { proofType: "signature_confirmed", deliveryCoverage } }),
        NO_GATES,
      );
      expect(r.overall).toBe("moderate");
    },
  );

  it("available for collection / in transit / label only stay weak", () => {
    for (const proofType of ["delivered_unverified", "in_transit", "label_created"]) {
      const r = calculateCaseStrength(
        [available("delivery_proof")],
        "PRODUCT_NOT_RECEIVED",
        byField({ delivery_proof: { proofType, deliveryCoverage: "complete" } }),
        NO_GATES,
      );
      expect(r.overall, proofType).toBe("weak");
    }
  });

  it("fatal-loss caps both ratings", () => {
    const r = calculateCaseStrength(
      [available("delivery_proof")],
      "PRODUCT_NOT_RECEIVED",
      byField({ delivery_proof: { proofType: "signature_confirmed", deliveryCoverage: "complete" } }),
      { ...NO_GATES, fatalLoss: { triggered: true, reason: "refund_issued", messageToken: null } },
    );
    expect(r.overall).toBe("weak");
    expect(r.overallBeforeRev5).toBe("weak");
  });

  it("other families carry no overallBeforeRev5", () => {
    const r = calculateCaseStrength(
      [available("delivery_proof")],
      "FRAUDULENT",
      byField({ delivery_proof: { proofType: "delivered_confirmed" } }),
      NO_GATES,
    );
    expect(r.overallBeforeRev5).toBeUndefined();
  });

  it("in-transit (delivered_unverified) stays weak", () => {
    const checklist = [available("delivery_proof")];
    const source = byField({ delivery_proof: { proofType: "delivered_unverified" } });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.overall).toBe("weak");
  });

  it("two strong signals still reach STRONG", () => {
    const checklist = [available("delivery_proof"), available("customer_communication")];
    const source = byField({
      delivery_proof: { proofType: "signature_confirmed" }, // strong via signature
      customer_communication: { customerConfirmsOrder: true }, // strong
    });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.strongCount).toBe(2);
    expect(r.overall).toBe("strong");
  });

  it("the single-strong-delivery rule does NOT apply to non-delivery families", () => {
    // A fraud dispute with one strong non-payment signal must not get the
    // delivery-family Moderate boost.
    const checklist = [available("customer_communication")];
    const source = byField({ customer_communication: { customerConfirmsOrder: true } });
    const r = calculateCaseStrength(checklist, "FRAUDULENT", source, NO_GATES);
    // fraud family has its own rules; communication-strong alone is not AVS
    // → not elevated to moderate by the delivery rule.
    expect(r.overall).not.toBe("moderate");
  });
});
