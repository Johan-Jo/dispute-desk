/**
 * The #347617 regression (P0, 2026-08-26).
 *
 * The filed package for dispute #347617 asserted "both address verification and
 * security-code verification were completed" in THREE places in the rendered
 * PDF — executive summary, payment-authentication argument, and conclusion —
 * on a Mastercard 4837 with no observable address chain.
 *
 * The fact that produced it, verbatim from production:
 *
 *   { network: "mastercard", fieldKey: "avs_cvv_match",
 *     avsResult: null, cvvResult: null,
 *     addressVerified: true,          <- the leak
 *     verificationSummary: null,
 *     securityCodeVerified: true }    <- independently supported
 *
 *   bankEligible: false · strength: "strong"
 *
 * PR-C2 "Decision 1" withheld the CODES and the SUMMARY but not the BOOLEAN,
 * so the narrative generator wrote an address assertion from `addressVerified`
 * alone. Neither Visa CE Item 3 nor the Mastercard Chargeback Guide 4837 AVS
 * route authorizes a standalone address-verification claim — both require the
 * compound element (delivery/dispatch to the AVS-confirmed address), which is
 * not observable today.
 *
 * This pins the bank-facing PROJECTION only. The internal factual/risk signal
 * is deliberately untouched, and whether authoritative AVS may ever appear as
 * narrowly factual corroboration remains an open policy question.
 */
import { describe, expect, it } from "vitest";

import { projectPaymentVerificationValueForBank } from "../fraudScreeningSignals";

/** The production fact value from #347617 v6, field-for-field. */
const FACT_347617 = {
  network: "mastercard",
  fieldKey: "avs_cvv_match",
  avsResult: null,
  cvvResult: null,
  addressVerified: true,
  verificationSummary: null,
  securityCodeVerified: true,
} as const;

const ADDRESS_KEYS = [
  "addressVerified",
  "avsResult",
  "avsResultCode",
  "avs_result_code",
];

describe("payment-verification bank projection — #347617", () => {
  it("omits every address/AVS field when the fact is not bank-eligible", () => {
    const projected = projectPaymentVerificationValueForBank(
      FACT_347617,
      false,
    ) as Record<string, unknown>;

    for (const key of ADDRESS_KEYS) {
      expect(projected).not.toHaveProperty(key);
    }
  });

  it("preserves the independently supported CVV and network context", () => {
    const projected = projectPaymentVerificationValueForBank(
      FACT_347617,
      false,
    ) as Record<string, unknown>;

    expect(projected.securityCodeVerified).toBe(true);
    expect(projected.network).toBe("mastercard");
    expect(projected.fieldKey).toBe("avs_cvv_match");
  });

  it("leaves no serialized trace the model could read as an address claim", () => {
    const blob = JSON.stringify(
      projectPaymentVerificationValueForBank(FACT_347617, false),
    ).toLowerCase();

    expect(blob).not.toContain("addressverified");
    expect(blob).not.toContain("avsresult");
  });

  it("does not mutate the caller's fact — the internal signal survives", () => {
    const original = { ...FACT_347617 };
    projectPaymentVerificationValueForBank(FACT_347617, false);

    expect(FACT_347617).toEqual(original);
    expect(FACT_347617.addressVerified).toBe(true);
  });

  it("passes a bank-eligible fact through untouched", () => {
    const eligible = {
      ...FACT_347617,
      avsResult: "Y",
      addressVerified: true,
      verificationSummary: "the billing address matched the issuer's records",
    };

    expect(projectPaymentVerificationValueForBank(eligible, true)).toEqual(
      eligible,
    );
  });

  it("ignores non-payment-verification values", () => {
    const other = { fieldKey: "delivery_proof", deliveredAt: "2026-07-13" };
    expect(projectPaymentVerificationValueForBank(other, false)).toEqual(other);
    expect(projectPaymentVerificationValueForBank(null, false)).toBeNull();
    expect(projectPaymentVerificationValueForBank("x", false)).toBe("x");
  });
});
