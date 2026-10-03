import { describe, expect, it } from "vitest";

import { readTrend } from "../readTrend";

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
  it("sums chargebacks and orders over every payment method, inquiries left out", async () => {
    const [p] = await readTrend(sb([SEPTEMBER]), "s", ["2026-09-01"]);
    expect(p).toMatchObject({
      cardDisputeRatio: 0.00098,
      cardChargebackCount: 1,
      allChargebackCount: 50,
      allCardChargebackCount: 1,
      allOrderCount: 3754,
      allChargebackRate: 0.01332,
    });
  });

  it("has no all-method figures for a record without the payment-method split", async () => {
    const [p] = await readTrend(sb([{ ...SEPTEMBER, metrics_version: 2, operational_metrics: null }]), "s", ["2026-09-01"]);
    expect(p!.cardDisputeRatio).toBe(0.00098);
    expect(p!.allChargebackRate).toBeNull();
    expect(p!.allChargebackCount).toBeNull();
  });

  it("gives no rate, not zero, for a month without orders", async () => {
    const [p] = await readTrend(sb([{ ...SEPTEMBER, operational_metrics: { byPaymentMethod: [] } }]), "s", ["2026-09-01"]);
    expect(p!.allChargebackRate).toBeNull();
    expect(p!.allChargebackCount).toBe(0);
  });

  it("a month without a record is not available on both views", async () => {
    const [p] = await readTrend(sb([]), "s", ["2026-09-01"]);
    expect(p).toMatchObject({ periodState: "not_available", cardDisputeRatio: null, allChargebackRate: null });
  });
});
