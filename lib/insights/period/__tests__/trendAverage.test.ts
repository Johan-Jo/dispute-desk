import { describe, expect, it } from "vitest";
import { trendAverage } from "@/lib/insights/period/trendAverage";

describe("trendAverage", () => {
  it("averages each month with the two before it, shorter at the start", () => {
    expect(trendAverage([0.0022, 0.0012, 0.002, 0.0155])).toEqual([0.0022, 0.0017, 0.0018, 0.00623]);
  });

  it("gives a month without a ratio no point and never counts it as zero", () => {
    expect(trendAverage([0.01, null, 0.02])).toEqual([0.01, null, 0.015]);
  });

  it("matches the design sample: Jul 2.37%, Aug 0.15%, Sep 0.15% → 0.89%", () => {
    expect(trendAverage([0.0237, 0.0015, 0.0015])[2]).toBe(0.0089);
  });
});
