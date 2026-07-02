/**
 * Tests for the BNPL/local payment overlay + its hard-banned card phrases.
 *
 * The overlay must (a) be present for non-card families and absent for
 * card, and (b) supply regexes that reject every card-network artifact so
 * a Klarna/Affirm narrative can never cite AVS/CVV/3DS/CE3.0/FPT/etc.
 */

import { describe, it, expect } from "vitest";
import {
  paymentOverlayFor,
  BNPL_PROHIBITED_CARD_PHRASES,
} from "@/lib/defence/paymentOverlays";

describe("paymentOverlayFor", () => {
  it("returns an overlay + card-phrase bans for Klarna", () => {
    const { overlay, prohibitedPhrases } = paymentOverlayFor("klarna");
    expect(overlay).toBeTruthy();
    expect(prohibitedPhrases.length).toBeGreaterThan(0);
  });

  it("returns an overlay for Affirm and generic BNPL/local", () => {
    expect(paymentOverlayFor("affirm").overlay).toBeTruthy();
    expect(paymentOverlayFor("bnpl").overlay).toBeTruthy();
    expect(paymentOverlayFor("local_payment_method").overlay).toBeTruthy();
  });

  it("returns NO overlay for card (reason module already targets card)", () => {
    const { overlay, prohibitedPhrases } = paymentOverlayFor("card");
    expect(overlay).toBeNull();
    expect(prohibitedPhrases).toEqual([]);
  });

  it("returns no overlay for unknown/null", () => {
    expect(paymentOverlayFor("unknown").overlay).toBeNull();
    expect(paymentOverlayFor(null).overlay).toBeNull();
  });
});

describe("BNPL_PROHIBITED_CARD_PHRASES — reject card-network artifacts", () => {
  const shouldReject = [
    "the AVS result was a full match",
    "Address Verification System returned Y",
    "CVV matched",
    "the CVC was correct",
    "authenticated via 3-D Secure",
    "3DS was completed",
    "3D Secure liability shift applies",
    "cardholder authentication succeeded",
    "this qualifies under Visa CE 3.0",
    "Compelling Evidence 3.0 applies",
    "eligible for Mastercard FPT",
    "the issuer fraud score was low",
    "card-network liability shift protects us",
    "we are filing a representment",
    "chargeback reason code 13.1",
  ];

  it.each(shouldReject)("rejects: %s", (text) => {
    const hit = BNPL_PROHIBITED_CARD_PHRASES.some((re) => re.test(text));
    expect(hit).toBe(true);
  });

  const shouldAllow = [
    "the package was delivered on March 3 and signed for",
    "a full refund of $429 was issued on June 2",
    "tracking shows delivery to the customer's address",
    "the return was received and the refund processed",
  ];

  it.each(shouldAllow)("allows legitimate BNPL evidence: %s", (text) => {
    const hit = BNPL_PROHIBITED_CARD_PHRASES.some((re) => re.test(text));
    expect(hit).toBe(false);
  });
});
