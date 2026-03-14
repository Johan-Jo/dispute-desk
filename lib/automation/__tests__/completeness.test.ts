import { describe, it, expect } from "vitest";
import { evaluateCompleteness } from "../completeness";

describe("evaluateCompleteness", () => {
  it("returns 100% when all fields present for PRODUCT_NOT_RECEIVED", () => {
    const fields = new Set([
      "order_confirmation",
      "shipping_tracking",
      "delivery_proof",
      "shipping_policy",
      "customer_communication",
      "supporting_documents",
    ]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields);

    expect(result.score).toBe(100);
    expect(result.blockers).toHaveLength(0);
    expect(result.recommended_actions).toHaveLength(0);
    expect(result.checklist.every((c) => c.present)).toBe(true);
  });

  it("flags blockers for missing required fields", () => {
    const fields = new Set(["shipping_policy"]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields);

    expect(result.score).toBe(17); // 1 of 6
    expect(result.blockers).toContain("Order Confirmation");
    expect(result.blockers).toContain("Shipping Tracking");
    expect(result.blockers).toContain("Delivery Proof");
    expect(result.blockers).toHaveLength(3);
  });

  it("returns recommended_actions for missing optional fields", () => {
    const fields = new Set([
      "order_confirmation",
      "shipping_tracking",
      "delivery_proof",
    ]);
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", fields);

    expect(result.score).toBe(50); // 3 of 6
    expect(result.blockers).toHaveLength(0);
    expect(result.recommended_actions).toContain("Add Shipping Policy");
    expect(result.recommended_actions).toContain("Add Customer Communication");
  });

  it("uses GENERAL template for unknown reasons", () => {
    const result = evaluateCompleteness("SOME_UNKNOWN_REASON", new Set());

    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
    expect(result.blockers).toContain("Order Confirmation");
  });

  it("uses GENERAL template for null reason", () => {
    const result = evaluateCompleteness(null, new Set(["order_confirmation"]));

    expect(result.score).toBeGreaterThan(0);
    expect(result.blockers).toHaveLength(0);
  });

  it("handles FRAUDULENT reason correctly", () => {
    const fields = new Set([
      "order_confirmation",
      "billing_address_match",
    ]);
    const result = evaluateCompleteness("FRAUDULENT", fields);

    expect(result.blockers).toHaveLength(0);
    expect(result.score).toBe(33); // 2 of 6
    expect(result.recommended_actions.length).toBeGreaterThan(0);
  });

  it("returns 0% for empty fields", () => {
    const result = evaluateCompleteness("PRODUCT_NOT_RECEIVED", new Set());

    expect(result.score).toBe(0);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
