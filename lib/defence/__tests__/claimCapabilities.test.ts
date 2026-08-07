/**
 * PR-C1 — structural claim authorization.
 *
 * The audit measured 7 affirmative "delivered to the verified address"
 * assertions across 3 disputes produced while the structured flag was FALSE,
 * on modules whose prompts never mentioned the claim. These tests pin the two
 * halves of the fix: `address_delivery` is underivable from any fact the
 * system can produce, and the detector recognises the claim by structure
 * rather than by the phrasings that happened to occur.
 */

import { describe, expect, it } from "vitest";
import {
  checkAddressDeliveryAuthorization,
  classifyAddressDeliveryClaim,
  claimsAddressDelivery,
  deriveClaimCapabilities,
} from "../claimCapabilities";
import type { EvidenceFact } from "../types";

function fact(category: string, value: Record<string, unknown>): EvidenceFact {
  return {
    id: `f-${category}`,
    category,
    label: category,
    value,
    source: "test",
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
  } as unknown as EvidenceFact;
}

describe("deriveClaimCapabilities", () => {
  it("NO producible fact combination licenses address_delivery", () => {
    // Every delivery shape the collectors can emit, plus the retired keys a
    // historical pack might still carry.
    const combos: Record<string, unknown>[] = [
      { proofType: "delivered_confirmed" },
      { proofType: "signature_confirmed", signedByName: "R. Pipe" },
      { proofType: "delivered_unverified" },
      { proofType: "label_created" },
      { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true },
      { proofType: "delivered_confirmed", collectedByCustomer: true },
      {
        proofType: "signature_confirmed",
        signedByName: "R. Pipe",
        deliveredToVerifiedAddress: true,
        collectedByCustomer: true,
      },
    ];
    for (const value of combos) {
      for (const category of ["delivery_proof", "shipping_tracking"]) {
        const caps = deriveClaimCapabilities([fact(category, value)]);
        expect(caps.has("address_delivery")).toBe(false);
      }
    }
    // Nor from a whole realistic fact set.
    const caps = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true }),
      fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }),
      fact("order_record", { orderName: "#1001" }),
    ]);
    expect(caps.has("address_delivery")).toBe(false);
  });

  it("preserves the delivery capabilities that PR-C1 must not break", () => {
    const confirmed = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed" }),
    ]);
    expect(confirmed.has("delivery_occurred")).toBe(true);
    expect(confirmed.has("signature_receipt")).toBe(false);

    const signed = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "signature_confirmed", signedByName: "R. Pipe" }),
    ]);
    expect(signed.has("signature_receipt")).toBe(true);
    expect(signed.has("delivery_occurred")).toBe(true);
  });

  it("an inferred pickup status alone grants no signature capability", () => {
    const caps = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed", collectedByCustomer: true }),
    ]);
    expect(caps.has("signature_receipt")).toBe(false);
  });
});

describe("classifyAddressDeliveryClaim — affirmative phrasings", () => {
  const AFFIRMATIVE = [
    // The exact production phrasings.
    "The parcel was delivered to the verified address on 12 May 2026.",
    "Delivery was made to the cardholder's verified address.",
    "The order was delivered to the address on file.",
    "The item was delivered to the same physical address the cardholder provided.",
    // Alternate phrasings that no historical regex covered.
    "The consignment reached the customer's residence on 12 May.",
    "The shipment arrived at the billing address recorded for this account.",
    "Our carrier handed the package to the recipient at their home address.",
    "The parcel was left at the customer's premises.",
    "Records show the package was received at the address of record.",
    "The order shipped to, and was received at, the cardholder's address.",
    // The retired derivation's own fact, asserted directly.
    "The billing and shipping addresses match for this order.",
    "The shipping address is the same as the billing address.",
  ];

  for (const text of AFFIRMATIVE) {
    it(`rejects: ${text.slice(0, 52)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("affirmative");
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }
});

describe("classifyAddressDeliveryClaim — negated and prohibited language", () => {
  const NEGATED = [
    "No evidence of delivery to a verified address is included in this response.",
    "We do not claim the parcel was delivered to the cardholder's address.",
    "The merchant did not receive an AVS match, so no verified-address delivery is asserted.",
    "Delivery to the billing address cannot be confirmed from the carrier record.",
  ];
  for (const text of NEGATED) {
    it(`classifies as negated: ${text.slice(0, 46)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("negated");
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }
});

describe("classifyAddressDeliveryClaim — ambiguity fails closed", () => {
  const AMBIGUOUS = [
    "Delivery to the customer's address.",
    "Parcel — recipient address, 12 May.",
  ];
  for (const text of AMBIGUOUS) {
    it(`blocks (ambiguous): ${text.slice(0, 46)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("ambiguous");
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }
});

describe("classifyAddressDeliveryClaim — legitimate prose still passes", () => {
  const CLEAN = [
    "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
    "The carrier recorded a signature on delivery.",
    "Tracking 1234567890 shows the shipment was delivered on 12 May 2026.",
    "The recipient collected the parcel at the pickup point on 12 May.",
    // The AVS fact keeps its licensed wording — it is a different claim, owned
    // by avs_cvv_match, and PR-C1 does not touch AVS.
    "The billing address matched the issuer's records and the card verification code matched the issuer's records.",
    // Non-physical "address" uses must not trip the detector.
    "The order confirmation was sent to the customer's email address on 1 May.",
    "The order IP address geolocated to the same country as the order.",
  ];
  for (const text of CLEAN) {
    it(`passes: ${text.slice(0, 52)}…`, () => {
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }
});

describe("checkAddressDeliveryAuthorization", () => {
  const noCaps = new Set<never>() as ReadonlySet<never>;

  it("refuses an affirmative claim when the capability is absent", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "The parcel was delivered to the verified address.",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(false);
  });

  it("refuses an ambiguous claim when the capability is absent", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "Delivery to the customer's address.",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(false);
  });

  it("authorizes clean delivery prose", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(true);
  });

  it("empty and null prose is authorized", () => {
    expect(checkAddressDeliveryAuthorization({ text: "", capabilities: noCaps as never }).authorized).toBe(true);
    expect(checkAddressDeliveryAuthorization({ text: null, capabilities: noCaps as never }).authorized).toBe(true);
  });
});
