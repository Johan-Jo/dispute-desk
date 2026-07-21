import { describe, it, expect } from "vitest";
import { wilsonInterval } from "@/lib/intelligence/stats/wilson";
import { bootstrapInterval, ratioOfSums } from "@/lib/intelligence/stats/bootstrap";
import { evaluateGates } from "@/lib/intelligence/stats/sampleGates";

describe("stats/wilson", () => {
  it("brackets the point estimate and stays within [0,1]", () => {
    const r = wilsonInterval(30, 50);
    expect(r.point).toBeCloseTo(0.6, 6);
    expect(r.lower).toBeGreaterThan(0);
    expect(r.upper).toBeLessThan(1);
    expect(r.lower).toBeLessThan(r.point);
    expect(r.upper).toBeGreaterThan(r.point);
  });

  it("known value: 50/100 → ~[0.404, 0.596]", () => {
    const r = wilsonInterval(50, 100);
    expect(r.lower).toBeCloseTo(0.4038, 3);
    expect(r.upper).toBeCloseTo(0.5962, 3);
  });

  it("handles empty denominator and rejects invalid counts", () => {
    expect(wilsonInterval(0, 0).point).toBe(0);
    expect(() => wilsonInterval(5, 3)).toThrow();
    expect(() => wilsonInterval(1.5, 3)).toThrow();
  });
});

describe("stats/bootstrap", () => {
  it("is deterministic for a fixed seed", () => {
    const sample = [100, 200, 300, 400, 500];
    const a = bootstrapInterval(sample, { seed: 42, iterations: 500 });
    const b = bootstrapInterval(sample, { seed: 42, iterations: 500 });
    expect(a.lower).toBe(b.lower);
    expect(a.upper).toBe(b.upper);
    expect(a.point).toBeCloseTo(300, 6);
  });

  it("ratioOfSums computes Σa/Σb", () => {
    expect(ratioOfSums([[50, 100], [30, 100]])).toBeCloseTo(0.4, 6);
    expect(ratioOfSums([[0, 0]])).toBe(0);
  });
});

describe("stats/sampleGates", () => {
  it("suppresses below the minimum event floor", () => {
    const r = evaluateGates({ exposedPopulation: 1000, events: 5, resolvedOutcomes: 5, missingnessPct: 2, historicalPeriods: 5 });
    expect(r.verdict).toBe("suppress");
  });

  it("flags exploratory on soft failures", () => {
    const r = evaluateGates({ exposedPopulation: 10, events: 20, resolvedOutcomes: 20, missingnessPct: 2, historicalPeriods: 5 });
    expect(r.verdict).toBe("exploratory");
  });

  it("passes when all gates clear", () => {
    const r = evaluateGates({ exposedPopulation: 1000, events: 50, resolvedOutcomes: 50, missingnessPct: 2, historicalPeriods: 5 });
    expect(r.verdict).toBe("pass");
  });
});
