import { describe, it, expect } from "vitest";
import { computeStorePatterns, type StorePatternRow } from "@/lib/disputes/storePatterns";

const OPENED = "2026-08-27T00:00:00Z";

function row(over: Partial<StorePatternRow> = {}): StorePatternRow {
  return {
    reason: "PRODUCT_NOT_RECEIVED",
    phase: "chargeback",
    outcome: "lost",
    openedAt: OPENED,
    order: { fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-08-20T00:00:00Z", riskRecommendation: "ACCEPT" },
    ...over,
  };
}
const unshipped = { fulfillmentStatus: "UNFULFILLED", fulfilledAt: null, riskRecommendation: "ACCEPT" };
const late = { fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-09-01T00:00:00Z", riskRecommendation: "ACCEPT" };
const current = { reason: "PRODUCT_NOT_RECEIVED", phase: "chargeback" as const };

describe("computeStorePatterns", () => {
  it("counts never-shipped and shipped-after-opening as unshipped at open", () => {
    const rows = [row({ order: unshipped }), row({ order: late }), row(), row(), row()];
    expect(computeStorePatterns(rows, current).patterns.unshipped_at_open).toEqual({ count: 2, lost: 5 });
  });

  it("a shipped status with no timestamp is an ingest gap: not unshipped, and not counted", () => {
    const gap = { fulfillmentStatus: "FULFILLED", fulfilledAt: null, riskRecommendation: null };
    const rows = [row({ order: unshipped }), row({ order: unshipped }), row({ order: gap }), row(), row(), row()];
    expect(computeStorePatterns(rows, current).patterns.unshipped_at_open).toEqual({ count: 2, lost: 5 });
  });

  it("only the same type and phase count; UNRECOGNIZED is fraud", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ order: unshipped })),
      row({ reason: "FRAUDULENT", order: unshipped }),
      row({ phase: "inquiry", order: unshipped }),
    ];
    expect(computeStorePatterns(rows, current).patterns.unshipped_at_open).toEqual({ count: 5, lost: 5 });
    const fraud = computeStorePatterns(
      [row({ reason: "UNRECOGNIZED", outcome: "won" }), ...Array.from({ length: 9 }, () => row({ reason: "FRAUDULENT" }))],
      { reason: "FRAUDULENT", phase: "chargeback" },
    );
    expect(fraud.baseRate).toEqual({ won: 1, decided: 10 });
  });

  it("small samples show nothing", () => {
    const four = Array.from({ length: 4 }, () => row({ order: unshipped }));
    expect(computeStorePatterns(four, current)).toEqual({ baseRate: null, patterns: {} });
    // One match among many is just this case.
    const one = [row({ order: unshipped }), ...Array.from({ length: 9 }, () => row())];
    expect(computeStorePatterns(one, current).patterns.unshipped_at_open).toBeUndefined();
  });

  it("disputes with no order on record are left out of the pattern, not counted either way", () => {
    const rows = [...Array.from({ length: 3 }, () => row({ order: unshipped })), row({ order: null }), row({ order: null })];
    expect(computeStorePatterns(rows, current).patterns.unshipped_at_open).toBeUndefined();
  });

  it("high risk shipped: CANCEL or INVESTIGATE and shipped; wins never count toward a pattern", () => {
    const hr = { fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-08-20T00:00:00Z", riskRecommendation: "cancel" };
    const rows = [
      row({ reason: "FRAUDULENT", order: hr }),
      row({ reason: "FRAUDULENT", order: { ...hr, riskRecommendation: "INVESTIGATE" } }),
      row({ reason: "FRAUDULENT", order: { ...hr, fulfilledAt: null, fulfillmentStatus: "UNFULFILLED" } }),
      row({ reason: "FRAUDULENT" }),
      row({ reason: "FRAUDULENT" }),
      row({ reason: "FRAUDULENT", outcome: "won", order: hr }),
    ];
    const p = computeStorePatterns(rows, { reason: "FRAUDULENT", phase: "chargeback" });
    expect(p.patterns).toEqual({ high_risk_shipped: { count: 2, lost: 5 } });
  });

  it("families without a Next-time rule get a base rate and no pattern", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ reason: "CREDIT_NOT_PROCESSED", outcome: i < 9 ? "won" : "lost" }),
    );
    expect(computeStorePatterns(rows, { reason: "CREDIT_NOT_PROCESSED", phase: "chargeback" })).toEqual({
      baseRate: { won: 9, decided: 12 },
      patterns: {},
    });
  });
});
