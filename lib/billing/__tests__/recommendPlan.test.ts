/**
 * Tests for `recommendPlan`. The function decides which plan a
 * fresh-install merchant sees as a recommendation on the Risk
 * Intelligence page. Bugs here mean we'd either oversell (recommend
 * Scale to a shop that has zero chargebacks — looks predatory) or
 * undersell (recommend Starter to a shop that does 200 chargebacks
 * a month — they'd hit the cap mid-month).
 *
 * Matrix:
 *   - Empty shop (0 orders, 0 chargebacks)            → Free, reason=no_history
 *   - Active shop, 0 chargebacks                       → Free, reason=low_volume
 *   - Light volume (4/mo, smooth)                      → Starter, reason=volume_fits
 *   - Mid volume (45/mo, smooth)                       → Growth
 *   - Heavy volume (150/mo, smooth)                    → Scale
 *   - Boundary 14 → Starter, 15 → Growth, 70 → Growth, 71 → Scale
 *   - Spike: quiet 90d + noisy 30d → sized to 30d, reason=spike_observed
 *   - Spike floor: 30d=2 above quiet 90d doesn't trip spike (under floor)
 *   - Partial history flag mirrors default_window scope
 *   - Headroom multiplier: cap/monthlyRate, null for Free recommendation
 */

import { describe, it, expect } from "vitest";
import { recommendPlan } from "../recommendPlan";

describe("recommendPlan", () => {
  it("recommends Free with no_history for a brand-new shop", () => {
    const r = recommendPlan({
      chargebackOrders90d: 0,
      chargebackOrders30d: 0,
      ordersAnalyzed: 0,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("free");
    expect(r.reason).toBe("no_history");
    expect(r.monthlyChargebacks).toBe(0);
    expect(r.headroomMultiplier).toBeNull();
  });

  it("recommends Free with low_volume when shop has orders but no chargebacks", () => {
    const r = recommendPlan({
      chargebackOrders90d: 0,
      chargebackOrders30d: 0,
      ordersAnalyzed: 2_500,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("free");
    expect(r.reason).toBe("low_volume");
  });

  it("recommends Starter for light steady volume (4/mo)", () => {
    const r = recommendPlan({
      chargebackOrders90d: 12,
      chargebackOrders30d: 4,
      ordersAnalyzed: 3_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("starter");
    expect(r.reason).toBe("volume_fits");
    expect(r.monthlyChargebacks).toBe(4);
    // Starter cap = 20 → 20/4 = 5
    expect(r.headroomMultiplier).toBe(5);
  });

  it("recommends Growth for mid volume (45/mo)", () => {
    const r = recommendPlan({
      chargebackOrders90d: 135,
      chargebackOrders30d: 45,
      ordersAnalyzed: 15_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("growth");
    expect(r.reason).toBe("volume_fits");
    expect(r.monthlyChargebacks).toBe(45);
    // Growth cap = 100 → 100/45 ≈ 2.2
    expect(r.headroomMultiplier).toBe(2.2);
  });

  it("recommends Scale for heavy volume (150/mo)", () => {
    const r = recommendPlan({
      chargebackOrders90d: 450,
      chargebackOrders30d: 150,
      ordersAnalyzed: 50_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("scale");
    expect(r.monthlyChargebacks).toBe(150);
    // Scale cap = 400 → 400/150 ≈ 2.7
    expect(r.headroomMultiplier).toBe(2.7);
  });

  it("respects the Starter→Growth boundary at 14/15", () => {
    const at14 = recommendPlan({
      chargebackOrders90d: 42,
      chargebackOrders30d: 14,
      ordersAnalyzed: 5_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(at14.recommendedPlan).toBe("starter");

    const at15 = recommendPlan({
      chargebackOrders90d: 45,
      chargebackOrders30d: 15,
      ordersAnalyzed: 5_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(at15.recommendedPlan).toBe("growth");
  });

  it("respects the Growth→Scale boundary at 70/71", () => {
    const at70 = recommendPlan({
      chargebackOrders90d: 210,
      chargebackOrders30d: 70,
      ordersAnalyzed: 20_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(at70.recommendedPlan).toBe("growth");

    const at71 = recommendPlan({
      chargebackOrders90d: 213,
      chargebackOrders30d: 71,
      ordersAnalyzed: 20_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(at71.recommendedPlan).toBe("scale");
  });

  it("sizes to the noisy 30d window when a spike is observed", () => {
    // 90d/3 = 4/mo smoothed; 30d = 18 (>1.5× smoothed AND ≥ floor of 3)
    const r = recommendPlan({
      chargebackOrders90d: 12,
      chargebackOrders30d: 18,
      ordersAnalyzed: 8_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("growth"); // 18 > 14 → Growth
    expect(r.reason).toBe("spike_observed");
    expect(r.monthlyChargebacks).toBe(18);
  });

  it("does not declare a spike when 30d count is under the absolute floor", () => {
    // 90d/3 = 0.33/mo smoothed; 30d = 2 (>1.5× but UNDER floor of 3)
    const r = recommendPlan({
      chargebackOrders90d: 1,
      chargebackOrders30d: 2,
      ordersAnalyzed: 4_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(r.recommendedPlan).toBe("starter");
    expect(r.reason).toBe("volume_fits");
  });

  it("flags partial history when scope was default_window only", () => {
    const r = recommendPlan({
      chargebackOrders90d: 9,
      chargebackOrders30d: 3,
      ordersAnalyzed: 2_000,
      historicalScopeGranted: "default_window",
    });
    expect(r.partialHistory).toBe(true);

    const full = recommendPlan({
      chargebackOrders90d: 9,
      chargebackOrders30d: 3,
      ordersAnalyzed: 2_000,
      historicalScopeGranted: "read_all_orders",
    });
    expect(full.partialHistory).toBe(false);
  });

  it("treats null scope as not-partial (legacy shops pre-scope-tracking)", () => {
    const r = recommendPlan({
      chargebackOrders90d: 9,
      chargebackOrders30d: 3,
      ordersAnalyzed: 2_000,
      historicalScopeGranted: null,
    });
    expect(r.partialHistory).toBe(false);
  });
});
