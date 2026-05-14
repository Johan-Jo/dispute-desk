/**
 * Tests for field-level CE 3.0 matching primitives.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeIp,
  matchIp,
  matchDevice,
  matchShippingAddress,
  matchAccountId,
  matchEmail,
  computeMatchPoints,
} from "@/lib/liabilityShift/matching";
import type { QualificationOrder } from "@/lib/liabilityShift/types";

describe("normalizeIp", () => {
  it("normalizes IPv4 with leading zeros", () => {
    expect(normalizeIp("192.168.001.001")).toBe("192.168.1.1");
  });
  it("rejects invalid IPv4 octets", () => {
    expect(normalizeIp("999.1.1.1")).toBeNull();
  });
  it("lowercases IPv6", () => {
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
  });
  it("returns null on garbage", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp(null)).toBeNull();
  });
});

describe("matchIp", () => {
  it("exact IPv4 match returns strength=exact", () => {
    const m = matchIp("203.0.113.5", "203.0.113.5");
    expect(m.matched).toBe(true);
    expect(m.strength).toBe("exact");
    expect(m.reasonCode).toBeNull();
  });
  it("/24 subnet match returns strength=subnet with reason code", () => {
    const m = matchIp("203.0.113.5", "203.0.113.250");
    expect(m.matched).toBe(true);
    expect(m.strength).toBe("subnet");
    expect(m.reasonCode).toBe("ip_match:subnet_only");
  });
  it("different /24 subnets do not match", () => {
    const m = matchIp("203.0.113.5", "203.0.114.5");
    expect(m.matched).toBe(false);
  });
  it("IPv6 does not subnet-fallback", () => {
    const m = matchIp("2001:db8::1", "2001:db8::2");
    expect(m.matched).toBe(false);
  });
  it("null/empty does not match", () => {
    expect(matchIp(null, "1.2.3.4").matched).toBe(false);
    expect(matchIp("1.2.3.4", null).matched).toBe(false);
  });
});

describe("matchDevice", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  it("identical deterministic fingerprints match", () => {
    expect(matchDevice(hashA, hashA).matched).toBe(true);
  });
  it("different fingerprints do not match", () => {
    expect(matchDevice(hashA, hashB).matched).toBe(false);
  });
  it("short fingerprints rejected with reason code", () => {
    const m = matchDevice("short", "short");
    expect(m.matched).toBe(false);
    expect(m.reasonCode).toBe("device_match:fingerprint_too_short");
  });
  it("empty fingerprints do not match", () => {
    expect(matchDevice(null, hashA).matched).toBe(false);
    expect(matchDevice("", hashA).matched).toBe(false);
  });
});

describe("matchShippingAddress", () => {
  const baseAddr = {
    address1: "123 Main St",
    address2: null,
    city: "Boston",
    province: "Massachusetts",
    provinceCode: "MA",
    country: "United States",
    countryCode: "US",
    zip: "02101",
  };

  it("identical addresses match exactly", () => {
    const m = matchShippingAddress(baseAddr, { ...baseAddr });
    expect(m.matched).toBe(true);
    expect(m.strength).toBe("exact");
  });

  it("123 Main St ↔ 123 Main Street normalizes to a match", () => {
    const m = matchShippingAddress(baseAddr, {
      ...baseAddr,
      address1: "123 Main Street",
    });
    expect(m.matched).toBe(true);
    expect(m.strength).toBe("normalized");
    expect(m.reasonCode).toBe("shipping_match:normalized_only");
  });

  it("ZIP+4 vs 5-digit normalizes", () => {
    const m = matchShippingAddress(baseAddr, {
      ...baseAddr,
      zip: "02101-1234",
    });
    expect(m.matched).toBe(true);
    expect(m.strength).toBe("normalized");
  });

  it("different cities do not match", () => {
    const m = matchShippingAddress(baseAddr, {
      ...baseAddr,
      city: "Cambridge",
    });
    expect(m.matched).toBe(false);
  });

  it("different countries never match (even with same street)", () => {
    const m = matchShippingAddress(baseAddr, {
      ...baseAddr,
      countryCode: "CA",
      country: "Canada",
    });
    expect(m.matched).toBe(false);
  });

  it("missing address1 returns no match", () => {
    expect(matchShippingAddress(baseAddr, { ...baseAddr, address1: null }).matched).toBe(false);
  });

  it("null inputs do not match", () => {
    expect(matchShippingAddress(null, baseAddr).matched).toBe(false);
    expect(matchShippingAddress(baseAddr, null).matched).toBe(false);
  });
});

describe("matchAccountId / matchEmail", () => {
  it("exact account ID match", () => {
    expect(matchAccountId("cust-123", "cust-123").matched).toBe(true);
  });
  it("case-insensitive email match", () => {
    expect(matchEmail("Alice@Example.com", "alice@example.com").matched).toBe(true);
  });
  it("empty inputs do not match", () => {
    expect(matchAccountId(null, "x").matched).toBe(false);
    expect(matchEmail("", "x").matched).toBe(false);
  });
});

describe("computeMatchPoints", () => {
  const order = (overrides: Partial<QualificationOrder> = {}): QualificationOrder => ({
    shopifyOrderId: "gid://shopify/Order/1",
    createdAt: "2026-04-01T00:00:00Z",
    customerId: "cust-123",
    customerEmail: "alice@example.com",
    cardNetwork: "visa",
    ipAddress: "203.0.113.5",
    deviceFingerprint: "a".repeat(64),
    shippingAddress: {
      address1: "123 Main St",
      address2: null,
      city: "Boston",
      province: "Massachusetts",
      provinceCode: "MA",
      country: "United States",
      countryCode: "US",
      zip: "02101",
    },
    subscriptionMarker: null,
    totalAmount: 100,
    totalRefunded: 0,
    disputed: false,
    isValidationCharge: false,
    threeDSecure: null,
    ...overrides,
  });

  it("IP + shipping match across all 3 transactions → anchor satisfied", () => {
    const disputed = order();
    const priors = [
      order({ shopifyOrderId: "gid://shopify/Order/2", createdAt: "2026-01-01T00:00:00Z" }),
      order({ shopifyOrderId: "gid://shopify/Order/3", createdAt: "2025-12-01T00:00:00Z" }),
    ];
    const result = computeMatchPoints(disputed, priors);
    expect(result.points).toContain("ip");
    expect(result.points).toContain("shipping");
    expect(result.points).toContain("device");
    expect(result.points).toContain("account");
    expect(result.hasAnchor).toBe(true);
  });

  it("shipping + account only → no anchor", () => {
    const disputed = order({ ipAddress: null, deviceFingerprint: null });
    const priors = [
      order({ shopifyOrderId: "gid://shopify/Order/2", ipAddress: null, deviceFingerprint: null }),
      order({ shopifyOrderId: "gid://shopify/Order/3", ipAddress: null, deviceFingerprint: null }),
    ];
    const result = computeMatchPoints(disputed, priors);
    expect(result.points).toEqual(expect.arrayContaining(["shipping", "account"]));
    expect(result.points).not.toContain("ip");
    expect(result.points).not.toContain("device");
    expect(result.hasAnchor).toBe(false);
  });

  it("IP subnet fallback emits reason code", () => {
    const disputed = order({ ipAddress: "203.0.113.5" });
    const priors = [order({ ipAddress: "203.0.113.250" })];
    const result = computeMatchPoints(disputed, priors);
    expect(result.points).toContain("ip");
    expect(result.reasonCodes).toContain("ip_match:subnet_only");
  });

  it("guest checkout falls back to email match for account point", () => {
    const disputed = order({ customerId: null });
    const priors = [order({ customerId: null })];
    const result = computeMatchPoints(disputed, priors);
    expect(result.points).toContain("account");
  });
});
