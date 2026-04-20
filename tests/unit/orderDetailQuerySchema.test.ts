import { describe, it, expect } from "vitest";
import { ORDER_DETAIL_QUERY } from "@/lib/shopify/queries/orders";

describe("ORDER_DETAIL_QUERY schema guard", () => {
  it("does not reference the invalid Order.riskAssessments field (Admin API 2026-01)", () => {
    expect(ORDER_DETAIL_QUERY).not.toContain("riskAssessments");
  });

  it("still fetches transactions and paymentDetails (critical sibling fields)", () => {
    expect(ORDER_DETAIL_QUERY).toContain("transactions");
    expect(ORDER_DETAIL_QUERY).toContain("paymentDetails");
  });
});
