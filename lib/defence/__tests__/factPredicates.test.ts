import { describe, it, expect } from "vitest";
import {
  FACT_PREDICATES,
  evaluateAllPredicates,
} from "../factPredicates";
import type { EvidenceFact, FactPredicateId } from "../types";

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "payment authentication",
    value: {},
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...overrides,
  };
}

describe("factPredicates", () => {
  describe("delivery_confirmed", () => {
    // The fulfillment collector writes the canonical 4-state
    // DeliveryProofType vocabulary (delivered_confirmed /
    // signature_confirmed / delivered_unverified / label_created).
    // Regression for dispute 328a45e4 (2026-07): the predicate only
    // matched the bare 'delivered'/'signature' values, which real pack
    // data never carries, so carrier-confirmed delivery could never
    // ground a delivery claim and narrative validation always failed.
    it("true when delivery_proof with proofType=delivered_confirmed (collector vocabulary)", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
        ]),
      ).toBe(true);
    });
    it("true when shipping_tracking with proofType=signature_confirmed (collector vocabulary)", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "shipping_tracking", value: { proofType: "signature_confirmed" } }),
        ]),
      ).toBe(true);
    });
    it("true when delivery_proof with legacy proofType=delivered", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
        ]),
      ).toBe(true);
    });
    it("true when shipping_tracking with legacy proofType=signature", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "shipping_tracking", value: { proofType: "signature" } }),
        ]),
      ).toBe(true);
    });
    it("false on proofType=delivered_unverified (carrier never confirmed)", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "delivered_unverified" } }),
        ]),
      ).toBe(false);
    });
    it("false on proofType=label_created", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "label_created" } }),
        ]),
      ).toBe(false);
    });
    it("false when proofType missing", () => {
      expect(
        FACT_PREDICATES.delivery_confirmed.evaluate([
          fact({ category: "delivery_proof", value: {} }),
        ]),
      ).toBe(false);
    });
  });

  describe("signature_captured", () => {
    it("true on proofType=signature_confirmed (collector vocabulary)", () => {
      expect(
        FACT_PREDICATES.signature_captured.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "signature_confirmed" } }),
        ]),
      ).toBe(true);
    });
    it("true on legacy proofType=signature", () => {
      expect(
        FACT_PREDICATES.signature_captured.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "signature" } }),
        ]),
      ).toBe(true);
    });
    it("false on proofType=delivered_confirmed", () => {
      expect(
        FACT_PREDICATES.signature_captured.evaluate([
          fact({ category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
        ]),
      ).toBe(false);
    });
  });

  describe("digital_access_used", () => {
    it("true on digital_access_log with digitalAccessUsed=true", () => {
      expect(
        FACT_PREDICATES.digital_access_used.evaluate([
          fact({ category: "digital_access_log", value: { digitalAccessUsed: true } }),
        ]),
      ).toBe(true);
    });
    it("false on digital_access_log with digitalAccessGranted only", () => {
      expect(
        FACT_PREDICATES.digital_access_used.evaluate([
          fact({ category: "digital_access_log", value: { digitalAccessGranted: true } }),
        ]),
      ).toBe(false);
    });
  });

  describe("three_d_secure_present", () => {
    it("true on payment_authentication with threeDS=true", () => {
      expect(
        FACT_PREDICATES.three_d_secure_present.evaluate([
          fact({ value: { threeDS: true } }),
        ]),
      ).toBe(true);
    });
    it("false on payment_authentication without threeDS", () => {
      expect(
        FACT_PREDICATES.three_d_secure_present.evaluate([
          fact({ value: { avsResult: "Y" } }),
        ]),
      ).toBe(false);
    });
  });

  describe("liability_shift_present", () => {
    it("true on payment_authentication with liabilityShift=true", () => {
      expect(
        FACT_PREDICATES.liability_shift_present.evaluate([
          fact({ value: { liabilityShift: true } }),
        ]),
      ).toBe(true);
    });
  });

  describe("avs_and_cvv_match", () => {
    it("true on AVS=Y + CVV=M", () => {
      expect(
        FACT_PREDICATES.avs_and_cvv_match.evaluate([
          fact({ value: { avsResult: "Y", cvvResult: "M" } }),
        ]),
      ).toBe(true);
    });
    it("false on AVS=Y only", () => {
      expect(
        FACT_PREDICATES.avs_and_cvv_match.evaluate([
          fact({ value: { avsResult: "Y" } }),
        ]),
      ).toBe(false);
    });
    it("false on AVS=N + CVV=N", () => {
      expect(
        FACT_PREDICATES.avs_and_cvv_match.evaluate([
          fact({ value: { avsResult: "N", cvvResult: "N" } }),
        ]),
      ).toBe(false);
    });
  });

  describe("avs_or_cvv_value_present", () => {
    it("true when any avsResult is present", () => {
      expect(
        FACT_PREDICATES.avs_or_cvv_value_present.evaluate([
          fact({ value: { avsResult: "N" } }),
        ]),
      ).toBe(true);
    });
    it("false on payment_auth without AVS/CVV", () => {
      expect(
        FACT_PREDICATES.avs_or_cvv_value_present.evaluate([
          fact({ value: {} }),
        ]),
      ).toBe(false);
    });
  });

  describe("prior_customer", () => {
    it("true when priorOrderCount > 0", () => {
      expect(
        FACT_PREDICATES.prior_customer.evaluate([
          fact({ category: "prior_customer_history", value: { priorOrderCount: 1 } }),
        ]),
      ).toBe(true);
    });
    it("false when priorOrderCount = 0", () => {
      expect(
        FACT_PREDICATES.prior_customer.evaluate([
          fact({ category: "prior_customer_history", value: { priorOrderCount: 0 } }),
        ]),
      ).toBe(false);
    });
    it("false when no prior_customer_history fact", () => {
      expect(FACT_PREDICATES.prior_customer.evaluate([fact()])).toBe(false);
    });
  });

  describe("refund_processed", () => {
    it("true on refund_record with refundStatus=processed", () => {
      expect(
        FACT_PREDICATES.refund_processed.evaluate([
          fact({ category: "refund_record", value: { refundStatus: "processed" } }),
        ]),
      ).toBe(true);
    });
    it("false on refund_record with refundStatus=pending", () => {
      expect(
        FACT_PREDICATES.refund_processed.evaluate([
          fact({ category: "refund_record", value: { refundStatus: "pending" } }),
        ]),
      ).toBe(false);
    });
  });

  describe("policy_accepted", () => {
    it("true with acceptedAtCheckout=true", () => {
      expect(
        FACT_PREDICATES.policy_accepted.evaluate([
          fact({ category: "policy_acceptance", value: { acceptedAtCheckout: true } }),
        ]),
      ).toBe(true);
    });
    it("true with bare policy_acceptance category (presence-only)", () => {
      expect(
        FACT_PREDICATES.policy_accepted.evaluate([
          fact({ category: "policy_acceptance", value: {} }),
        ]),
      ).toBe(true);
    });
    it("false without policy_acceptance fact", () => {
      expect(FACT_PREDICATES.policy_accepted.evaluate([fact()])).toBe(false);
    });
  });

  describe("policy_disclosed", () => {
    it("true on policy_refund fact", () => {
      expect(
        FACT_PREDICATES.policy_disclosed.evaluate([
          fact({ category: "policy_refund", value: {} }),
        ]),
      ).toBe(true);
    });
    it("false with only policy_acceptance (no disclosure category)", () => {
      expect(
        FACT_PREDICATES.policy_disclosed.evaluate([
          fact({ category: "policy_acceptance", value: {} }),
        ]),
      ).toBe(false);
    });
  });

  describe("customer_communication_on_record", () => {
    it("true on customer_communication fact", () => {
      expect(
        FACT_PREDICATES.customer_communication_on_record.evaluate([
          fact({ category: "customer_communication", value: {} }),
        ]),
      ).toBe(true);
    });
    it("false without communication-class fact", () => {
      expect(FACT_PREDICATES.customer_communication_on_record.evaluate([fact()])).toBe(false);
    });
  });

  describe("is_card_absent_dispute", () => {
    it("true when payment_authentication fact exists", () => {
      expect(FACT_PREDICATES.is_card_absent_dispute.evaluate([fact()])).toBe(true);
    });
    it("false when no payment_auth fact", () => {
      expect(
        FACT_PREDICATES.is_card_absent_dispute.evaluate([
          fact({ category: "order_record", value: {} }),
        ]),
      ).toBe(false);
    });
  });

  describe("fulfilment_status predicates", () => {
    it("fulfilment_status_fulfilled true when order_record.fulfillmentStatus=FULFILLED", () => {
      expect(
        FACT_PREDICATES.fulfilment_status_fulfilled.evaluate([
          fact({ category: "order_record", value: { fulfillmentStatus: "FULFILLED" } }),
        ]),
      ).toBe(true);
    });
    it("fulfilment_status_unfulfilled true when UNFULFILLED", () => {
      expect(
        FACT_PREDICATES.fulfilment_status_unfulfilled.evaluate([
          fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
        ]),
      ).toBe(true);
    });
  });

  describe("safe_to_claim_fulfilment", () => {
    it("true when no order_record fact", () => {
      expect(FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([fact()])).toBe(true);
    });
    it("true when FULFILLED", () => {
      expect(
        FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([
          fact({ category: "order_record", value: { fulfillmentStatus: "FULFILLED" } }),
        ]),
      ).toBe(true);
    });
    it("false when UNFULFILLED and no delivery/access fact", () => {
      expect(
        FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([
          fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
        ]),
      ).toBe(false);
    });
    it("true when UNFULFILLED and digitalAccessUsed=true", () => {
      expect(
        FACT_PREDICATES.safe_to_claim_fulfilment.evaluate([
          fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
          fact({ id: "f1", category: "digital_access_log", value: { digitalAccessUsed: true } }),
        ]),
      ).toBe(true);
    });
  });

  describe("evaluateAllPredicates", () => {
    it("returns a total map over all predicate ids", () => {
      const result = evaluateAllPredicates([]);
      const expectedIds = Object.keys(FACT_PREDICATES) as FactPredicateId[];
      for (const id of expectedIds) {
        expect(typeof result[id]).toBe("boolean");
      }
    });

    it("all-false for empty facts (except is_card_absent_dispute / safe_to_claim_fulfilment which are presence-based)", () => {
      const result = evaluateAllPredicates([]);
      // safe_to_claim_fulfilment is true when there's no order_record
      // (no UNFULFILLED to worry about).
      expect(result.safe_to_claim_fulfilment).toBe(true);
      expect(result.is_card_absent_dispute).toBe(false);
      expect(result.delivery_confirmed).toBe(false);
      expect(result.three_d_secure_present).toBe(false);
    });
  });

  describe("transaction_channel_online_present (v2.2+)", () => {
    function orderRecord(channel: unknown): EvidenceFact {
      return fact({
        id: "fc",
        category: "order_record",
        label: "Order record",
        value: { channel, fieldKey: "order_confirmation" },
      });
    }

    it("true when order_record.value.channel === 'web'", () => {
      expect(
        FACT_PREDICATES.transaction_channel_online_present.evaluate([orderRecord("web")]),
      ).toBe(true);
    });

    it.each(["android", "iphone", "WEB"])(
      "true for known online channel %s (case-insensitive)",
      (ch) => {
        expect(
          FACT_PREDICATES.transaction_channel_online_present.evaluate([orderRecord(ch)]),
        ).toBe(true);
      },
    );

    it("false when channel='pos' (in-store, not online)", () => {
      expect(
        FACT_PREDICATES.transaction_channel_online_present.evaluate([orderRecord("pos")]),
      ).toBe(false);
    });

    it("false when channel='shopify_draft_order'", () => {
      expect(
        FACT_PREDICATES.transaction_channel_online_present.evaluate([
          orderRecord("shopify_draft_order"),
        ]),
      ).toBe(false);
    });

    it("false when no order_record fact exists", () => {
      expect(
        FACT_PREDICATES.transaction_channel_online_present.evaluate([fact()]),
      ).toBe(false);
    });

    it("false when order_record present but channel is null", () => {
      expect(
        FACT_PREDICATES.transaction_channel_online_present.evaluate([orderRecord(null)]),
      ).toBe(false);
    });
  });
});
