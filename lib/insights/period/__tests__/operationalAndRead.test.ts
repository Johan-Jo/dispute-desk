import { describe, expect, it, vi } from "vitest";

vi.mock("../computeShopMonth", () => ({ computeShopMonth: vi.fn() }));

import { computeShopMonth } from "../computeShopMonth";
import { computeOperationalMetrics } from "../computeOperationalMetrics";
import { readInsightsPeriod } from "../readInsightsPeriod";
import { formatCheckpointValues, formatRatio, formatMonth } from "../format";
import { winRateCounts } from "@/lib/disputes/winRate";

/** A PostgREST stand-in returning per-table rows, honouring `.in()` lists
 *  and the 1000-row page cap. */
function fakeSb(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const f: { in?: [string, unknown[]] } = {};
      let range: [number, number] | null = null;
      let single = false;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lt", "not", "is", "order"]) b[m] = () => b;
      b.in = (c: string, v: unknown[]) => { f.in = [c, v]; return b; };
      b.range = (a: number, z: number) => { range = [a, z]; return b; };
      b.maybeSingle = () => { single = true; return b; };
      b.then = (resolve: (r: unknown) => void) => {
        let rows = tables[table] ?? [];
        if (f.in) rows = rows.filter((r) => f.in![1].includes(r[f.in![0]]));
        if (single) return resolve({ data: rows[0] ?? null, error: null });
        const [a, z] = range ?? [0, 999];
        resolve({ data: rows.slice(a, Math.min(z + 1, a + 1000)), error: null });
      };
      return b;
    },
  } as never;
}

const order = (id: string, method: string | null, extra: Record<string, unknown> = {}) => ({
  shopify_order_id: id, payment_gateway: "shopify_payments", payment_method: method,
  three_ds_authenticated: null, processed_at: "2026-09-02T10:00:00Z", fulfilled_at: "2026-09-03T10:00:00Z",
  delivery_status: null, delivered_at_tracking: null, signed_by_name: null, financial_status: "PAID", ...extra,
});

describe("computeOperationalMetrics", () => {
  it("splits disputes by payment method and card brand, with rates from 50 orders", async () => {
    const orders = [
      ...Array.from({ length: 100 }, (_, i) => order(`p${i}`, "paypal")),
      ...Array.from({ length: 60 }, (_, i) => order(`v${i}`, "card")),
      ...Array.from({ length: 10 }, (_, i) => order(`a${i}`, "apple_pay")),
    ];
    const sb = fakeSb({
      shopify_orders: orders,
      disputes: [
        { phase: "chargeback", order_gid: "p1" }, { phase: "inquiry", order_gid: "p2" },
        { phase: "chargeback", order_gid: "v1" },
      ],
      shopify_order_risk_signals: [
        ...Array.from({ length: 60 }, (_, i) => ({ shopify_order_id: `v${i}`, card_brand: "Visa" })),
        ...Array.from({ length: 10 }, (_, i) => ({ shopify_order_id: `a${i}`, card_brand: "Mastercard" })),
      ],
      shopify_fulfillment_trackings: [],
      shop_fraud_daily_metrics: [],
    });
    const m = await computeOperationalMetrics(sb, "s", "2026-09-01");
    const paypal = m.byPaymentMethod.find((r) => r.method === "paypal")!;
    expect(paypal).toMatchObject({ brand: null, isCardNetwork: false, orders: 100, chargebacks: 1, inquiries: 1, chargebackRate: 0.01, disputeRate: 0.02 });
    const visa = m.byPaymentMethod.find((r) => r.method === "card")!;
    expect(visa).toMatchObject({ brand: "Visa", isCardNetwork: true, orders: 60, chargebacks: 1, chargebackRate: 0.01667 });
    const ap = m.byPaymentMethod.find((r) => r.method === "apple_pay")!;
    expect(ap.chargebackRate).toBeNull(); // 10 orders: below 50, no rate
    expect(m.byPaymentMethod[0]!.method).toBe("paypal"); // most disputes first
  });

  it("measures signatures only where a carrier lookup ran, and says — below 30", async () => {
    const delivered = Array.from({ length: 40 }, (_, i) =>
      order(`d${i}`, "card", { delivery_status: "Delivered", signed_by_name: i < 10 ? "J. Doe" : null }));
    const sb = fakeSb({
      shopify_orders: delivered, disputes: [], shopify_order_risk_signals: [], shop_fraud_daily_metrics: [],
      shopify_fulfillment_trackings: delivered.slice(0, 20).map((o) => ({ shopify_order_id: o.shopify_order_id })),
    });
    const m = await computeOperationalMetrics(sb, "s", "2026-09-01");
    expect(m.signedForEligible).toBe(20);
    expect(m.signedForShare).toBeNull();
  });

  // blume-box September 2026: ACTIVE $145,620 vs INACTIVE $120,294 → ~55%,
  // not the 100% the rollup's old denominator produced.
  it("measures Protect coverage against every order with a Protect status, INACTIVE included", async () => {
    const sb = fakeSb({
      shopify_orders: [
        order("x1", "card", { fraud_protection_level: "ACTIVE", order_total: 145620 }),
        order("x2", "card", { fraud_protection_level: "INACTIVE", order_total: 120294 }),
        order("x3", "paypal", { fraud_protection_level: null, order_total: 999 }),
      ],
      disputes: [], shopify_order_risk_signals: [], shopify_fulfillment_trackings: [],
      shop_fraud_daily_metrics: [{ orders_high: 4, orders_fulfilled_high_risk: 1 }],
    });
    const m = await computeOperationalMetrics(sb, "s", "2026-09-01");
    expect(m.protectShareByValue).toBe(0.54762);
    expect(m.highRiskFulfilledShare).toBe(0.25);
  });

  it("returns no Protect share for a shop with no Protect status on any order", async () => {
    const sb = fakeSb({ shopify_orders: [order("k1", "klarna", { fraud_protection_level: null, order_total: 500 })],
      disputes: [], shopify_order_risk_signals: [], shopify_fulfillment_trackings: [], shop_fraud_daily_metrics: [] });
    expect((await computeOperationalMetrics(sb, "s", "2026-09-01")).protectShareByValue).toBeNull();
  });
});

describe("readInsightsPeriod", () => {
  it("never recomputes a closed month: no complete record → not_available", async () => {
    const sb = fakeSb({ ratio_snapshots: [{ period_month: "2026-06-01", metrics_version: 2, operational_metrics: null, checkpoints: null }] });
    const p = await readInsightsPeriod(sb, "s", "2026-06-01", "closed");
    expect(p).toEqual({ status: "not_available", periodMonth: "2026-06-01" });
    expect(vi.mocked(computeShopMonth)).not.toHaveBeenCalled();
  });

  it("a partial-coverage month is not_fully_imported", async () => {
    const sb = fakeSb({ ratio_snapshots: [{ period_month: "2026-06-01", coverage: "partial", metrics_version: 3 }] });
    expect((await readInsightsPeriod(sb, "s", "2026-06-01", "closed")).status).toBe("not_fully_imported");
  });
});

describe("format", () => {
  it("formats raw checkpoint values per locale", () => {
    const v = formatCheckpointValues(
      { current: { value: 0.15, format: "pct2" }, month: { value: "2026-09-01", format: "month" }, n: 2 },
      "en",
    );
    expect(v).toEqual({ current: "0.15%", month: "September 2026", n: 2 });
    expect(formatRatio(0.00149, "de")).toBe("0,15 %");
    expect(formatMonth("2026-09-01", "sv")).toBe("september 2026");
  });
});

describe("winRateCounts", () => {
  it("counts accepted as a loss and returns null when nothing was decided", () => {
    expect(winRateCounts([{ final_outcome: "won" }, { final_outcome: "accepted" }, { final_outcome: "refunded" }]))
      .toMatchObject({ won: 1, decided: 2, ratePct: 50 });
    expect(winRateCounts([]).ratePct).toBeNull();
  });
});
