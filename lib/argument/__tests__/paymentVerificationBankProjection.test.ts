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
import { readPaymentVerification } from "../paymentVerification";

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
  "citableAddressVerified",
  "avsResult",
  "avsResultCode",
  "avs_result_code",
  "verificationSummary",
  "fieldKey",
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
  });

  it("leaves no serialized trace the model could read as an address claim", () => {
    const blob = JSON.stringify(
      projectPaymentVerificationValueForBank(
        FACT_347617,
        false,
        "payment_authentication",
      ),
    ).toLowerCase();

    // The discriminator itself is an AVS token to a reader.
    expect(blob).not.toContain("avs_cvv_match");
    expect(blob).not.toContain("avs");
    expect(blob).not.toContain("address");
  });

  it("drops fieldKey after using it as the fallback discriminator", () => {
    const projected = projectPaymentVerificationValueForBank(
      FACT_347617,
      false,
    ) as Record<string, unknown>;

    expect(projected).not.toHaveProperty("fieldKey");
    // …and the fallback still worked: address fields are gone.
    expect(projected).not.toHaveProperty("addressVerified");
  });

  it("covers the legacy `payment_auth` category spelling", () => {
    const noFieldKey = { ...FACT_347617 } as Record<string, unknown>;
    delete noFieldKey.fieldKey;

    const projected = projectPaymentVerificationValueForBank(
      noFieldKey,
      false,
      "payment_auth",
    ) as Record<string, unknown>;

    expect(projected).not.toHaveProperty("addressVerified");
    expect(projected.securityCodeVerified).toBe(true);
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

    expect(
      projectPaymentVerificationValueForBank(
        eligible,
        true,
        "payment_authentication",
      ),
    ).toEqual(eligible);
  });

  it("ignores non-payment-verification values", () => {
    const other = { fieldKey: "delivery_proof", deliveredAt: "2026-07-13" };
    expect(projectPaymentVerificationValueForBank(other, false)).toEqual(other);
    expect(projectPaymentVerificationValueForBank(null, false)).toBeNull();
    expect(projectPaymentVerificationValueForBank("x", false)).toBe("x");
  });
});

/**
 * Why keeping `securityCodeVerified` is safe.
 *
 * The projection retains the CVV boolean while stripping the address one. That
 * asymmetry is only defensible if the CVV flag cannot itself be a bare
 * assertion — the exact failure mode `addressVerified` was.
 *
 * It cannot: `readPaymentVerification` sets `securityCodeVerified` from
 * `cvv.matched`, and the CVV match set is `{"M"}`. There is no path that sets
 * it from an absent, unknown or non-matching code. #347617's source pack
 * carries `cvvResultCode: "M"`, so its boolean was gateway-backed — the code
 * was withheld downstream by the citability rule, not missing.
 *
 * This pins the invariant the projection's doc comment relies on, replacing an
 * earlier `cvvProvenance` parameter that no caller ever passed.
 */
describe("classifier invariant — securityCodeVerified needs a gateway match", () => {
  it("is true only for a CVV code in the match set", () => {
    expect(
      readPaymentVerification({ cvvResultCode: "M" }).securityCodeVerified,
    ).toBe(true);
  });

  it("is false for a non-matching, unknown or absent code", () => {
    for (const cvvResultCode of ["N", "U", "P", "S", "", "X"]) {
      expect(
        readPaymentVerification({ cvvResultCode }).securityCodeVerified,
      ).toBe(false);
    }
    expect(readPaymentVerification({}).securityCodeVerified).toBe(false);
    expect(
      readPaymentVerification({ cvvResultCode: null }).securityCodeVerified,
    ).toBe(false);
  });

  it("cannot be forced true by a bare boolean on the payload", () => {
    expect(
      readPaymentVerification({ securityCodeVerified: true })
        .securityCodeVerified,
    ).toBe(false);
  });
});
