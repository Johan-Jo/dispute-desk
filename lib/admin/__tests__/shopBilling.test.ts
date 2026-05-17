import { describe, it, expect } from "vitest";
import {
  monthlyRevenueForPlan,
  totalInvoicedForPeriod,
} from "@/lib/admin/shopBilling";

describe("monthlyRevenueForPlan", () => {
  it("returns the canonical plan price for each known plan id", () => {
    expect(monthlyRevenueForPlan("free").monthlyUsd).toBe(0);
    expect(monthlyRevenueForPlan("starter").monthlyUsd).toBe(29);
    expect(monthlyRevenueForPlan("growth").monthlyUsd).toBe(129);
    expect(monthlyRevenueForPlan("scale").monthlyUsd).toBe(299);
  });

  it("falls back to the free plan for unknown / null / undefined inputs", () => {
    expect(monthlyRevenueForPlan(null).planId).toBe("free");
    expect(monthlyRevenueForPlan(undefined).planId).toBe("free");
    expect(monthlyRevenueForPlan("not-a-plan").planId).toBe("free");
    expect(monthlyRevenueForPlan(null).monthlyUsd).toBe(0);
  });

  it("surfaces the merchant-facing plan name", () => {
    expect(monthlyRevenueForPlan("growth").planName).toBe("Growth");
    expect(monthlyRevenueForPlan("scale").planName).toBe("Scale");
  });
});

describe("totalInvoicedForPeriod", () => {
  it("computes monthly_price × months_in_period for whole months", () => {
    // Growth $129/mo × 1 month
    expect(totalInvoicedForPeriod("growth", 30).totalUsd).toBe(129);
    // × 3 months
    expect(totalInvoicedForPeriod("growth", 90).totalUsd).toBe(387);
    // × 6 months
    expect(totalInvoicedForPeriod("growth", 180).totalUsd).toBe(774);
  });

  it("scales partial-month windows linearly (15 days = 0.5 month)", () => {
    expect(totalInvoicedForPeriod("scale", 15).totalUsd).toBe(150); // 299 / 2 = 149.5 → 150
  });

  it("returns zero for the free plan regardless of window", () => {
    expect(totalInvoicedForPeriod("free", 30).totalUsd).toBe(0);
    expect(totalInvoicedForPeriod("free", 365).totalUsd).toBe(0);
  });

  it("flags the figure as approximate", () => {
    const r = totalInvoicedForPeriod("growth", 90);
    expect(r.isApproximate).toBe(true);
  });

  it("reports months as a one-decimal-rounded fraction of the window", () => {
    expect(totalInvoicedForPeriod("growth", 30).monthsInPeriod).toBe(1);
    expect(totalInvoicedForPeriod("growth", 90).monthsInPeriod).toBe(3);
    expect(totalInvoicedForPeriod("growth", 180).monthsInPeriod).toBe(6);
    expect(totalInvoicedForPeriod("growth", 45).monthsInPeriod).toBe(1.5);
  });

  it("rejects negative window days", () => {
    expect(() => totalInvoicedForPeriod("growth", -1)).toThrowError();
  });

  it("falls back to free for unknown plans", () => {
    expect(totalInvoicedForPeriod("not-a-plan", 30).totalUsd).toBe(0);
    expect(totalInvoicedForPeriod(null, 30).planId).toBe("free");
  });
});
