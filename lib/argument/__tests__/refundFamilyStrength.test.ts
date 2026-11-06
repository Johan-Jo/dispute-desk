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
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";

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
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.strongCount).toBe(0);
    expect(r.moderateCount).toBe(1); // the refund signal
    expect(r.overall).toBe("moderate");
  });

  it("moderate-only reason NAMES the contributing signal — not the canned family line", () => {
    // Regression (dispute #891BECCC, 2026-07-15): moderate reached on
    // moderate-category signals alone rendered the vague
    // "Some refund evidence exists, but complete documentation would help."
    // (disputes.strengthReason.refund.moderate) — the merchant had no way
    // to know WHICH evidence. The composer must take the parameterized
    // moderateOnly branch and splice in the actual signal label.
    const checklist = [available("order_confirmation"), available("no_return_initiated"), available("refund_policy")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      no_return_initiated: { returnStatus: "NO_RETURN" },
      refund_policy: {},
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.strengthReasonI18n.key).toBe(
      "disputes.strengthReason.moderate.moderateOnly",
    );
    // label1 must reference a signal-label i18n key (the actual evidence name).
    const label1 = r.strengthReasonI18n.params?.label1 as { type: string; key: string };
    expect(label1?.type).toBe("i18n-key");
    expect(label1?.key).toBeTruthy();
  });

  it("a processed refund_record alone → MODERATE", () => {
    const checklist = [available("refund_record")];
    const source = byField({
      refund_record: { refundStatus: "processed", refundedAmount: 549 },
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.overall).toBe("moderate");
  });

  it("only supporting policy evidence (no refund signal) stays weak", () => {
    const checklist = [available("refund_policy"), available("shipping_policy")];
    const source = byField({ refund_policy: {}, shipping_policy: {} });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.overall).toBe("weak");
  });

  it("the refund rule does NOT apply to non-refund families", () => {
    // A delivery dispute must not get lifted by a refund-signal path.
    const checklist = [available("no_return_initiated")];
    const source = byField({ no_return_initiated: { returnStatus: "NO_RETURN" } });
    const r = calculateCaseStrength(checklist, "PRODUCT_NOT_RECEIVED", source, NO_GATES);
    // delivery family: no strong delivery, one moderate refund signal →
    // strict formula → weak (refund rule is refund-family only).
    expect(r.overall).toBe("weak");
  });
});

describe("improvement hint never contradicts a collected signal (cay cc86296d, 2026-07-16)", () => {
  it("does NOT recommend a refund-signal sibling when the refund signal is already Strong", () => {
    // Live bug: the hero said "Add Refund record to strengthen your case"
    // while "Refund status · Strong" sat in the list below it. Scoring
    // keeps the best row per signal, so the suggestion could never move
    // the score either.
    const checklist = [
      available("order_confirmation"),
      available("refund_record"),
      { field: "no_return_initiated", status: "missing", collectionType: "manual" } as unknown as ChecklistItemV2,
    ];
    const source = byField({
      order_confirmation: { orderId: "1" },
      refund_record: { refundStatus: "processed", amount: "249.00", currency: "SEK" },
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.improvementHintI18n).toBeNull();
  });

  it("still recommends a missing field of an UNCOVERED signal", () => {
    /* Was `delivery_proof` until 2026-08-12. That field is in
     * `SYSTEM_DERIVED_FIELDS` — delivery confirmation comes from the CARRIER,
     * not the merchant — so the fixture was asserting that we suggest
     * something the merchant cannot supply, the same wrong premise that put
     * "Add Pre-authorization fraud screening" in front of a live merchant
     * (dispute 9a40da90). The `collectionType: "manual"` on the fixture row
     * did not make it true; it just defeated the old permissive filter.
     *
     * `no_return_initiated` preserves what this case exists to prove — a
     * missing field of an UNCOVERED signal is still recommended — using a
     * field that is BOTH merchant-suppliable and strength-affecting. Only two
     * fields in the registry are both (`refund_record` and
     * `no_return_initiated`, each `moderate`); everything else in
     * `FIELD_ACTIONS` is weight-0 `supporting` and is correctly skipped by
     * `affectsStrength`, so a fixture picking one would assert a hint that
     * can never fire.
     *
     * `refund_record` is therefore dropped from the AVAILABLE rows: it shares
     * `signalId: "refund"` with `no_return_initiated`, and a covered signal
     * correctly suppresses its sibling — which is the rule the sibling test
     * above pins. Leaving it in would make this case assert the opposite of
     * its neighbour. */
    const checklist = [
      available("order_confirmation"),
      { field: "no_return_initiated", status: "missing", collectionType: "manual" } as unknown as ChecklistItemV2,
    ];
    const source = byField({
      order_confirmation: { orderId: "1" },
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    expect(r.improvementHintI18n).not.toBeNull();
    const label = r.improvementHintI18n?.params?.label as { key?: string };
    // The hint names the SIGNAL, not the field — `no_return_initiated` carries
    // `signalId: "refund"`, so the label resolves to the refund signal.
    expect(JSON.stringify(label)).toContain("refund");
  });
});

describe("strength reason names the refund FACT, not the ambiguous 'Refund record' (dispute 328a45e4, 2026-07-16)", () => {
  it("no_return_initiated contributor → 'proof that no refund was owed'", () => {
    const checklist = [available("order_confirmation"), available("no_return_initiated"), available("refund_policy")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      no_return_initiated: { returnStatus: "NO_RETURN" },
      refund_policy: {},
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    const label1 = r.strengthReasonI18n.params?.label1 as { key: string };
    expect(label1.key).toBe("disputes.signalLabelValue.noRefundOwed");
  });

  it("refund_record contributor → 'proof that the refund was already issued'", () => {
    const checklist = [available("order_confirmation"), available("refund_record")];
    const source = byField({
      order_confirmation: { orderId: "1" },
      refund_record: { refundStatus: "processed", amount: "249.00", currency: "SEK" },
    });
    const r = calculateCaseStrength(checklist, "CREDIT_NOT_PROCESSED", source, NO_GATES);
    const params = r.strengthReasonI18n.params ?? {};
    const labels = JSON.stringify(params);
    expect(labels).toContain("disputes.signalLabelValue.refundIssued");
    expect(labels).not.toContain("signalLabel.refund_record");
  });
});
