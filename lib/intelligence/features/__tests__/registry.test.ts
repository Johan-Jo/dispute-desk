import { describe, it, expect } from "vitest";
import { FEATURE_REGISTRY, registryLeakageViolations, getFeature } from "@/lib/intelligence/features/registry";
import { deriveTenure } from "@/lib/intelligence/features/tenure";

describe("feature registry — leakage invariants (design §6)", () => {
  it("has no leakage violations", () => {
    expect(registryLeakageViolations()).toEqual([]);
  });

  it("final outcome is never a predictive feature", () => {
    const f = getFeature("final_outcome")!;
    expect(f.preventionModelEligible).toBe(false);
    expect(f.responseModelEligible).toBe(false);
  });

  it("evidence/submission is analytical-outcome-only, never a model feature", () => {
    const f = getFeature("evidence_and_submission")!;
    expect(f.analyticalOutcomeOnly).toBe(true);
    expect(f.responseModelEligible).toBe(false);
  });

  it("risk_level_initial is retrospective and not model-eligible", () => {
    const f = getFeature("risk_level_initial")!;
    expect(f.retrospectiveOnly).toBe(true);
    expect(f.stage).toBe("POST_OUTCOME_ONLY");
    expect(f.preventionModelEligible).toBe(false);
  });

  it("unverified-provenance fields are held descriptive-only", () => {
    const unverified = FEATURE_REGISTRY.filter((f) => f.unverifiedPendingProvenance);
    expect(unverified.length).toBeGreaterThan(0);
    for (const f of unverified) {
      expect(f.preventionModelEligible).toBe(false);
      expect(f.responseModelEligible).toBe(false);
    }
  });
});

describe("tenure derivation (design §5.1) — never asserts bare 'new'", () => {
  const shopStart = "2018-05-24T00:00:00Z";

  it("returning when a prior order exists in the window", () => {
    expect(deriveTenure({
      customerShopifyId: "c1", priorOrdersInWindow: 2,
      customerFirstSeenAt: "2020-01-01T00:00:00Z", shopCoverageStart: shopStart,
      orderCreatedAt: "2021-01-01T00:00:00Z",
    })).toBe("returning");
  });

  it("first_seen_in_observed_history when no prior order and clear of the boundary", () => {
    expect(deriveTenure({
      customerShopifyId: "c2", priorOrdersInWindow: 0,
      customerFirstSeenAt: "2022-01-01T00:00:00Z", shopCoverageStart: shopStart,
      orderCreatedAt: "2022-01-01T00:00:00Z",
    })).toBe("first_seen_in_observed_history");
  });

  it("unknown at the left-censor boundary (pre-boundary order can't be ruled out)", () => {
    expect(deriveTenure({
      customerShopifyId: "c3", priorOrdersInWindow: 0,
      customerFirstSeenAt: "2018-05-30T00:00:00Z", shopCoverageStart: shopStart,
      orderCreatedAt: "2018-05-30T00:00:00Z",
    })).toBe("unknown");
  });

  it("unknown when there is no customer identity", () => {
    expect(deriveTenure({
      customerShopifyId: null, priorOrdersInWindow: null,
      customerFirstSeenAt: null, shopCoverageStart: shopStart,
      orderCreatedAt: "2022-01-01T00:00:00Z",
    })).toBe("unknown");
  });
});
