/**
 * Risk-weakness detector tests (Phase 2 of fraud-risk incorporation).
 * Pure function — no mocking required.
 */

import { describe, it, expect } from "vitest";
import { detectRiskWeakness } from "../riskWeakness";

describe("detectRiskWeakness — happy path (cap should fire)", () => {
  it("triggers on FRAUDULENT + HIGH + INVESTIGATE + fulfilled", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("high_risk_fulfilled");
    expect(r.message).toMatch(/pre-authorization fraud screening/i);
    expect(r.diagnostics).toEqual({
      riskLevel: "HIGH",
      recommendation: "INVESTIGATE",
      fulfillmentCount: 1,
    });
  });

  it("triggers on FRAUDULENT + HIGH + REJECT + fulfilled", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "REJECT",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(true);
  });

  it("triggers on UNRECOGNIZED (fraud-family) + HIGH + INVESTIGATE + fulfilled", () => {
    const r = detectRiskWeakness({
      disputeReason: "UNRECOGNIZED",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(true);
  });

  it("triggers regardless of fulfillment count when >= 1", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 5,
    });
    expect(r.triggered).toBe(true);
  });

  it("normalizes lowercase risk-level / recommendation input", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "high",
      riskRecommendationInitial: "investigate",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(true);
    expect(r.diagnostics.riskLevel).toBe("HIGH");
    expect(r.diagnostics.recommendation).toBe("INVESTIGATE");
  });
});

describe("detectRiskWeakness — does not trigger", () => {
  it("does NOT trigger on non-fraud reasons (PRODUCT_NOT_RECEIVED)", () => {
    const r = detectRiskWeakness({
      disputeReason: "PRODUCT_NOT_RECEIVED",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
    // Diagnostics still populated for audit.
    expect(r.diagnostics.riskLevel).toBe("HIGH");
  });

  it("does NOT trigger on non-fraud reasons (DUPLICATE)", () => {
    const r = detectRiskWeakness({
      disputeReason: "DUPLICATE",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger on LOW risk (the positive case Phase 1 handles)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "LOW",
      riskRecommendationInitial: "ACCEPT",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger on MEDIUM risk (only HIGH qualifies)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "MEDIUM",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger when recommendation is ACCEPT (no warning was given)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "ACCEPT",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger when recommendation is NONE (no warning was given)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "NONE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger when merchant never fulfilled (count = 0)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 0,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger when risk data is absent (null risk level)", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: null,
      riskRecommendationInitial: null,
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });

  it("does NOT trigger when dispute reason is null", () => {
    const r = detectRiskWeakness({
      disputeReason: null,
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 1,
    });
    expect(r.triggered).toBe(false);
  });
});

describe("detectRiskWeakness — diagnostics population", () => {
  it("populates diagnostics even when not triggered (for audit)", () => {
    const r = detectRiskWeakness({
      disputeReason: "PRODUCT_NOT_RECEIVED",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: 2,
    });
    expect(r.triggered).toBe(false);
    expect(r.diagnostics).toEqual({
      riskLevel: "HIGH",
      recommendation: "INVESTIGATE",
      fulfillmentCount: 2,
    });
  });

  it("clamps negative fulfillment counts to 0", () => {
    const r = detectRiskWeakness({
      disputeReason: "FRAUDULENT",
      riskLevelInitial: "HIGH",
      riskRecommendationInitial: "INVESTIGATE",
      fulfillmentCount: -5,
    });
    expect(r.triggered).toBe(false);
    expect(r.diagnostics.fulfillmentCount).toBe(0);
  });
});
