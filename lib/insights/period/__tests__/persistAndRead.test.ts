import { describe, expect, it, vi } from "vitest";
import type { ProgrammeBlock } from "../computeProgrammeBlock";
import { monthPayload, persistShopMonth, METRICS_VERSION } from "../persistShopMonth";
import { rowToProgrammeMonth } from "../readProgrammeMonth";
import { driftIsMaterial } from "../driftIsMaterial";
import { THRESHOLDS_VERSION } from "@/lib/insights/programmeThresholds";

/** blume-box September 2026 (prod, 2026-10-02). */
const sep: ProgrammeBlock = {
  periodMonth: "2026-09-01",
  cardSettledCount: 2686,
  cardSettledPrevCount: 3274,
  unknownSettledCount: 1282,
  cardChargebackCount: 4,
  cardFraudChargebackCount: 3,
  visaChargebackCount: 2,
  mcChargebackCount: 2,
  mcFraudChargebackCount: 1,
  unknownNetworkChargebackCount: 0,
  unresolvedRailDisputeCount: 0,
  ce30ExcludedCount: 0,
  fptExcludedCount: 0,
  revenueRecoveredUsd: 0,
  cardDisputeRatio: 0.00149,
  vampRatioCalculated: 0.00149,
  vampRatioWithoutDd: 0.00149,
  ecmRatio: 0.00061,
  ecmIsLowerBound: true,
  vampFloorMet: false,
  ecmFloorMet: false,
  vampSeverity: "healthy",
  ecmSeverity: "healthy",
  cardDisputeShare: 1,
  cardFramingApplies: true,
  unknownPaymentShare: 0.32308,
};
const op = {
  threeDsShare: 0.00073, threeDsOrders: 2, threeDsEligible: 2728,
  signedForShare: null, signedForOrders: 0, signedForEligible: 0,
  protectShareByValue: null, protectedValue: 0, protectEligibleValue: 0, highRiskFulfilledShare: null,
  medianFulfillmentHours: 40.4, winRate: 0.15152, wonCount: 5, decidedCount: 33, byPaymentMethod: [],
};
const month = { programme: sep, operational: op, checkpoints: [] };
const blume = {
  historical_import_status: "complete",
  historical_import_completed_at: "2026-07-21T00:00:00Z",
  historical_import_since_date: "2010-01-01",
};

describe("persistShopMonth", () => {
  it("writes only through the persist_shop_month RPC, with stability from the rule", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, revision: 1, stable_at: null }, error: null });
    const from = vi.fn();
    await persistShopMonth({ rpc, from } as never, {
      shopId: "s", shop: blume, month: "2026-09-01", data: month, reason: "nightly",
      now: new Date("2026-10-02T02:00:00Z"),
    });
    expect(from).not.toHaveBeenCalled();
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("persist_shop_month");
    expect(args.p_mark_stable).toBe(false);
    expect(args.p_metrics_version).toBe(METRICS_VERSION);
    expect(args.p_thresholds_version).toBe(THRESHOLDS_VERSION);
    expect(args.p_values.card_dispute_ratio).toBe(0.00149);
    expect(args.p_values.coverage).toBe("full");
    expect(args.p_values.operational_metrics).toEqual(op);
    expect(args.p_values.checkpoints).toEqual([]);

    await persistShopMonth({ rpc, from } as never, {
      shopId: "s", shop: blume, month: "2026-09-01", data: month, reason: "nightly",
      now: new Date("2026-10-08T02:00:00Z"),
    });
    expect(rpc.mock.calls[1]![1].p_mark_stable).toBe(true);
  });

  it("throws on an RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(
      persistShopMonth({ rpc } as never, { shopId: "s", shop: blume, month: "2026-09-01", data: month, reason: "x", now: new Date() }),
    ).rejects.toThrow(/nope/);
  });
});

describe("row ⇄ payload", () => {
  it("a stored row reads back as the block it was written from", () => {
    const stored = { period_month: "2026-09-01", ...monthPayload(month, "full"), stable_at: "2026-10-08T02:00:00Z", metrics_version: 3 };
    const back = rowToProgrammeMonth(stored);
    expect(back.status).toBe("ok");
    if (back.status !== "ok") return;
    expect(back.periodState).toBe("final");
    for (const k of Object.keys(sep) as Array<keyof ProgrammeBlock>) {
      expect([k, back[k]]).toEqual([k, sep[k]]);
    }
  });

  it("a row without stable_at is provisional", () => {
    const back = rowToProgrammeMonth({ period_month: "2026-09-01", ...monthPayload(month, "full"), stable_at: null });
    expect(back.status === "ok" && back.periodState).toBe("provisional");
  });
});

describe("driftIsMaterial", () => {
  const stored = {
    card_chargeback_count: 7, visa_chargeback_count: 1, mc_chargeback_count: 6,
    card_dispute_ratio: 0.00214, mc_ecm_ratio: 0.0019, card_framing_applies: true,
  };
  const aug = { ...sep, cardChargebackCount: 7, visaChargebackCount: 1, mcChargebackCount: 6, cardDisputeRatio: 0.00214, ecmRatio: 0.0019 };

  it("ignores denominator churn below display precision (7/3,274 → 7/3,276, still 0.21%)", () => {
    expect(driftIsMaterial(stored, { ...aug, cardDisputeRatio: 0.00214, cardSettledCount: 3276 })).toBe(false);
    expect(driftIsMaterial(stored, { ...aug, cardDisputeRatio: 0.00213 })).toBe(false);
  });

  it("revises on a new chargeback", () => {
    expect(driftIsMaterial(stored, { ...aug, cardChargebackCount: 8, mcChargebackCount: 7, cardDisputeRatio: 0.00244 })).toBe(true);
  });

  it("revises when the shown percentage changes (0.21% → 0.22%)", () => {
    expect(driftIsMaterial(stored, { ...aug, cardDisputeRatio: 0.00216 })).toBe(true);
  });
});
