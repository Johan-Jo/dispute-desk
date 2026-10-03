import { describe, expect, it } from "vitest";

import { readTrend, type TrendPoint } from "../readTrend";
import { hasAllMethods, trendBarValue } from "../trendScope";

const sb = (rows: Array<Record<string, unknown>>) =>
  ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => Promise.resolve({ data: rows, error: null });
      return b;
    },
  }) as never;

/** Mein Maison, September 2026: 1 card chargeback, 49 on PayPal. */
const SEPTEMBER = {
  period_month: "2026-09-01",
  stable_at: null,
  metrics_version: 4,
  card_dispute_ratio: 0.00098,
  card_chargeback_count: 1,
  settled_count: 1022,
  operational_metrics: {
    byPaymentMethod: [
      { method: "paypal", isCardNetwork: false, orders: 2717, chargebacks: 49, inquiries: 42 },
      { method: "card", isCardNetwork: true, orders: 331, chargebacks: 1, inquiries: 0 },
      { method: "klarna", isCardNetwork: false, orders: 706, chargebacks: 0, inquiries: 0 },
    ],
  },
};

describe("readTrend", () => {
  it("counts chargebacks and orders over every payment method, inquiries left out", async () => {
    const [p] = await readTrend(sb([SEPTEMBER]), "s", ["2026-09-01"]);
    expect(p).toMatchObject({
      cardDisputeRatio: 0.00098,
      cardChargebackCount: 1,
      allChargebackCount: 50,
      allCardChargebackCount: 1,
      allOrderCount: 3754,
    });
  });

  it("has no all-method figures for a record without the payment-method split", async () => {
    const [p] = await readTrend(sb([{ ...SEPTEMBER, metrics_version: 2, operational_metrics: null }]), "s", ["2026-09-01"]);
    expect(p!.cardDisputeRatio).toBe(0.00098);
    expect(p!.allChargebackCount).toBeNull();
    expect(p!.allOrderCount).toBeNull();
  });

  it("a month without a record is not available on both views", async () => {
    const [p] = await readTrend(sb([]), "s", ["2026-09-01"]);
    expect(p).toMatchObject({ periodState: "not_available", cardDisputeRatio: null, allChargebackCount: null });
  });
});

/**
 * The all-methods bar must never read below the card chargebacks it contains.
 *
 * The first version of this chart plotted a RATE (all chargebacks ÷ all
 * orders). For blume-box, whose chargebacks are all on cards, that drew
 * "All methods" at 0.09% under "Cards only" at 0.15% for the same 4
 * chargebacks, because it divided by more orders. Figures below are the
 * stored prod months of 2026-10-03: [card chargebacks, card orders, all
 * chargebacks, all orders].
 */
const BLUME_BOX: Array<[string, number, number, number, number]> = [
  ["2025-10-01", 5, 1799, 6, 2582],
  ["2025-11-01", 5, 3673, 5, 4731],
  ["2025-12-01", 7, 2392, 7, 3627],
  ["2026-01-01", 47, 3024, 48, 4323],
  ["2026-02-01", 23, 2168, 24, 3201],
  ["2026-03-01", 18, 2504, 18, 3391],
  ["2026-04-01", 44, 2069, 44, 2909],
  ["2026-05-01", 17, 2801, 17, 4349],
  ["2026-06-01", 22, 4789, 22, 7190],
  ["2026-07-01", 75, 3166, 75, 5311],
  ["2026-08-01", 7, 3274, 7, 4875],
  ["2026-09-01", 4, 2686, 4, 4465],
];
const MEIN_MAISON: Array<[string, number, number, number, number]> = [
  ["2026-05-01", 2, 1005, 26, 4561],
  ["2026-06-01", 6, 1326, 110, 5923],
  ["2026-07-01", 6, 1002, 136, 4432],
  ["2026-08-01", 2, 995, 83, 3790],
  ["2026-09-01", 1, 1022, 50, 3754],
];
const point = ([periodMonth, cardCb, cardOrders, allCb, allOrders]: [string, number, number, number, number]): TrendPoint => ({
  periodMonth,
  periodState: "final",
  cardDisputeRatio: cardCb / cardOrders,
  cardChargebackCount: cardCb,
  cardSettledCount: cardOrders,
  allChargebackCount: allCb,
  allCardChargebackCount: cardCb,
  allOrderCount: allOrders,
});

describe("trendBarValue", () => {
  for (const [shop, months] of [["blume-box (chargebacks all on cards)", BLUME_BOX], ["Mein Maison (PayPal-heavy)", MEIN_MAISON]] as const) {
    it(`all methods is never below the card chargebacks: ${shop}`, () => {
      for (const m of months) {
        const p = point(m);
        const all = trendBarValue(p, "all")!;
        expect(all, m[0]).toBeGreaterThanOrEqual(p.cardChargebackCount!);
        expect(all, m[0]).toBeGreaterThanOrEqual(p.allCardChargebackCount!);
        expect(all, m[0]).toBe(m[3]);
      }
    });
  }

  it("the rate it replaced did read below the card ratio for a card-only shop", () => {
    // Pins WHY the all-methods value is a count: this is the bug.
    const [, cardCb, cardOrders, allCb, allOrders] = BLUME_BOX[11]!;
    expect(allCb / allOrders).toBeLessThan(cardCb / cardOrders);
    expect(allCb).toBeGreaterThanOrEqual(cardCb);
  });

  it("cards only is the stored card ratio, untouched", () => {
    const p = point(BLUME_BOX[11]!);
    expect(trendBarValue(p, "cards")).toBe(p.cardDisputeRatio);
  });

  it("a month without the all-method figures has no all-methods value, not zero", () => {
    const p: TrendPoint = { periodMonth: "2026-09-01", periodState: "final", cardDisputeRatio: 0.001, cardChargebackCount: 1, cardSettledCount: 1000 };
    expect(trendBarValue(p, "all")).toBeNull();
    expect(hasAllMethods([p])).toBe(false);
    expect(hasAllMethods([p, point(BLUME_BOX[0]!)])).toBe(true);
  });
});

describe("readTrend — what the chart may show", () => {
  it("gives a partially imported month no all-method count (it would be a fraction of a month)", async () => {
    const [p] = await readTrend(sb([{ ...SEPTEMBER, coverage: "partial" }]), "s", ["2026-09-01"]);
    expect(p!.allChargebackCount).toBeNull();
    expect(trendBarValue(p!, "all")).toBeNull();
  });

  it("agrees with the other surfaces of the same stored record (Mein Maison, September 2026)", async () => {
    // The real prod record: the chart, the payment-method table and the
    // card-network block are three readings of one row and must not differ.
    const fixture = (await import("./fixtures/meinmaison-2026-09.json")).default as unknown as {
      programme: { cardChargebackCount: number; cardSettledCount: number; cardDisputeRatio: number };
      operational: { byPaymentMethod: Array<{ isCardNetwork: boolean; orders: number; chargebacks: number; inquiries: number }> };
    };
    const [p] = await readTrend(
      sb([
        {
          period_month: "2026-09-01",
          stable_at: null,
          metrics_version: 3,
          coverage: "full",
          card_dispute_ratio: fixture.programme.cardDisputeRatio,
          card_chargeback_count: fixture.programme.cardChargebackCount,
          settled_count: fixture.programme.cardSettledCount,
          operational_metrics: fixture.operational,
        },
      ]),
      "s",
      ["2026-09-01"],
    );
    const table = fixture.operational.byPaymentMethod;
    // Chart (all methods) == the table's chargeback column, summed.
    expect(p!.allChargebackCount).toBe(table.reduce((n, r) => n + r.chargebacks, 0));
    expect(p!.allOrderCount).toBe(table.reduce((n, r) => n + r.orders, 0));
    // The card part of the chart == the card-network block's count.
    expect(p!.allCardChargebackCount).toBe(fixture.programme.cardChargebackCount);
    // All methods is never below cards only.
    expect(trendBarValue(p!, "all")!).toBeGreaterThanOrEqual(p!.cardChargebackCount!);
  });
});
