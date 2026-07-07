import { describe, it, expect } from "vitest";
import { evaluateCompleteness, evaluateCompletenessV2, type OrderContext } from "../completeness";

const FULFILLED_CARD: OrderContext = { isFulfilled: true, hasCardPayment: true, avsCvvAvailable: true };
const UNFULFILLED_CARD: OrderContext = { isFulfilled: false, hasCardPayment: true, avsCvvAvailable: true };
const FULFILLED_NO_CARD: OrderContext = { isFulfilled: true, hasCardPayment: false, avsCvvAvailable: false };
const UNFULFILLED_NO_CARD: OrderContext = { isFulfilled: false, hasCardPayment: false, avsCvvAvailable: false };

describe("evaluateCompleteness", () => {
  it("returns 100% when all collectable fields present for PRODUCT_NOT_RECEIVED (fulfilled)", () => {
    const fields = new Set([
      "order_confirmation",
      "shipping_tracking",
      "delivery_proof",
      "shipping_policy",
      "customer_communication",
      "supporting_documents",
    ]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields, null, FULFILLED_CARD);

    expect(result.score).toBe(100);
    expect(result.blockers).toHaveLength(0);
    expect(result.recommended_actions).toHaveLength(0);
  });

  it("flags blockers for missing required fields (fulfilled order)", () => {
    const fields = new Set(["shipping_policy"]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields, null, FULFILLED_CARD);

    expect(result.blockers).toContain("Order Confirmation");
    expect(result.blockers).toContain("Shipping Tracking");
    expect(result.blockers).toContain("Delivery Proof");
    expect(result.blockers).toHaveLength(3);
  });

  it("does NOT block on shipping_tracking when order is unfulfilled", () => {
    const fields = new Set(["order_confirmation"]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields, null, UNFULFILLED_CARD);

    // shipping_tracking and delivery_proof should be unavailable, not blockers
    expect(result.blockers).toHaveLength(0);
    const unavailable = result.checklist.filter((c) => c.unavailableReason);
    expect(unavailable.length).toBe(2);
    expect(unavailable.map((c) => c.field)).toContain("shipping_tracking");
    expect(unavailable.map((c) => c.field)).toContain("delivery_proof");
  });

  it("marks avs_cvv_match as unavailable when no card payment", () => {
    const fields = new Set(["order_confirmation", "billing_address_match", "shipping_tracking", "delivery_proof"]);
    const result = evaluateCompleteness("FRAUDULENT", fields, null, FULFILLED_NO_CARD);

    // avs_cvv not required (no card), shipping + delivery provided
    expect(result.blockers).toHaveLength(0);
    const avsItem = result.checklist.find((c) => c.field === "avs_cvv_match");
    expect(avsItem?.unavailableReason).toBe("No card payment on this order");
    expect(avsItem?.collectable).toBe(false);
    expect(avsItem?.required).toBe(false);
  });

  // ── Klarna/BNPL safety lock (Task 8) ─────────────────────────────
  // A Klarna order is hasCardPayment=false. Card-only fields
  // (required_if_card_payment) must NEVER become a blocker / "missing"
  // for a Klarna dispute — that would wrongly depress the auto-save gate.
  // Pin this across the two reasons Klarna actually produces.
  const KLARNA_CTX: OrderContext = {
    isFulfilled: true,
    hasCardPayment: false,
    avsCvvAvailable: false,
    paymentFamily: "klarna",
  };

  it("Klarna FRAUDULENT: card-only fields are unavailable, never blockers", () => {
    // Provide only the non-card evidence a Klarna dispute can actually have.
    const fields = new Set([
      "order_confirmation",
      "billing_address_match",
      "shipping_tracking",
      "delivery_proof",
    ]);
    const result = evaluateCompleteness("FRAUDULENT", fields, null, KLARNA_CTX);

    // No card field is ever a blocker.
    expect(result.blockers).not.toContain("AVS / CVV Result");
    const cardField = result.checklist.find((c) => c.field === "avs_cvv_match");
    expect(cardField?.required).toBe(false);
    expect(cardField?.collectable).toBe(false);
    // And it is explicitly "unavailable", not silently missing.
    expect(cardField?.unavailableReason).toBe("No card payment on this order");
  });

  it("Klarna PRODUCT_NOT_RECEIVED: no card field marked missing/blocking", () => {
    const fields = new Set([
      "order_confirmation",
      "shipping_tracking",
      "delivery_proof",
      "shipping_policy",
    ]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields, null, KLARNA_CTX);
    // Any card-conditional field present in this template must be unavailable,
    // never a blocker.
    for (const item of result.checklist) {
      if (item.unavailableReason === "No card payment on this order") {
        expect(item.required).toBe(false);
        expect(result.blockers).not.toContain(item.label);
      }
    }
  });

  it("Klarna CREDIT_NOT_PROCESSED: refund evidence drives completeness, not card fields", () => {
    const fields = new Set([
      "order_confirmation",
      "refund_record",
      "refund_policy",
    ]);
    const result = evaluateCompleteness("CREDIT_NOT_PROCESSED", fields, null, KLARNA_CTX);
    // No card-only field should appear as a blocker.
    const cardBlockers = result.checklist.filter(
      (c) =>
        c.unavailableReason === "No card payment on this order" &&
        result.blockers.includes(c.label),
    );
    expect(cardBlockers).toHaveLength(0);
  });

  it("CREDIT_NOT_PROCESSED uses the refund checklist (not GENERAL fallback)", () => {
    // Regression: CREDIT_NOT_PROCESSED was missing from REASON_TEMPLATES and
    // fell back to GENERAL, so a refund dispute with no refund evidence didn't
    // even list refund_record as a required item. It must now.
    const result = evaluateCompleteness("CREDIT_NOT_PROCESSED", new Set(), null, KLARNA_CTX);
    const fieldsInChecklist = result.checklist.map((c) => c.field);
    expect(fieldsInChecklist).toContain("refund_record");
    // refund_record is required_always → an empty pack blocks on it.
    const refundItem = result.checklist.find((c) => c.field === "refund_record");
    expect(refundItem?.required).toBe(true);
    expect(result.blockers).toContain("Refund Record");
  });

  it("V2: CREDIT_NOT_PROCESSED checklist includes the refund signals (not GENERAL fallback)", () => {
    // Regression (2026-07-07): REASON_TEMPLATES_V2 had no CREDIT_NOT_PROCESSED
    // entry, so the SCORING checklist fell through to GENERAL — which lacks
    // refund_record and no_return_initiated. Those signals were collected but
    // never scored, so a "no refund was owed" case (no_return_initiated
    // present) stayed Weak even with the refund-family rollup rule. The V2
    // template must carry them.
    const present = new Set(["order_confirmation", "no_return_initiated", "refund_policy"]);
    const result = evaluateCompletenessV2("CREDIT_NOT_PROCESSED", present, [], null);
    const fields = result.checklist.map((c) => c.field);
    expect(fields).toContain("no_return_initiated");
    expect(fields).toContain("refund_record");
    // Delivery/shipping rows carry the carrier tracking link + the secondary
    // "goods received, no refund owed" signal. They must be on the checklist
    // (recommended, non-blocking) so the tracking link renders and the
    // delivery signal is scored.
    expect(fields).toContain("shipping_tracking");
    expect(fields).toContain("delivery_proof");
    // The collected no_return_initiated must be available (scoreable), not missing.
    const noReturn = result.checklist.find((c) => c.field === "no_return_initiated");
    expect(noReturn?.status).toBe("available");
  });

  it("V2: klarna refund-inquiry DB template (c02) scores the refund + delivery signals it collects", () => {
    // Regression (2026-07-07, dispute #12121): a Klarna CREDIT_NOT_PROCESSED
    // *inquiry* makes buildPack stamp the klarna_refund_inquiry DB template
    // (c02). When a DB template is stamped, V2 scores ONLY that template's items
    // by collector_key — it does NOT fall through to REASON_TEMPLATES_V2. The
    // template originally listed only refund_record / refund_policy /
    // customer_communication, so the collected `no_return_initiated` and the
    // delivery rows were dropped from the checklist and the case stayed Weak.
    // Migration 20260707120000 adds them. This pins the shape the template now
    // must produce: the collected refund signal is `available` (scoreable) and
    // the delivery rows are present (tracking link renders, also fixes #12809).
    const c02Items = [
      { key: "refund_record", label: "Refund status", required: true, collector_key: "refund_record" },
      { key: "refund_policy", label: "Refund / return policy", required: false, collector_key: "refund_policy" },
      { key: "customer_emails", label: "Customer correspondence", required: false, collector_key: "customer_communication" },
      { key: "no_return_initiated", label: "Return status", required: false, collector_key: "no_return_initiated" },
      { key: "tracking_number", label: "Tracking status", required: false, collector_key: "shipping_tracking" },
      { key: "delivery_proof", label: "Proof of delivery", required: false, collector_key: "delivery_proof" },
    ];
    // What the #12121 pack actually collected.
    const present = new Set(["no_return_initiated", "shipping_tracking", "delivery_proof", "refund_policy"]);
    const result = evaluateCompletenessV2("CREDIT_NOT_PROCESSED", present, [], c02Items);
    const byField = new Map(result.checklist.map((c) => [c.field, c.status]));
    expect(byField.get("no_return_initiated")).toBe("available");
    expect(byField.get("shipping_tracking")).toBe("available");
    expect(byField.get("delivery_proof")).toBe("available");
  });

  it("CREDIT_NOT_PROCESSED lists delivery_proof as a recommended (non-blocking) item", () => {
    // A refund dispute is strengthened by proof the customer received and kept
    // the goods. It must appear on the checklist, but recommended — never a
    // blocker (refund_record stays the required primary evidence).
    const result = evaluateCompleteness("CREDIT_NOT_PROCESSED", new Set(), null, KLARNA_CTX);
    const delivery = result.checklist.find((c) => c.field === "delivery_proof");
    expect(delivery).toBeDefined();
    expect(delivery?.required).toBe(false);
    expect(result.blockers).not.toContain(delivery?.label);
  });

  it("requires avs_cvv_match when card payment exists", () => {
    const fields = new Set(["order_confirmation", "billing_address_match"]);
    const result = evaluateCompleteness("FRAUDULENT", fields, null, FULFILLED_CARD);

    const avsItem = result.checklist.find((c) => c.field === "avs_cvv_match");
    expect(avsItem?.required).toBe(true);
    expect(avsItem?.collectable).toBe(true);
    expect(avsItem?.unavailableReason).toBeUndefined();
    expect(result.blockers).toContain("AVS / CVV Result");
  });

  it("uses GENERAL template for unknown reasons", () => {
    const result = evaluateCompleteness("SOME_UNKNOWN_REASON", new Set(), null, FULFILLED_CARD);

    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
    expect(result.blockers).toContain("Order Confirmation");
  });

  it("uses GENERAL template for null reason", () => {
    const result = evaluateCompleteness(null, new Set(["order_confirmation"]), null, FULFILLED_CARD);

    expect(result.score).toBeGreaterThan(0);
    expect(result.blockers).toHaveLength(0);
  });

  it("handles FRAUDULENT reason with all evidence (fulfilled + card)", () => {
    const fields = new Set([
      "order_confirmation",
      "billing_address_match",
      "avs_cvv_match",
      "activity_log",
      "shipping_tracking",
      "delivery_proof",
      "customer_communication",
      "supporting_documents",
    ]);
    const result = evaluateCompleteness("FRAUDULENT", fields, null, FULFILLED_CARD);

    expect(result.blockers).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it("returns 0% for empty fields", () => {
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", new Set(), null, FULFILLED_CARD);

    expect(result.score).toBe(0);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("pack always gets a valid result even with no context", () => {
    // Default context assumes nothing conditionally available (conservative)
    const result = evaluateCompleteness("FRAUDULENT", new Set(["order_confirmation", "billing_address_match"]));

    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
    // Conditional fields should NOT be blockers with conservative default
    expect(result.blockers).not.toContain("AVS / CVV Result");
    expect(result.blockers).not.toContain("Shipping Tracking");
  });

  it("evidenceStrengthScore reflects collectable items only", () => {
    const fields = new Set(["order_confirmation"]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields, null, UNFULFILLED_CARD);

    // Only collectable items count for strength
    const collectable = result.checklist.filter((c) => c.collectable);
    const present = collectable.filter((c) => c.present);
    const expected = Math.round((present.length / collectable.length) * 100);
    expect(result.evidenceStrengthScore).toBe(expected);
  });

  it("unfulfilled + no card: FRAUDULENT dispute still produces usable result", () => {
    const fields = new Set(["order_confirmation", "billing_address_match"]);
    const result = evaluateCompleteness("FRAUDULENT", fields, null, UNFULFILLED_NO_CARD);

    // Both conditional fields unavailable, no blockers
    expect(result.blockers).toHaveLength(0);
    const unavailable = result.checklist.filter((c) => c.unavailableReason);
    expect(unavailable.length).toBeGreaterThanOrEqual(2); // avs + shipping at minimum
  });
});
