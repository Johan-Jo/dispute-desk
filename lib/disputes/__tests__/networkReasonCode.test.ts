/**
 * Tests for the network reason-code resolver.
 *
 * Verifies the confidence chain: direct (architecture only — unreachable
 * today) → derived (receiptJson) → inferred (enum + network) → unknown.
 */

import { describe, it, expect } from "vitest";
import { resolveNetworkReasonCode } from "@/lib/disputes/networkReasonCode";

describe("resolveNetworkReasonCode — inferred path", () => {
  it("Visa + FRAUDULENT → 10.4 (CE 3.0 anchor) with inferred confidence", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "visa",
    });
    expect(result.code).toBe("10.4");
    expect(result.network).toBe("visa");
    expect(result.confidence).toBe("inferred");
    expect(result.source).toBe("enum_inference");
    expect(result.entry?.family).toBe("ce30_eligible");
  });

  it("Mastercard + FRAUDULENT → 4837 (FPT-eligible)", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "mastercard",
    });
    expect(result.code).toBe("4837");
    expect(result.confidence).toBe("inferred");
    expect(result.entry?.family).toBe("fpt_eligible");
  });

  it("Mastercard + UNRECOGNIZED → 4863 (FPT-eligible, 'does not recognize')", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "UNRECOGNIZED",
      cardNetwork: "mastercard",
    });
    expect(result.code).toBe("4863");
    expect(result.entry?.family).toBe("fpt_eligible");
  });

  it("Visa + PRODUCT_NOT_RECEIVED → 13.1 (not the same as 13.2 / 13.3)", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "PRODUCT_NOT_RECEIVED",
      cardNetwork: "visa",
    });
    expect(result.code).toBe("13.1");
  });

  it("Visa + SUBSCRIPTION_CANCELED → 13.2 (recurring), not 13.1", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "SUBSCRIPTION_CANCELED",
      cardNetwork: "visa",
    });
    expect(result.code).toBe("13.2");
  });

  it("Visa + PRODUCT_UNACCEPTABLE → 13.3 (not-as-described), not 13.1", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "PRODUCT_UNACCEPTABLE",
      cardNetwork: "visa",
    });
    expect(result.code).toBe("13.3");
  });

  it("Mastercard + CREDIT_NOT_PROCESSED → 4860", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "CREDIT_NOT_PROCESSED",
      cardNetwork: "mastercard",
    });
    expect(result.code).toBe("4860");
  });

  it("unknown card network → unknown confidence with missing_card_network reason", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: null,
    });
    expect(result.code).toBeNull();
    expect(result.confidence).toBe("unknown");
    expect(result.reason).toBe("missing_card_network");
  });

  it("missing Shopify reason → unknown with missing_shopify_reason", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: null,
      cardNetwork: "visa",
    });
    expect(result.code).toBeNull();
    expect(result.confidence).toBe("unknown");
    expect(result.reason).toBe("missing_shopify_reason");
  });

  it("Amex / Discover → unknown (LSE catalog v1 is Visa + MC only)", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "amex",
    });
    expect(result.code).toBeNull();
    expect(result.confidence).toBe("unknown");
  });

  it("INSUFFICIENT_FUNDS has no merchant-side network code → unknown", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "INSUFFICIENT_FUNDS",
      cardNetwork: "visa",
    });
    expect(result.code).toBeNull();
    expect(result.confidence).toBe("unknown");
  });
});

describe("resolveNetworkReasonCode — derived path (receiptJson)", () => {
  it("Visa receipt carrying dispute.network_reason_code → derived 10.4", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "visa",
      receiptJson: JSON.stringify({
        dispute: { network_reason_code: "10.4" },
      }),
    });
    expect(result.code).toBe("10.4");
    expect(result.confidence).toBe("derived");
    expect(result.source).toBe("shopify_receipt_json");
  });

  it("Visa receipt with underscored code '13_1' → normalized to 13.1", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "PRODUCT_NOT_RECEIVED",
      cardNetwork: "visa",
      receiptJson: { dispute: { network_reason_code: "13_1" } },
    });
    expect(result.code).toBe("13.1");
    expect(result.confidence).toBe("derived");
  });

  it("Mastercard receipt with 4-digit code → derived", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "mastercard",
      receiptJson: { dispute: { network_reason_code: "4837" } },
    });
    expect(result.code).toBe("4837");
    expect(result.confidence).toBe("derived");
  });

  it("receipt with Stripe-style english code (e.g. 'fraudulent') → falls through to inferred", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "visa",
      receiptJson: { failure_code: "fraudulent" },
    });
    expect(result.code).toBe("10.4");
    expect(result.confidence).toBe("inferred");
  });

  it("malformed receipt JSON string → falls through to inferred without throwing", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "visa",
      receiptJson: "{not-json",
    });
    expect(result.confidence).toBe("inferred");
    expect(result.code).toBe("10.4");
  });

  it("receipt with unknown numeric code (e.g. '99.9') → falls through to inferred", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "FRAUDULENT",
      cardNetwork: "visa",
      receiptJson: { dispute: { network_reason_code: "99.9" } },
    });
    expect(result.confidence).toBe("inferred");
    expect(result.code).toBe("10.4");
  });
});

describe("resolveNetworkReasonCode — order context refinement", () => {
  it("SUBSCRIPTION_CANCELED + !hasSubscription emits diagnostic reason but keeps the code", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "SUBSCRIPTION_CANCELED",
      cardNetwork: "visa",
      orderContext: { hasSubscription: false },
    });
    expect(result.code).toBe("13.2");
    expect(result.reason).toContain("no_subscription_signal");
  });

  it("DUPLICATE + !hasDuplicateLikeTransactions emits diagnostic reason but keeps the code", () => {
    const result = resolveNetworkReasonCode({
      shopifyReason: "DUPLICATE",
      cardNetwork: "mastercard",
      orderContext: { hasDuplicateLikeTransactions: false },
    });
    expect(result.code).toBe("4834");
    expect(result.reason).toContain("no_duplicate_signal");
  });
});
