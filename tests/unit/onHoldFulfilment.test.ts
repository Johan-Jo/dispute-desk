/**
 * ON_HOLD is "nothing shipped", and the system must know it.
 *
 * ── WHAT WAS WRONG ────────────────────────────────────────────────────
 *
 * `displayFulfillmentStatus` has more members than FULFILLED and
 * UNFULFILLED. `ON_HOLD` — the state Shopify Flow leaves an order in when it
 * flags the risk but does not cancel — matched neither, so it fell through
 * every branch that reasons about fulfilment:
 *
 *   safe_to_claim_fulfilment   tested `!== "UNFULFILLED"`, so a held order
 *                              returned TRUE and the model was permitted to
 *                              write "fulfilled" / "shipped" / "dispatched"
 *                              with nothing behind it
 *   fatalLoss inr_no_fulfillment  required `=== "UNFULFILLED"`, so a held INR
 *                              order slipped a gate whose whole purpose is
 *                              "nothing shipped, there is no delivery
 *                              evidence to argue with"
 *
 * Measured on production 2026-08-13: six open blume-box disputes are
 * ON_HOLD, PAID, never cancelled and never refunded — $625 of goods that
 * never left the warehouse, scored as ordinary weak cases.
 *
 * The claim-guard hole is the serious half: a gate built to stop unsupported
 * issuer-facing claims was licensing one.
 */

import { describe, it, expect } from "vitest";
import { FACT_PREDICATES } from "@/lib/defence/factPredicates";
import { detectFatalLoss } from "@/lib/automation/fatalLoss";
import type { EvidenceFact } from "@/lib/defence/types";

function orderFact(fulfillmentStatus: string): EvidenceFact {
  return {
    id: "f-order",
    category: "order_record",
    label: "Order",
    source: "shopify_order",
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    value: { fulfillmentStatus },
  } as unknown as EvidenceFact;
}

const deliveredFact = {
  id: "f-del",
  category: "delivery_proof",
  label: "Delivery",
  source: "carrier",
  strength: "moderate",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  value: { proofType: "delivered_confirmed" },
} as unknown as EvidenceFact;

describe("safe_to_claim_fulfilment — the claim guard", () => {
  it("REFUSES a fulfilment claim on a held order with no delivery fact", () => {
    expect(FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([orderFact("ON_HOLD")])).toBe(false);
  });

  it("refuses it on an unfulfilled order too — unchanged", () => {
    expect(FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([orderFact("UNFULFILLED")])).toBe(
      false,
    );
  });

  it("allows it on a held order that DOES carry delivery proof", () => {
    /* Contradictory in practice, but the predicate's contract is "is there a
     * fact behind the claim" — and if a delivery is confirmed, there is. */
    expect(
      FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([orderFact("ON_HOLD"), deliveredFact]),
    ).toBe(true);
  });

  it("allows it on a fulfilled order — the ordinary case still works", () => {
    expect(FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([orderFact("FULFILLED")])).toBe(true);
  });

  it("allows it when there is no order_record at all", () => {
    expect(FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([])).toBe(true);
  });
});

describe("fulfilment_status_on_hold — the held state is addressable", () => {
  it("is true only for ON_HOLD", () => {
    expect(FACT_PREDICATES.fulfilment_status_on_hold.evaluate([orderFact("ON_HOLD")])).toBe(true);
    expect(FACT_PREDICATES.fulfilment_status_on_hold.evaluate([orderFact("UNFULFILLED")])).toBe(
      false,
    );
    expect(FACT_PREDICATES.fulfilment_status_on_hold.evaluate([orderFact("FULFILLED")])).toBe(
      false,
    );
    expect(FACT_PREDICATES.fulfilment_status_on_hold.evaluate([])).toBe(false);
  });

  it("does not disturb the two statuses that already had predicates", () => {
    expect(FACT_PREDICATES.fulfilment_status_unfulfilled.evaluate([orderFact("UNFULFILLED")])).toBe(
      true,
    );
    expect(FACT_PREDICATES.fulfilment_status_unfulfilled.evaluate([orderFact("ON_HOLD")])).toBe(
      false,
    );
    expect(FACT_PREDICATES.fulfilment_status_fulfilled.evaluate([orderFact("FULFILLED")])).toBe(
      true,
    );
  });
});

describe("fatal loss — an INR dispute on a held order is unwinnable", () => {
  const order = (status: string, fulfillments: unknown[] = []) =>
    ({
      displayFulfillmentStatus: status,
      fulfillments,
      totalRefundedSet: null,
    }) as never;

  it("triggers on ON_HOLD", () => {
    const v = detectFatalLoss(order("ON_HOLD"), "PRODUCT_NOT_RECEIVED", 104);
    expect(v.triggered).toBe(true);
    expect(v.reason).toBe("inr_no_fulfillment");
  });

  it("still triggers on UNFULFILLED — unchanged", () => {
    expect(detectFatalLoss(order("UNFULFILLED"), "PRODUCT_NOT_RECEIVED", 104).triggered).toBe(true);
  });

  it("does NOT trigger on a fulfilled order", () => {
    expect(detectFatalLoss(order("FULFILLED"), "PRODUCT_NOT_RECEIVED", 104).triggered).toBe(false);
  });

  it("does NOT trigger on a held order for a NON-INR reason", () => {
    /* The gate is scoped to item-not-received codes. A fraud claim on a held
     * order is weak, but it is not structurally unwinnable — AVS/CVV can
     * still carry it. */
    expect(detectFatalLoss(order("ON_HOLD"), "FRAUDULENT", 104).triggered).toBe(false);
  });

  it("does not trigger when the held order HAS a fulfillment record", () => {
    expect(
      detectFatalLoss(order("ON_HOLD", [{}]), "PRODUCT_NOT_RECEIVED", 104).triggered,
    ).toBe(false);
  });
});
