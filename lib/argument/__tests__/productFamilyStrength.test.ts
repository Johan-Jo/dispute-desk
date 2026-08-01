/**
 * "Not as described / defective" (product family — Visa 13.3 · MC 4853)
 * two-axis scoring rule (docs/plans/product-not-as-described-scoring.plan.md).
 *
 *   Axis 1 — "it matched what they bought": customer_communication
 *     (customerConfirmsOrder) or supporting_documents (signedContract) strong.
 *   Axis 2 — "the dispute isn't valid / is moot": no_return_initiated
 *     (customer never returned — a precondition to filing 13.3 post-2024) or
 *     refund_record (already refunded). Shared signalId `refund`.
 *
 *   Strong   = one Axis-1 signal AND one Axis-2 signal (both halves answered).
 *   Moderate = one decisive signal from EITHER axis.
 *   Weak     = no decisive signal (bare listing + order record are supportingOnly).
 *   Two from the SAME axis → stays Moderate.
 */
import { describe, it, expect } from "vitest";
import { calculateCaseStrength, computeContributions } from "@/lib/argument/caseStrength";
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

const REASON = "PRODUCT_UNACCEPTABLE";

describe("product-family two-axis rollup (PRODUCT_UNACCEPTABLE / 13.3)", () => {
  it("bare listing + order record only → WEAK (supportingOnly, not inflated)", () => {
    const checklist = [available("order_confirmation"), available("product_description")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      product_description: { text: "as advertised" },
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.strongCount).toBe(0);
    expect(r.overall).toBe("weak");
  });

  it("Axis-2 alone (no_return_initiated) → MODERATE", () => {
    const checklist = [available("order_confirmation"), available("no_return_initiated")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      no_return_initiated: { returnStatus: "NO_RETURN" },
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("moderate");
  });

  it("Axis-1 alone (customer confirms order) → MODERATE", () => {
    const checklist = [available("order_confirmation"), available("customer_communication")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      customer_communication: { customerConfirmsOrder: true },
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("moderate");
  });

  it("Axis-1 AND Axis-2 → STRONG (both halves answered)", () => {
    const checklist = [
      available("customer_communication"),
      available("no_return_initiated"),
    ];
    const source = byField({
      customer_communication: { customerConfirmsOrder: true }, // Axis 1
      no_return_initiated: { returnStatus: "NO_RETURN" }, // Axis 2
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("strong");
  });

  it("signed spec (Axis 1) + refund already issued (Axis 2) → STRONG", () => {
    const checklist = [
      available("supporting_documents"),
      available("refund_record"),
    ];
    const source = byField({
      supporting_documents: { signedContract: true }, // Axis 1
      refund_record: { refundStatus: "processed", amount: 80 }, // Axis 2
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("strong");
  });

  it("TWO Axis-2 signals (no_return + refund, same signalId) → still MODERATE", () => {
    // Both are signalId `refund` — one axis proven twice, the "it matched"
    // half unanswered. Must NOT reach strong.
    const checklist = [
      available("no_return_initiated"),
      available("refund_record"),
    ];
    const source = byField({
      no_return_initiated: { returnStatus: "NO_RETURN" },
      refund_record: { refundStatus: "processed", amount: 80 },
    });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("moderate");
  });

  it("posted refund policy alone does NOT elevate (no bearing on 13.3)", () => {
    const checklist = [available("order_confirmation"), available("refund_policy")];
    const source = byField({ order_confirmation: { orderId: "1" }, refund_policy: {} });
    const r = calculateCaseStrength(checklist, REASON, source, NO_GATES);
    expect(r.overall).toBe("weak");
  });

  it("the product rule does NOT apply to other families", () => {
    // Same evidence on a fraud dispute must not be lifted by the product axes.
    const checklist = [
      available("customer_communication"),
      available("no_return_initiated"),
    ];
    const source = byField({
      customer_communication: { customerConfirmsOrder: true },
      no_return_initiated: { returnStatus: "NO_RETURN" },
    });
    const r = calculateCaseStrength(checklist, "FRAUDULENT", source, NO_GATES);
    expect(r.overall).not.toBe("strong");
  });
});

/* ── Fraud-family account_history demotion (CE3.0 false-proxy fix) ── */

describe("fraud family: prior-order history corroborates, never decides", () => {
  const priorHistory = { totalOrders: 3, disputeFreeHistory: true }; // 2 priors
  const avsStrong = { avsResultCode: "Y", cvvResultCode: "M" };

  it("account_history alone does NOT make a fraud case strong", () => {
    const checklist = [available("customer_account_info"), available("avs_cvv_match")];
    const source = byField({
      customer_account_info: priorHistory,
      avs_cvv_match: avsStrong, // payment_auth strong
    });
    const r = calculateCaseStrength(checklist, "FRAUDULENT", source, NO_GATES);
    // Pre-fix this was 2 decisive fraud signals -> strong. account_history
    // is now moderate corroboration, so AVS-strong-alone -> moderate.
    expect(r.overall).toBe("moderate");
  });

  it("the demoted row is reported as moderate, not strong (UI must agree)", () => {
    const checklist = [available("customer_account_info")];
    const source = byField({ customer_account_info: priorHistory });
    const r = calculateCaseStrength(checklist, "FRAUDULENT", source, NO_GATES);
    expect(r.strongCount).toBe(0);
    expect(r.moderateCount).toBe(1);
  });

  it("non-fraud families keep prior history as STRONG", () => {
    const checklist = [available("customer_account_info")];
    const source = byField({ customer_account_info: priorHistory });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    expect(r.strongCount).toBe(1);
  });

  it("computeContributions applies the same demotion when given the reason", () => {
    const checklist = [available("customer_account_info")];
    const source = byField({ customer_account_info: priorHistory });
    const fraud = computeContributions({
      checklist,
      payloadSource: source,
      reason: "FRAUDULENT",
    });
    expect(fraud.strong).toHaveLength(0);
    expect(fraud.moderate).toHaveLength(1);
    // Non-fraud keeps it strong.
    const other = computeContributions({
      checklist,
      payloadSource: source,
      reason: "PRODUCT_NOT_RECEIVED",
    });
    expect(other.strong).toHaveLength(1);
  });
});
