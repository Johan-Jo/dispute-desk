import { describe, it, expect } from "vitest";
import { classifyBillingAddressMismatch } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import type { EvidenceItemWithStrength } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";

function orderRow(
  payload: Record<string, unknown> | null,
): EvidenceItemWithStrength {
  return {
    field: "order_confirmation",
    label: "Order Confirmation",
    status: "available",
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
    strength: "moderate",
    impact: "critical",
    content: null,
    payload,
  };
}

function billingRow(
  status: EvidenceItemWithStrength["status"],
): EvidenceItemWithStrength {
  return {
    field: "billing_address_match",
    label: "Billing Address Match",
    status,
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
    strength: status === "available" ? "moderate" : "none",
    impact: "critical",
    content: null,
    payload: null,
  };
}

describe("classifyBillingAddressMismatch", () => {
  it("returns null when billing_address_match is available", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("available"),
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ]);
    expect(result).toBeNull();
  });

  it("emits a country-mismatch signal when countries differ", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("missing"),
      orderRow({
        billingAddress: { city: "Berlin", countryCode: "DE" },
        shippingAddress: { city: "Berlin", countryCode: "US" },
      }),
    ]);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("internal:billing_address_mismatch");
    expect(result?.explanation).toContain("DE");
    expect(result?.explanation).toContain("US");
    expect(result?.explanation).toContain("not surfaced to the bank");
  });

  it("emits a city-mismatch signal when cities differ but countries match", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("missing"),
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ]);
    expect(result).not.toBeNull();
    expect(result?.title).toMatch(/do not match/i);
  });

  it("returns null when country codes are missing (insufficient data)", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("missing"),
      orderRow({
        billingAddress: { city: "NYC", countryCode: null },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when either address is absent (no negative signal from absence)", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("missing"),
      orderRow({ billingAddress: null, shippingAddress: null }),
    ]);
    expect(result).toBeNull();
  });

  it("returns null when the order payload itself is unavailable", () => {
    const result = classifyBillingAddressMismatch([
      billingRow("missing"),
      orderRow(null),
    ]);
    expect(result).toBeNull();
  });
});
