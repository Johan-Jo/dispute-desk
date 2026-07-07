/**
 * Credit-not-processed (refund family) rollup rule.
 *
 * For CREDIT_NOT_PROCESSED, a single `refund`-signal (no_return_initiated
 * when the customer never returned and no refund was issued, OR
 * refund_record when a refund WAS processed) reaches MODERATE overall on
 * its own — it directly answers "you owed me a refund and didn't issue it"
 * (either the refund exists, or none was owed under a return-conditional
 * policy). Under the strict count formula 1 moderate + 0 strong would be
 * Weak; the refund family overrides that. Two strong signals still reach
 * Strong.
 */
import { describe, it, expect } from "vitest";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

function byField(map: Record<string, Record<string, unknown>>): EvidencePayloadSource {
  const obj: Record<string, { payload: Record<string, unknown> }> = {};
  for (const [k, v] of Object.entries(map)) obj[k] = { payload: v };
  return { kind: "byField", map: obj };
}
const available = (field: string): ChecklistItemV2 =>
  ({ field, status: "available" }) as unknown as ChecklistItemV2;

describe("refund-family rollup (CREDIT_NOT_PROCESSED)", () => {
  it("no_return_initiated alone → MODERATE (was weak)", () => {
    const checklist = [available("order_confirmation"), available("no_return_initiated"), available("refund_policy")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      no_return_initiated: { returnStatus: "NO_RETURN" },
      refund_policy: {}, // published only → supporting
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source);
    expect(r.strongCount).toBe(0);
    expect(r.moderateCount).toBe(1); // the refund signal
    expect(r.overall).toBe("moderate");
  });

  it("a processed refund_record alone → MODERATE", () => {
    const checklist = [available("refund_record")];
    const source = byField({
      refund_record: { refundStatus: "processed", refundedAmount: 549 },
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source);
    expect(r.overall).toBe("moderate");
  });

  it("only supporting policy evidence (no refund signal) stays weak", () => {
    const checklist = [available("refund_policy"), available("shipping_policy")];
    const source = byField({ refund_policy: {}, shipping_policy: {} });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source);
    expect(r.overall).toBe("weak");
  });

  it("the refund rule does NOT apply to non-refund families", () => {
    // A delivery dispute must not get lifted by a refund-signal path.
    const checklist = [available("no_return_initiated")];
    const source = byField({ no_return_initiated: { returnStatus: "NO_RETURN" } });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source);
    // delivery family: no strong delivery, one moderate refund signal →
    // strict formula → weak (refund rule is refund-family only).
    expect(r.overall).toBe("weak");
  });
});
