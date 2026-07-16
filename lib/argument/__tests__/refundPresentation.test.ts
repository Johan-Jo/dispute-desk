import { describe, it, expect } from "vitest";
import { buildRefundPresentation } from "@/lib/argument/refundPresentation";

/** Pins the fact-stating refund card (live complaint, cay cc86296d
 *  2026-07-16: "Refund status · Strong" answered nothing — was it
 *  refunded or not?). */
describe("buildRefundPresentation", () => {
  it("refund issued: title + amount/currency/date facts (the cc86296d shape)", () => {
    const p = buildRefundPresentation({
      refundStatus: "processed",
      amount: "249.00",
      currency: "SEK",
      refundedAt: "2026-06-12T09:00:00Z",
    });
    expect(p?.titleToken).toEqual({ key: "disputes.refundStatus.titleIssued" });
    expect(p?.factsTokens).toEqual([
      {
        key: "disputes.refundStatus.factsIssued",
        params: { amount: "249.00", currency: "SEK", date: "Jun 12" },
      },
    ]);
  });

  it("refund issued without a date still states the amount", () => {
    const p = buildRefundPresentation({
      refundStatus: "processed",
      amount: "10.00",
      currency: "USD",
      refundedAt: null,
    });
    expect(p?.factsTokens[0]).toMatchObject({
      key: "disputes.refundStatus.factsIssuedNoDate",
      params: { amount: "10.00", currency: "USD" },
    });
  });

  it("no return initiated: 'No refund issued' + the no-return basis", () => {
    const p = buildRefundPresentation({ returnStatus: "NO_RETURN" });
    expect(p?.titleToken).toEqual({ key: "disputes.refundStatus.titleNone" });
    expect(p?.factsTokens).toEqual([{ key: "disputes.refundStatus.factsNoReturn" }]);
  });

  it("refund section with nothing refunded: 'No refund issued'", () => {
    expect(buildRefundPresentation({ refundStatus: "none" })?.titleToken).toEqual({
      key: "disputes.refundStatus.titleNone",
    });
  });

  it("unknown payloads fall back to the generic label (null)", () => {
    expect(buildRefundPresentation(null)).toBeNull();
    expect(buildRefundPresentation({})).toBeNull();
    expect(buildRefundPresentation({ something: true })).toBeNull();
  });
});
