import { describe, it, expect } from "vitest";
import { classifyBillingShippingAgreement } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import type { EvidenceItemWithStrength } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";

/**
 * The billing-vs-shipping comparison, in both directions, as an internal-only
 * OPERATIONAL note.
 *
 * This file was `classifyBillingAddressMismatch.test.ts` until 2026-08-09
 * (PR-C4 / C-14). The agreement half used to be the retired evidence field
 * `billing_address_match`, and the classifier consulted that checklist row to
 * decide whether to stay quiet. It no longer does — a historical pack still
 * carries the row, and letting a retired field decide what the merchant reads
 * is exactly the authority the retirement removes.
 */

/** Fake translator that returns the key + serialized params so tests
 *  can assert on the structural shape without depending on locale
 *  content. Mirrors the production translator's call signature. */
function fakeT(key: string, params?: Record<string, string | number>): string {
  if (key === "internalSignals.billingAddress.title") return "Billing and shipping addresses do not match";
  if (key === "internalSignals.billingAddress.countryDetail") {
    return `Billing country ${params?.billingCountry} differs from shipping country ${params?.shippingCountry}.`;
  }
  if (key === "internalSignals.billingAddress.cityDetail") return "Billing city differs from shipping city.";
  if (key === "internalSignals.billingAddress.explanation") {
    return `${params?.detail} Used internally for assessment; not surfaced to the bank to avoid weakening the response.`;
  }
  if (key === "internalSignals.billingShippingAgree.title") {
    return "Billing and shipping addresses on the order agree";
  }
  if (key === "internalSignals.billingShippingAgree.explanation") {
    return "This is an internal note about your own order record, not evidence.";
  }
  return key;
}

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

/** A row exactly as a pre-retirement pack persisted it. Present only to prove
 *  the classifier ignores it. */
function retiredBillingRow(
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

describe("classifyBillingShippingAgreement", () => {
  it("emits the operational agreement note when city + country agree", () => {
    const result = classifyBillingShippingAgreement([
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "NYC", countryCode: "US" },
      }),
    ], fakeT);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("internal:billing_shipping_agree");
    expect(result?.title).toBe("Billing and shipping addresses on the order agree");
    // The note names the merchant's own order record, never an AVS result,
    // a cardholder, or a "match" that an issuer confirmed.
    expect(result?.title).not.toMatch(/cardholder|AVS|verified/i);
  });

  it("emits the agreement note even when a HISTORICAL retired row says available", () => {
    // Pre-retirement packs persisted `billing_address_match` rows. The
    // classifier used to return null on `available` — i.e. the retired field
    // decided what the merchant saw. It must not.
    const result = classifyBillingShippingAgreement([
      retiredBillingRow("available"),
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "NYC", countryCode: "US" },
      }),
    ], fakeT);
    expect(result?.id).toBe("internal:billing_shipping_agree");
  });

  it("emits the mismatch note even when a HISTORICAL retired row says available", () => {
    const result = classifyBillingShippingAgreement([
      retiredBillingRow("available"),
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ], fakeT);
    expect(result?.id).toBe("internal:billing_address_mismatch");
  });

  it("emits a country-mismatch signal when countries differ", () => {
    const result = classifyBillingShippingAgreement([
      orderRow({
        billingAddress: { city: "Berlin", countryCode: "DE" },
        shippingAddress: { city: "Berlin", countryCode: "US" },
      }),
    ], fakeT);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("internal:billing_address_mismatch");
    expect(result?.explanation).toContain("DE");
    expect(result?.explanation).toContain("US");
    expect(result?.explanation).toContain("not surfaced to the bank");
  });

  it("emits a city-mismatch signal when cities differ but countries match", () => {
    const result = classifyBillingShippingAgreement([
      orderRow({
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ], fakeT);
    expect(result).not.toBeNull();
    expect(result?.title).toMatch(/do not match/i);
  });

  it("returns null when country codes are missing (insufficient data)", () => {
    const result = classifyBillingShippingAgreement([
      orderRow({
        billingAddress: { city: "NYC", countryCode: null },
        shippingAddress: { city: "LA", countryCode: "US" },
      }),
    ], fakeT);
    expect(result).toBeNull();
  });

  it("returns null when either address is absent (no note from absence, either way)", () => {
    const result = classifyBillingShippingAgreement([
      orderRow({ billingAddress: null, shippingAddress: null }),
    ], fakeT);
    expect(result).toBeNull();
  });

  it("returns null when the order payload itself is unavailable", () => {
    const result = classifyBillingShippingAgreement([orderRow(null)], fakeT);
    expect(result).toBeNull();
  });
});
