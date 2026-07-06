/**
 * Pins the fulfillment-row presentation: the two delivery field keys
 * (`shipping_tracking` / `delivery_proof`) must render as DISTINCT,
 * proof-state-specific rows — never two generic "Delivery confirmation"
 * rows.
 *
 * Regression guard for the 2026-07-06 fix: prod dispute #12936
 * (PRODUCT_NOT_RECEIVED, PostNord tracked, carrier NOT_DELIVERED,
 * proofType `delivered_unverified`) was showing "Delivery confirmation"
 * twice — overclaiming delivery on an item-not-received case.
 */

import { describe, it, expect } from "vitest";
import {
  resolveProofType,
  deliveryLabelKey,
  deliveryWhyKey,
  buildDeliveryFacts,
} from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";

// The verified prod payload shape for dispute #12936.
const UNVERIFIED_PAYLOAD = {
  proofType: "delivered_unverified",
  deliveredAt: null,
  signedByName: null,
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "NOT_DELIVERED",
      createdAt: "2026-06-07T14:39:06Z",
      deliveredAt: null,
      estimatedDeliveryAt: "2026-06-09T18:00:00Z",
      tracking: [
        {
          url: "https://tracking.postnord.com/se/?id=00573132901672098616",
          number: "00573132901672098616",
          carrier: "PostNord SE",
        },
      ],
    },
  ],
};

describe("delivery evidence rows — proofType resolution", () => {
  it("reads the collector's proofType discriminator", () => {
    expect(resolveProofType(UNVERIFIED_PAYLOAD)).toBe("delivered_unverified");
    expect(resolveProofType({ proofType: "signature_confirmed" })).toBe(
      "signature_confirmed",
    );
    expect(resolveProofType({ proofType: "delivered_confirmed" })).toBe(
      "delivered_confirmed",
    );
  });

  it("defaults to label_created on missing/garbage payload", () => {
    expect(resolveProofType(null)).toBe("label_created");
    expect(resolveProofType({})).toBe("label_created");
    expect(resolveProofType({ proofType: "bogus" })).toBe("label_created");
  });
});

describe("delivery evidence rows — distinct labels (no double 'Delivery confirmation')", () => {
  it("shipping_tracking and delivery_proof resolve to DIFFERENT label keys", () => {
    const shipping = deliveryLabelKey("shipping_tracking", "delivered_unverified");
    const delivery = deliveryLabelKey("delivery_proof", "delivered_unverified");
    expect(shipping).not.toBe(delivery);
  });

  it("the unconfirmed delivery_proof row is 'not confirmed', not 'confirmation'", () => {
    // delivered_unverified / label_created → notConfirmed
    expect(deliveryLabelKey("delivery_proof", "delivered_unverified")).toBe(
      "disputes.deliveryProof.notConfirmed",
    );
    expect(deliveryLabelKey("delivery_proof", "label_created")).toBe(
      "disputes.deliveryProof.notConfirmed",
    );
  });

  it("shipping_tracking always speaks to dispatch", () => {
    for (const p of [
      "signature_confirmed",
      "delivered_confirmed",
      "delivered_unverified",
      "label_created",
    ] as const) {
      expect(deliveryLabelKey("shipping_tracking", p)).toBe(
        "disputes.deliveryProof.shippedUnconfirmed",
      );
    }
  });

  it("confirmed delivery_proof escalates to carrier/signature labels", () => {
    expect(deliveryLabelKey("delivery_proof", "signature_confirmed")).toBe(
      "disputes.deliveryProof.signature",
    );
    expect(deliveryLabelKey("delivery_proof", "delivered_confirmed")).toBe(
      "disputes.deliveryProof.carrierConfirmed",
    );
  });

  it("why-context diverges per proofType and field", () => {
    expect(deliveryWhyKey("shipping_tracking", "delivered_unverified")).toBe(
      "disputes.deliveryProof.whyShippedUnconfirmed",
    );
    expect(deliveryWhyKey("delivery_proof", "delivered_unverified")).toBe(
      "disputes.deliveryProof.whyNotConfirmed",
    );
    expect(deliveryWhyKey("delivery_proof", "signature_confirmed")).toBe(
      "disputes.deliveryProof.whySignature",
    );
  });
});

describe("delivery evidence rows — concrete facts extraction", () => {
  it("pulls carrier, tracking number/url, shipped + eta from the payload", () => {
    const facts = buildDeliveryFacts(UNVERIFIED_PAYLOAD);
    expect(facts.carrier).toBe("PostNord SE");
    expect(facts.trackingNumber).toBe("00573132901672098616");
    expect(facts.trackingUrl).toBe(
      "https://tracking.postnord.com/se/?id=00573132901672098616",
    );
    expect(facts.shippedAt).toBe("2026-06-07T14:39:06Z");
    expect(facts.estimatedDeliveryAt).toBe("2026-06-09T18:00:00Z");
    expect(facts.deliveredAt).toBeNull();
    expect(facts.signedByName).toBeNull();
    expect(facts.proofType).toBe("delivered_unverified");
  });

  it("drops non-http tracking urls but keeps the number", () => {
    const facts = buildDeliveryFacts({
      proofType: "delivered_unverified",
      fulfillments: [
        { tracking: [{ number: "X1", url: "notaurl", carrier: "ACME" }] },
      ],
    });
    expect(facts.trackingNumber).toBe("X1");
    expect(facts.trackingUrl).toBeNull();
    expect(facts.carrier).toBe("ACME");
  });

  it("tolerates an empty/garbage payload", () => {
    const facts = buildDeliveryFacts(null);
    expect(facts.carrier).toBeNull();
    expect(facts.trackingNumber).toBeNull();
    expect(facts.proofType).toBe("label_created");
  });
});
