import { describe, it, expect } from "vitest";
import { buildSimulation, type SimulationInput } from "@/lib/intelligence/simulator/simulate";
import type { SegmentFacts } from "@/lib/intelligence/db/tenantScope";
import { POLICY_TEMPLATES, getTemplate } from "@/lib/intelligence/simulator/templates";

const FACTS: SegmentFacts = {
  orders_affected: 100,
  revenue_affected: "50000.00",
  disputes_in_segment: 20,
  disputed_value: "4000.00",
  net_loss_in_segment: "3000.00",
  legit_orders_affected: 80,
};

const INPUT: SimulationInput = {
  template: "test",
  currency: "USD",
  filters: {},
  effectiveness: { conservativeBps: 1500, expectedBps: 3500, optimisticBps: 6000 },
  costs: { perOrderCostMinor: 50 }, // $0.50 per order
};

describe("buildSimulation — avoided-loss range (no float, integer bps)", () => {
  const r = buildSimulation(FACTS, INPUT);

  it("computes the conservative/expected/optimistic avoided-loss band from net loss", () => {
    expect(r.avoidedLoss.conservative).toBe("450.00"); // 15% of 3000
    expect(r.avoidedLoss.expected).toBe("1050.00"); // 35%
    expect(r.avoidedLoss.optimistic).toBe("1800.00"); // 60%
  });

  it("nets implementation cost (0.50 × 100 = 50.00)", () => {
    expect(r.implementationCost).toBe("50.00");
    expect(r.netImpact.expected).toBe("1000.00");
    expect(r.netImpact.conservative).toBe("400.00");
  });

  it("never assumes full prevention and surfaces friction exposure", () => {
    expect(r.legitimateOrdersAffected).toBe(80);
    expect(r.evidenceGrade).toBe("descriptive");
    expect(r.limitations.join(" ")).toMatch(/NOT a guarantee/);
  });

  it("applies a safety margin to avoided loss when set", () => {
    const withSafety = buildSimulation(FACTS, { ...INPUT, costs: { perOrderCostMinor: 0, safetyMarginBps: 2000 } });
    // expected 1050.00 shaved 20% → 840.00
    expect(withSafety.avoidedLoss.expected).toBe("840.00");
  });

  it("flags retrospective-risk leakage when a risk-level filter is used", () => {
    const withRisk = buildSimulation(FACTS, { ...INPUT, filters: { riskLevels: ["HIGH"] } });
    expect(withRisk.limitations.join(" ")).toMatch(/retrospective risk \(leakage\)/);
  });
});

describe("policy templates", () => {
  it("exposes the initial template set and resolves by key", () => {
    expect(POLICY_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const t = getTemplate("signature_above_value");
    expect(t).toBeDefined();
    const built = t!.build("USD");
    expect(built.currency).toBe("USD");
    expect(built.effectiveness.expectedBps).toBeGreaterThan(0);
  });
});
