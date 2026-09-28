/**
 * Qualified final delivery (non-receipt plan §6.1.1–§6.1.4, P1b).
 *
 * Two halves, pinned together:
 *   - the collector decides whether a shipment set is a QFD
 *     (`resolveFinalDeliveryVerified`, all five conditions), and
 *   - the item-not-received rollup rates a QFD case `strong` while its
 *     pre-revision rating (`overallBeforeRev5`) is not `strong`, so the
 *     decision ladder holds the filing date (`strength_upgraded_timing_held`)
 *     until §11 Q-7 is decided.
 *
 * Regression fixture: cay #14784 (Case B). PostNord DELIVERED 2026-09-18
 * 16:23Z, one fulfillment, one unit — but the event is `shopify_native` and
 * there is no PostNord adapter, so condition 1 fails and it stays moderate.
 */
import { describe, it, expect } from "vitest";
import { calculateCaseStrength } from "@/lib/argument/caseStrength";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";
import {
  resolveFinalDeliveryVerified,
  type FulfillmentDeliveryState,
} from "@/lib/packs/sources/fulfillmentSource";

/* ── collector ─────────────────────────────────────────────────────── */

type F = Parameters<typeof resolveFinalDeliveryVerified>[0]["fulfillments"][number];

function ful(id: string, qty: number, tracking = { company: "DHL Express", number: "1234567890" }): F {
  return {
    id,
    trackingInfo: [{ ...tracking, url: null }],
    fulfillmentLineItems: { edges: [{ node: { quantity: qty } }] },
  } as unknown as F;
}

function order(fulfillments: F[], orderedQty: number | null) {
  return {
    fulfillments,
    lineItems:
      orderedQty == null
        ? { edges: [] }
        : { edges: [{ node: { quantity: orderedQty } }] },
  } as unknown as Parameters<typeof resolveFinalDeliveryVerified>[0];
}

const CARRIER_DELIVERED = { status: "Delivered", at: "2026-09-18T16:23:00Z", source: "carrier_api_dhl" } as const;

function state(over: Partial<FulfillmentDeliveryState> = {}, signal: unknown = CARRIER_DELIVERED): FulfillmentDeliveryState {
  return {
    current: signal as FulfillmentDeliveryState["current"],
    conflict: false,
    signedBy: null,
    carrier: signal
      ? ({ fulfillmentId: "x", carrier: "dhl", signal, lookupStatus: "success", podName: null, returnReason: null } as unknown as FulfillmentDeliveryState["carrier"])
      : null,
    ...over,
  };
}

describe("resolveFinalDeliveryVerified — the five conditions", () => {
  it("our own carrier lookup, dated, agreed, parcel id, full coverage → QFD", () => {
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state()]]))).toBe(true);
  });

  it("a completed collection counts as a final delivery", () => {
    const sig = { ...CARRIER_DELIVERED, status: "CollectedAtPickup" };
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state({}, sig)]]))).toBe(true);
  });

  it("Case B (cay #14784): shopify_native PostNord DELIVERED with no adapter → NOT a QFD (condition 1)", () => {
    const native = { status: "Delivered", at: "2026-09-18T16:23:00Z", source: "shopify_native" };
    const s = state({ current: native as FulfillmentDeliveryState["current"], carrier: null }, null);
    expect(
      resolveFinalDeliveryVerified(
        order([ful("f1", 1, { company: "PostNord SE", number: "00573132901924649740" })], 1),
        new Map([["f1", s]]),
      ),
    ).toBe(false);
  });

  it("a tracking-app source is not corroborated carrier provenance (condition 1)", () => {
    const sig = { ...CARRIER_DELIVERED, source: "tracking_app_parcelpanel" };
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state({}, sig)]]))).toBe(false);
  });

  it("available for collection is never a final delivery", () => {
    const sig = { ...CARRIER_DELIVERED, status: "DeliveredToPickup" };
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state({}, sig)]]))).toBe(false);
  });

  it("an undated carrier event does not qualify (condition 2)", () => {
    const sig = { ...CARRIER_DELIVERED, at: null };
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state({}, sig)]]))).toBe(false);
  });

  it("a batch reference is not a parcel identifier (condition 3)", () => {
    const f = ful("f1", 1, { company: "USPS", number: "260914OET4" });
    expect(resolveFinalDeliveryVerified(order([f], 1), new Map([["f1", state()]]))).toBe(false);
  });

  it("coverage: the qualifying shipments must carry every ordered unit (condition 4)", () => {
    // Two units ordered, only one on the qualifying parcel.
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], 2), new Map([["f1", state()]]))).toBe(false);
    // A second, non-qualifying (shopify_native) delivered parcel does not fill the gap.
    const native = { status: "Delivered", at: "2026-09-19T10:00:00Z", source: "shopify_native" };
    const s2 = state({ current: native as FulfillmentDeliveryState["current"], carrier: null }, null);
    expect(
      resolveFinalDeliveryVerified(order([ful("f1", 1), ful("f2", 1)], 2), new Map([["f1", state()], ["f2", s2]])),
    ).toBe(false);
    // Both parcels qualifying → covered.
    expect(
      resolveFinalDeliveryVerified(order([ful("f1", 1), ful("f2", 1)], 2), new Map([["f1", state()], ["f2", state()]])),
    ).toBe(true);
  });

  it("unknown coverage (no line items) never qualifies", () => {
    expect(resolveFinalDeliveryVerified(order([ful("f1", 1)], null), new Map([["f1", state()]]))).toBe(false);
  });

  it("a source conflict or a newer contrary state withholds it (condition 5)", () => {
    expect(
      resolveFinalDeliveryVerified(order([ful("f1", 1)], 1), new Map([["f1", state({ conflict: true })]])),
    ).toBe(false);
    const newerReturn = { status: "Returned", at: "2026-09-20T10:00:00Z", source: "shopify_native" };
    expect(
      resolveFinalDeliveryVerified(
        order([ful("f1", 1)], 1),
        new Map([["f1", state({ current: newerReturn as FulfillmentDeliveryState["current"] })]]),
      ),
    ).toBe(false);
  });

  it("a returned shipment anywhere on the order withholds it", () => {
    const returned = { status: "Returned", at: "2026-09-20T10:00:00Z", source: "carrier_api_dhl" };
    expect(
      resolveFinalDeliveryVerified(
        order([ful("f1", 1), ful("f2", 1)], 1),
        new Map([["f1", state()], ["f2", state({}, returned)]]),
      ),
    ).toBe(false);
  });
});

/* ── rollup + timing ───────────────────────────────────────────────── */

function byField(map: Record<string, Record<string, unknown>>): EvidencePayloadSource {
  const obj: Record<string, { payload: Record<string, unknown> }> = {};
  for (const [k, v] of Object.entries(map)) obj[k] = { payload: v };
  return { kind: "byField", map: obj };
}
const available = (field: string): ChecklistItemV2 =>
  ({ field, status: "available" }) as unknown as ChecklistItemV2;

const QFD = {
  proofType: "delivered_confirmed",
  deliveredAt: "2026-09-18T16:23:00Z",
  deliveryCoverage: "complete",
  finalDeliveryVerified: true,
};

function rate(payload: Record<string, unknown>, reason = "PRODUCT_NOT_RECEIVED", extra: Record<string, Record<string, unknown>> = {}) {
  const fields = ["shipping_tracking", "delivery_proof", ...Object.keys(extra)];
  return calculateCaseStrength(
    fields.map(available),
    reason,
    byField({ shipping_tracking: payload, delivery_proof: payload, ...extra }),
    NO_GATES,
  );
}

describe("item-not-received rollup with a qualified final delivery", () => {
  it("QFD alone → STRONG; the pre-revision rating is not strong (so the filing date is held)", () => {
    const r = rate(QFD);
    expect(r.overall).toBe("strong");
    // Pre-rev-5 rollup over pre-rev-5 grades: a plain carrier-confirmed
    // delivery on its own rated weak.
    expect(r.overallBeforeRev5).toBe("weak");
    expect(r.strongCount).toBe(1);
    expect(r.strengthReasonI18n.key).toMatch(/strengthReason\.delivery\.strong|strong/);
  });

  it("the same delivery without the flag stays MODERATE (Case B today)", () => {
    const { finalDeliveryVerified: _drop, ...plain } = QFD;
    const r = rate(plain);
    expect(r.overall).toBe("moderate");
  });

  it.each(["partial", "unknown", "none"])("a flag on %s coverage does not lift the case", (deliveryCoverage) => {
    expect(rate({ ...QFD, deliveryCoverage }).overall).toBe("moderate");
  });

  it("the flag lifts only a carrier-confirmed delivery, never an unverified one", () => {
    expect(rate({ ...QFD, proofType: "delivered_unverified" }).overall).toBe("weak");
  });

  it("QFD + another strong signal: before-rev-5 re-grades the QFD first, so it is NOT 'already strong'", () => {
    const r = rate(QFD, "PRODUCT_NOT_RECEIVED", {
      customer_communication: { customerConfirmsOrder: true },
    });
    expect(r.overall).toBe("strong");
    expect(r.strongCount).toBe(2);
    expect(r.overallBeforeRev5).toBe("moderate");
  });

  it("other families are not lifted by the flag (fraud stays on its own rollup)", () => {
    const { finalDeliveryVerified: _drop, ...plain } = QFD;
    const withFlag = rate(QFD, "FRAUDULENT");
    const without = rate(plain, "FRAUDULENT");
    expect(withFlag.overall).toBe(without.overall);
    expect(withFlag.strongCount).toBe(without.strongCount);
  });

  /* The ladder's reading of (overall = strong, overallBeforeRev5 = moderate)
   * → hold_for_deadline / strength_upgraded_timing_held is pinned in
   * lib/automation/decision/__tests__/decisionLadder.test.ts; this file pins
   * that a QFD produces that pair. */
});
