import { describe, expect, it } from "vitest";

import {
  avsBucket,
  citableVerificationSummaryEn,
  cvvBucket,
  gradePaymentVerification,
  hasFullAvsAndCvvMatch,
  hasCitableAddressMatch,
  readPaymentVerification,
} from "../paymentVerification";

/**
 * PR-C2 / C-12 — AVS and CVV are two facts with two meanings.
 *
 * The behaviour this file pins, in order of how much damage getting it wrong
 * does: (1) a CVV-only match never becomes citable, by any payload shape;
 * (2) grades are exactly what they were before the split, so nothing about
 * case strength or completeness moves; (3) every historical payload shape on
 * prod still reads.
 */

describe("readPaymentVerification — payload shapes", () => {
  it("reads the current collector shape", () => {
    const v = readPaymentVerification({ avsResultCode: "Y", cvvResultCode: "M" });
    expect(v.avs.code).toBe("Y");
    expect(v.cvv.code).toBe("M");
    expect(v.addressVerified).toBe(true);
    expect(v.securityCodeVerified).toBe(true);
  });

  it("reads the legacy snake_case shape (11 packs, newest 2026-01-19)", () => {
    const v = readPaymentVerification({ avs_result_code: "y", cvv_result_code: "m" });
    expect(v.addressVerified).toBe(true);
    expect(v.securityCodeVerified).toBe(true);
  });

  it("reads the fact-layer projection shape (avsResult / cvvResult)", () => {
    const v = readPaymentVerification({ avsResult: "Y", cvvResult: "N" });
    expect(v.addressVerified).toBe(true);
    expect(v.securityCodeVerified).toBe(false);
  });

  it("normalizes case and whitespace", () => {
    const v = readPaymentVerification({ avsResultCode: "  y  ", cvvResultCode: " m " });
    expect(v.avs.code).toBe("Y");
    expect(v.addressVerified).toBe(true);
    expect(v.securityCodeVerified).toBe(true);
  });

  it("absence is never a signal", () => {
    for (const payload of [null, undefined, {}, { avsResultCode: "" }, { avsResultCode: 7 }]) {
      const v = readPaymentVerification(payload);
      expect(v.avs.present).toBe(false);
      expect(v.addressVerified).toBe(false);
      expect(v.securityCodeVerified).toBe(false);
      expect(v.citable).toBe(false);
    }
  });
});

describe("the two facts stay separate", () => {
  it("a CVV match is never an address match", () => {
    const v = readPaymentVerification({ avsResultCode: "N", cvvResultCode: "M" });
    expect(v.securityCodeVerified).toBe(true);
    expect(v.addressVerified).toBe(false);
    expect(v.cvvOnly).toBe(true);
  });

  it("an AVS match is never a security-code match", () => {
    const v = readPaymentVerification({ avsResultCode: "Y", cvvResultCode: "N" });
    expect(v.addressVerified).toBe(true);
    expect(v.securityCodeVerified).toBe(false);
    expect(v.cvvOnly).toBe(false);
  });

  it("an absent AVS code with a CVV match is still CVV-only", () => {
    const v = readPaymentVerification({ cvvResultCode: "M" });
    expect(v.cvvOnly).toBe(true);
    expect(v.citable).toBe(false);
  });
});

describe("citability (decision 1)", () => {
  it("requires the address half, on a PRIMARY-SOURCED (network, code) cell", () => {
    const visa = (avs?: string, cvv?: string) =>
      readPaymentVerification({ avsResultCode: avs, cvvResultCode: cvv, cardCompany: "Visa" });
    expect(visa("Y").citable).toBe(true);
    expect(visa("M").citable).toBe(true);
    // A postal-only match still SCORES and still shows on the merchant's
    // screen; register R-E names `Y` or `M`.
    expect(visa("W").citable).toBe(false);
    expect(visa("W").addressVerified).toBe(true);
    expect(visa(undefined, "M").citable).toBe(false);
    expect(visa("N", "M").citable).toBe(false);
    // The same code on a network whose document we have never read.
    expect(
      readPaymentVerification({ avsResultCode: "Y", cardCompany: "Mastercard" }).citable,
    ).toBe(false);
    expect(readPaymentVerification({ avsResultCode: "Y" }).citable).toBe(false);
  });

  it("produces NO citable summary for any CVV-only case", () => {
    for (const avs of [undefined, "", "N", "Z", "C", "U", "S", "R"]) {
      const summary = citableVerificationSummaryEn(
        readPaymentVerification({ avsResultCode: avs, cvvResultCode: "M" }),
      );
      expect(summary).toBeNull();
    }
  });

  it("names only what actually matched", () => {
    // PR-C3: partial address results are no longer citable at all, so the
    // street-only and postal-only clauses have no citable case to describe.
    expect(
      citableVerificationSummaryEn(
        readPaymentVerification({ avsResultCode: "A", cardCompany: "Visa" }),
      ),
    ).toBeNull();
    expect(
      citableVerificationSummaryEn(
        readPaymentVerification({ avsResultCode: "W", cardCompany: "Visa" }),
      ),
    ).toBeNull();
    expect(
      citableVerificationSummaryEn(
        readPaymentVerification({ avsResultCode: "Y", cardCompany: "Visa" }),
      ),
    ).toBe("the billing address matched the issuer's records");
    expect(
      citableVerificationSummaryEn(
        readPaymentVerification({
          avsResultCode: "Y",
          cvvResultCode: "M",
          cardCompany: "Visa",
        }),
      ),
    ).toBe(
      "the billing address matched the issuer's records and the card verification code matched the issuer's records",
    );
  });

  it("never mentions the security code when only the address matched", () => {
    const summary = citableVerificationSummaryEn(
      readPaymentVerification({ avsResultCode: "Y", cvvResultCode: "N", cardCompany: "Visa" }),
    );
    expect(summary).toBe("the billing address matched the issuer's records");
    expect(summary).not.toContain("verification code");
  });

  it("AVS Z (street failed, postal matched) is not citable — it was, before the split", () => {
    const v = readPaymentVerification({
      avsResultCode: "Z",
      cvvResultCode: "M",
      cardCompany: "Visa",
    });
    expect(v.citable).toBe(false);
    expect(citableVerificationSummaryEn(v)).toBeNull();
  });
});

describe("grading is unchanged by the split", () => {
  const grade = (avs?: string, cvv?: string) =>
    gradePaymentVerification(
      readPaymentVerification({ avsResultCode: avs, cvvResultCode: cvv }),
    );

  it("both matched → strong", () => {
    expect(grade("Y", "M")).toBe("strong");
    expect(grade("W", "M")).toBe("strong");
  });

  it("either matched → moderate, INCLUDING the CVV-only case", () => {
    expect(grade("Y", "N")).toBe("moderate");
    expect(grade("N", "M")).toBe("moderate");
    expect(grade(undefined, "M")).toBe("moderate");
  });

  it("neither matched → invalid", () => {
    expect(grade("N", "N")).toBe("invalid");
    expect(grade()).toBe("invalid");
  });

  it("every code in the carried-over match set still grades", () => {
    for (const code of ["Y", "A", "W", "X", "D", "M"]) {
      expect(grade(code)).toBe("moderate");
    }
  });
});

describe("the match helpers read the CELL, not the letter (PR-C3)", () => {
  it("hasCitableAddressMatch needs a primary-sourced (network, code) cell", () => {
    expect(
      hasCitableAddressMatch(
        readPaymentVerification({ avsResultCode: "Y", cardCompany: "Visa" }),
      ),
    ).toBe(true);
    expect(
      hasCitableAddressMatch(
        readPaymentVerification({ avsResultCode: "M", cardCompany: "Visa" }),
      ),
    ).toBe(true);
    expect(
      hasCitableAddressMatch(
        readPaymentVerification({ avsResultCode: "W", cardCompany: "Visa" }),
      ),
    ).toBe(false);
    expect(
      hasCitableAddressMatch(
        readPaymentVerification({ avsResultCode: "Y", cardCompany: "Mastercard" }),
      ),
    ).toBe(false);
    expect(hasCitableAddressMatch(readPaymentVerification({ avsResultCode: "Y" }))).toBe(false);
  });

  it("hasFullAvsAndCvvMatch is a citable address match PLUS a CVV match", () => {
    for (const avs of ["Y", "M"]) {
      expect(
        hasFullAvsAndCvvMatch(
          readPaymentVerification({
            avsResultCode: avs,
            cvvResultCode: "M",
            cardCompany: "Visa",
          }),
        ),
      ).toBe(true);
    }
    expect(
      hasFullAvsAndCvvMatch(
        readPaymentVerification({
          avsResultCode: "A",
          cvvResultCode: "M",
          cardCompany: "Visa",
        }),
      ),
    ).toBe(false);
    expect(
      hasFullAvsAndCvvMatch(
        readPaymentVerification({
          avsResultCode: "Y",
          cvvResultCode: "M",
          cardCompany: "Mastercard",
        }),
      ),
    ).toBe(false);
  });
});

describe("descriptive buckets vs the scoring predicate", () => {
  it("buckets read the same as before the fold-in", () => {
    expect(avsBucket("Y")).toBe("match");
    expect(avsBucket("N")).toBe("no_match");
    expect(avsBucket("Z")).toBe("no_match");
    expect(avsBucket("U")).toBe("unchecked");
    expect(avsBucket(null)).toBeNull();
    expect(cvvBucket("M")).toBe("match");
    expect(cvvBucket("N")).toBe("no_match");
    expect(cvvBucket("P")).toBe("unchecked");
    expect(cvvBucket("")).toBeNull();
  });

  it("AVS F — the disagreement PR-C2 pinned is RESOLVED by PR-C3's map, conservatively", () => {
    // It used to read as a match in merchant copy while scoring credited
    // nothing. The canonical map has no sourced entry for `F`, so it is now
    // an unmapped code: described as not-verified, credited nowhere, and
    // raised as a diagnostic instead of being guessed at.
    const v = readPaymentVerification({ avsResultCode: "F" });
    expect(v.avs.unmapped).toBe(true);
    expect(v.avs.normalized).toBe("unknown");
    expect(v.avs.outcome).toBe("unchecked");
    expect(v.avs.matched).toBe(false);
    expect(v.addressVerified).toBe(false);
    expect(v.citable).toBe(false);
  });
});
