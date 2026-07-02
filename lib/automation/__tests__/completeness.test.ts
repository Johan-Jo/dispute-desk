import { describe, it, expect } from "vitest";
import { evaluateCompleteness, type OrderContext } from "../completeness";

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
