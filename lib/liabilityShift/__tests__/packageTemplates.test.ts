/**
 * Tests for CE 3.0 package data assembly. PDF rendering itself isn't
 * snapshot-tested here — that's a Puppeteer / react-pdf concern. We
 * verify the shape that feeds the document is correct per verdict.
 */

import { describe, it, expect } from "vitest";
import { buildCE30PackageData } from "@/lib/liabilityShift/packageTemplates";
import type { CE30Result, QualificationOrder } from "@/lib/liabilityShift/types";

function makeOrder(over: Partial<QualificationOrder> = {}): QualificationOrder {
  return {
    shopifyOrderId: "gid://shopify/Order/1",
    createdAt: "2026-05-01T00:00:00Z",
    customerId: "cust-1",
    customerEmail: "a@b.com",
    cardNetwork: "visa",
    ipAddress: "1.2.3.4",
    deviceFingerprint: null,
    shippingAddress: {
      address1: "1 A St",
      address2: null,
      city: "Boston",
      province: "MA",
      provinceCode: "MA",
      country: "US",
      countryCode: "US",
      zip: "02101",
    },
    subscriptionMarker: null,
    totalAmount: 100,
    totalRefunded: 0,
    disputed: false,
    isValidationCharge: false,
    threeDSecure: null,
    ...over,
  };
}

function makeVerdict(over: Partial<CE30Result> = {}): CE30Result {
  return {
    verdict: "qualifies",
    branch: "standard",
    program: "ce_30",
    matchPoints: ["ip", "shipping"],
    hasAnchor: true,
    qualifyingPriors: ["gid://shopify/Order/2", "gid://shopify/Order/3"],
    autoQualificationVia: null,
    autoQualificationFeeApplies: false,
    confidence: "high",
    confidenceReasons: [],
    missingEvidence: [],
    summary: "",
    ...over,
  };
}

describe("buildCE30PackageData", () => {
  it("standard verdict produces a 3-row evidence table (disputed + 2 priors)", () => {
    const pkg = buildCE30PackageData({
      merchantName: "Acme Shop",
      disputeId: "gid://shopify/Dispute/9",
      language: "en-US",
      verdict: makeVerdict(),
      disputed: makeOrder(),
      matchedPriors: [
        makeOrder({ shopifyOrderId: "gid://shopify/Order/2" }),
        makeOrder({ shopifyOrderId: "gid://shopify/Order/3" }),
      ],
    });
    expect(pkg.evidence.kind).toBe("standard");
    if (pkg.evidence.kind === "standard") {
      expect(pkg.evidence.priorRows).toHaveLength(2);
    }
  });

  it("auto-qualified verdict (Visa Secure) carries the fee flag when applicable", () => {
    const pkg = buildCE30PackageData({
      merchantName: "Acme",
      disputeId: "gid://shopify/Dispute/9",
      language: "en-US",
      verdict: makeVerdict({
        verdict: "qualifies_network_prequalified",
        branch: "auto_qualified",
        autoQualificationVia: "visa_secure",
        autoQualificationFeeApplies: true,
        matchPoints: [],
        qualifyingPriors: [],
      }),
      disputed: makeOrder(),
    });
    expect(pkg.evidence.kind).toBe("auto_qualified");
    expect(pkg.cover.confidenceBadge).toBe("auto_qualified");
    if (pkg.evidence.kind === "auto_qualified") {
      expect(pkg.evidence.via).toBe("visa_secure");
      expect(pkg.evidence.feeAppliesFrom).toBe("2026-04-17");
    }
  });

  it("initial_billing verdict produces a 2-row table (disputed + initial billing)", () => {
    const pkg = buildCE30PackageData({
      merchantName: "Acme",
      disputeId: "gid://shopify/Dispute/9",
      language: "en-US",
      verdict: makeVerdict({
        verdict: "qualifies_via_initial_billing",
        branch: "initial_billing",
        qualifyingPriors: ["gid://shopify/Order/initial"],
      }),
      disputed: makeOrder(),
      initialBilling: makeOrder({ shopifyOrderId: "gid://shopify/Order/initial" }),
    });
    expect(pkg.evidence.kind).toBe("initial_billing");
    if (pkg.evidence.kind === "initial_billing") {
      expect(pkg.evidence.initialBillingRow.orderId).toBe("initial");
    }
  });

  it("PT-BR language returns Portuguese merchant statement", () => {
    const pkg = buildCE30PackageData({
      merchantName: "Acme",
      disputeId: "gid://shopify/Dispute/9",
      language: "pt-BR",
      verdict: makeVerdict(),
      disputed: makeOrder(),
      matchedPriors: [makeOrder({ shopifyOrderId: "gid://shopify/Order/2" })],
    });
    expect(pkg.statement).toMatch(/titular do cartão/);
  });

  it("device fingerprint is truncated to PII-safe form", () => {
    const fp = "a".repeat(64);
    const pkg = buildCE30PackageData({
      merchantName: "Acme",
      disputeId: "gid://shopify/Dispute/9",
      language: "en-US",
      verdict: makeVerdict({ matchPoints: ["ip", "device"] }),
      disputed: makeOrder({ deviceFingerprint: fp }),
      matchedPriors: [makeOrder({ shopifyOrderId: "gid://shopify/Order/2", deviceFingerprint: fp })],
    });
    expect(pkg.evidence.kind).toBe("standard");
    if (pkg.evidence.kind === "standard") {
      expect(pkg.evidence.disputedRow.deviceFingerprintHash).toBe("aaaaaaaaaaaa…");
      expect(pkg.evidence.disputedRow.deviceFingerprintHash?.length).toBeLessThan(20);
    }
  });
});
