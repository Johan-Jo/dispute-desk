/**
 * The prior-chargeback finding must appear on the Evidence tab, and
 * must never appear on an unverified history.
 *
 * Reported on blume-box 162042cd (2026-08-01): Overview showed "this
 * customer has a history of chargebacks" and the Evidence tab showed
 * nothing. The Evidence tab builds its internal-signals card from a
 * fixed list of classifiers plus a sweep for payloads that literally
 * set `bankEligible: false`; the account-history row's bank exclusion
 * is decided downstream in `evidenceLineItem.isNegativeOrAmbiguous` and
 * never written back into the payload, so nothing caught it.
 */

import { describe, expect, it } from "vitest";
import { classifyPriorChargebacks } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";

function fakeT(key: string, params?: Record<string, string | number>): string {
  if (params) return `${key}:${JSON.stringify(params)}`;
  return key;
}

describe("classifyPriorChargebacks", () => {
  it("fires on a VERIFIED history with prior chargebacks", () => {
    const signal = classifyPriorChargebacks(
      { totalOrders: 9, priorUndisputedOrders: 5, disputeFreeHistory: false },
      fakeT,
    );
    expect(signal?.id).toBe("internal:prior_chargebacks");
    expect(signal?.title).toBe("internalSignals.priorChargebacks.title");
  });

  it("names the prior-order count when one is known", () => {
    const signal = classifyPriorChargebacks(
      { totalOrders: 9, priorUndisputedOrders: 5, disputeFreeHistory: false },
      fakeT,
    );
    // effectivePriorOrders prefers priorUndisputedOrders when present.
    expect(signal?.explanation).toBe(
      'internalSignals.priorChargebacks.explanationWithCount:{"prior":5}',
    );
  });

  it("stays silent on a VERIFIED clean history", () => {
    expect(
      classifyPriorChargebacks(
        { totalOrders: 9, priorUndisputedOrders: 8, disputeFreeHistory: true },
        fakeT,
      ),
    ).toBeNull();
  });

  it("stays silent on an UNVERIFIED history — absence is not an accusation", () => {
    // The pre-fix payload shape. `unknown` must never render as
    // "this customer has charged back before".
    expect(
      classifyPriorChargebacks({ totalOrders: 9, isRepeatCustomer: true }, fakeT),
    ).toBeNull();
    expect(classifyPriorChargebacks({}, fakeT)).toBeNull();
    expect(classifyPriorChargebacks(null, fakeT)).toBeNull();
  });
});
