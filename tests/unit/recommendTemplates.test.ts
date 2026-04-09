import { describe, it, expect } from "vitest";
import {
  recommendTemplates,
  deriveEvidenceConfidence,
  getDefaultEvidenceConfig,
  TEMPLATE_IDS,
  type StoreProfileForRecommendation,
  type ShopifyEvidenceConfig,
} from "@/lib/setup/recommendTemplates";

function makeProfile(
  overrides: Partial<StoreProfileForRecommendation> = {}
): StoreProfileForRecommendation {
  const storeTypes = overrides.storeTypes ?? ["physical"];
  const deliveryProof = overrides.deliveryProof ?? "always";
  return {
    storeTypes,
    deliveryProof,
    digitalProof: overrides.digitalProof ?? "yes",
    shopifyEvidenceConfig:
      overrides.shopifyEvidenceConfig ??
      getDefaultEvidenceConfig(storeTypes, deliveryProof),
  };
}

function defaultSlugs(recs: ReturnType<typeof recommendTemplates>): string[] {
  return recs.filter((r) => r.isDefault).map((r) => r.slug);
}

describe("recommendTemplates", () => {
  it("always returns all 10 templates", () => {
    const recs = recommendTemplates(makeProfile());
    expect(recs).toHaveLength(10);
    const ids = recs.map((r) => r.templateId);
    for (const id of Object.values(TEMPLATE_IDS)) {
      expect(ids).toContain(id);
    }
  });

  it("always includes fraud_standard and general_catchall as defaults", () => {
    const recs = recommendTemplates(makeProfile({ storeTypes: [] }));
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("fraud_standard");
    expect(defaults).toContain("general_catchall");
  });

  it("physical + always tracking → pnr_with_tracking (not pnr_weak_proof)", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["physical"], deliveryProof: "always" })
    );
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("pnr_with_tracking");
    expect(defaults).not.toContain("pnr_weak_proof");
    expect(defaults).toContain("not_as_described_quality");
  });

  it("physical + sometimes tracking → pnr_with_tracking", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["physical"], deliveryProof: "sometimes" })
    );
    expect(defaultSlugs(recs)).toContain("pnr_with_tracking");
  });

  it("physical + rarely tracking → pnr_weak_proof (not pnr_with_tracking)", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["physical"], deliveryProof: "rarely" })
    );
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("pnr_weak_proof");
    expect(defaults).not.toContain("pnr_with_tracking");
  });

  it("physical + tracking evidence off → pnr_weak_proof", () => {
    const ec = getDefaultEvidenceConfig(["physical"], "always");
    ec.trackingDetails = "off";
    const recs = recommendTemplates(
      makeProfile({
        storeTypes: ["physical"],
        deliveryProof: "always",
        shopifyEvidenceConfig: ec,
      })
    );
    expect(defaultSlugs(recs)).toContain("pnr_weak_proof");
    expect(defaultSlugs(recs)).not.toContain("pnr_with_tracking");
  });

  it("digital only → digital_goods, not_as_described, credit_not_processed, no pnr", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["digital"], deliveryProof: "rarely" })
    );
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("digital_goods");
    expect(defaults).toContain("not_as_described_quality");
    expect(defaults).toContain("credit_not_processed");
    expect(defaults).not.toContain("pnr_with_tracking");
    expect(defaults).not.toContain("pnr_weak_proof");
  });

  it("services only → digital_goods, credit_not_processed", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["services"], deliveryProof: "rarely" })
    );
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("digital_goods");
    expect(defaults).toContain("credit_not_processed");
  });

  it("subscriptions only → subscription_canceled", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["subscriptions"], deliveryProof: "rarely" })
    );
    expect(defaultSlugs(recs)).toContain("subscription_canceled");
  });

  it("multi-type (physical + digital) → deduplicated union", () => {
    const recs = recommendTemplates(
      makeProfile({ storeTypes: ["physical", "digital"], deliveryProof: "always" })
    );
    const defaults = defaultSlugs(recs);
    expect(defaults).toContain("pnr_with_tracking");
    expect(defaults).toContain("digital_goods");
    expect(defaults).toContain("not_as_described_quality");
    expect(defaults).toContain("credit_not_processed");
    // no duplicates
    expect(new Set(defaults).size).toBe(defaults.length);
  });

  it("every recommendation has a templateId matching TEMPLATE_IDS", () => {
    const recs = recommendTemplates(makeProfile());
    for (const r of recs) {
      expect(r.templateId).toBe(TEMPLATE_IDS[r.slug]);
    }
  });

  it("every recommendation has a disputeFamily", () => {
    const recs = recommendTemplates(makeProfile());
    for (const r of recs) {
      expect(r.disputeFamily.length).toBeGreaterThan(0);
    }
  });

  it("default recommendations have non-empty reasons", () => {
    const recs = recommendTemplates(makeProfile());
    for (const r of recs.filter((x) => x.isDefault)) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("deriveEvidenceConfidence", () => {
  it("high when order=always + fulfillment active + refund=always", () => {
    const config: ShopifyEvidenceConfig = {
      orderDetails: "always",
      customerAddress: "always",
      fulfillmentRecords: "when_present",
      trackingDetails: "when_present",
      orderTimeline: "when_present",
      refundHistory: "always",
      notesMetadata: "when_present",
    };
    expect(deriveEvidenceConfidence(config)).toBe("high");
  });

  it("high when tracking active but fulfillment off", () => {
    const config: ShopifyEvidenceConfig = {
      orderDetails: "always",
      customerAddress: "always",
      fulfillmentRecords: "off",
      trackingDetails: "always",
      orderTimeline: "when_present",
      refundHistory: "always",
      notesMetadata: "when_present",
    };
    expect(deriveEvidenceConfidence(config)).toBe("high");
  });

  it("medium when order=always but fulfillment+tracking off", () => {
    const config: ShopifyEvidenceConfig = {
      orderDetails: "always",
      customerAddress: "always",
      fulfillmentRecords: "off",
      trackingDetails: "off",
      orderTimeline: "when_present",
      refundHistory: "always",
      notesMetadata: "when_present",
    };
    expect(deriveEvidenceConfidence(config)).toBe("medium");
  });

  it("low when order not always", () => {
    const config: ShopifyEvidenceConfig = {
      orderDetails: "when_present",
      customerAddress: "always",
      fulfillmentRecords: "when_present",
      trackingDetails: "when_present",
      orderTimeline: "when_present",
      refundHistory: "always",
      notesMetadata: "when_present",
    };
    expect(deriveEvidenceConfidence(config)).toBe("low");
  });
});

describe("getDefaultEvidenceConfig", () => {
  it("physical store with strong tracking → fulfillment + tracking when_present", () => {
    const config = getDefaultEvidenceConfig(["physical"], "always");
    expect(config.fulfillmentRecords).toBe("when_present");
    expect(config.trackingDetails).toBe("when_present");
  });

  it("physical store with rarely tracking → tracking off", () => {
    const config = getDefaultEvidenceConfig(["physical"], "rarely");
    expect(config.fulfillmentRecords).toBe("when_present");
    expect(config.trackingDetails).toBe("off");
  });

  it("digital-only store → fulfillment + tracking off", () => {
    const config = getDefaultEvidenceConfig(["digital"], "rarely");
    expect(config.fulfillmentRecords).toBe("off");
    expect(config.trackingDetails).toBe("off");
  });

  it("always includes orderDetails=always and refundHistory=always", () => {
    const config = getDefaultEvidenceConfig([], "rarely");
    expect(config.orderDetails).toBe("always");
    expect(config.refundHistory).toBe("always");
    expect(config.customerAddress).toBe("always");
  });
});
