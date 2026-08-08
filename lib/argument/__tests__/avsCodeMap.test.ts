import { describe, expect, it } from "vitest";

import {
  isAddressMatchResult,
  isCeItem3Code,
  normalizeAvsCode,
  resolveCardNetwork,
  type CardNetwork,
} from "../avsCodeMap";
import {
  citableVerificationSummaryEn,
  gradePaymentVerification,
  readPaymentVerification,
} from "../paymentVerification";

/**
 * PR-C3 / C-13 — canonical AVS normalization per (network, code).
 *
 * Three properties, in order of how much damage getting them wrong does:
 *   1. only the primary-sourced codes reach a citation (decision 3);
 *   2. an unknown / missing / unmapped code earns nothing, anywhere, and
 *      never asserts anything against the cardholder;
 *   3. grading does not move — this is a citation change, not a re-grading.
 */

const NETWORKS: CardNetwork[] = ["visa", "mastercard", "amex", "unknown"];

describe("network resolution", () => {
  it("reads the brand the gateway reported, in any of its shapes", () => {
    expect(resolveCardNetwork({ cardCompany: "Visa" })).toBe("visa");
    expect(resolveCardNetwork({ cardCompany: "MASTERCARD" })).toBe("mastercard");
    expect(resolveCardNetwork({ cardCompany: "master card" })).toBe("mastercard");
    expect(resolveCardNetwork({ cardCompany: "American Express" })).toBe("amex");
    expect(resolveCardNetwork({ company: "amex" })).toBe("amex");
    expect(resolveCardNetwork({ cardBrand: " visa " })).toBe("visa");
  });

  it("returns `unknown` rather than guessing — 19 of 130 prod packs carry no brand", () => {
    expect(resolveCardNetwork({})).toBe("unknown");
    expect(resolveCardNetwork(null)).toBe("unknown");
    expect(resolveCardNetwork({ cardCompany: "" })).toBe("unknown");
    expect(resolveCardNetwork({ cardCompany: "Discover" })).toBe("unknown");
  });

  it("an unknown network is not punitive: the code still decides", () => {
    for (const network of NETWORKS) {
      expect(normalizeAvsCode(network, "Y").ceItem3Citable).toBe(true);
    }
  });
});

describe("the map — table-driven, every network", () => {
  const CASES: Array<{
    code: string;
    result: string;
    match: boolean;
    citable: boolean;
  }> = [
    { code: "Y", result: "full_match", match: true, citable: true },
    { code: "M", result: "full_match", match: true, citable: true },
    { code: "X", result: "full_match", match: true, citable: false },
    { code: "D", result: "full_match", match: true, citable: false },
    { code: "A", result: "street_match", match: true, citable: false },
    { code: "W", result: "postal_match", match: true, citable: false },
    { code: "Z", result: "no_match", match: false, citable: false },
    { code: "N", result: "no_match", match: false, citable: false },
    { code: "C", result: "no_match", match: false, citable: false },
    { code: "U", result: "unavailable", match: false, citable: false },
    { code: "S", result: "not_checked", match: false, citable: false },
    { code: "R", result: "unavailable", match: false, citable: false },
    { code: "G", result: "not_checked", match: false, citable: false },
    { code: "E", result: "unavailable", match: false, citable: false },
  ];

  for (const network of NETWORKS) {
    for (const c of CASES) {
      it(`${network} / ${c.code} → ${c.result}`, () => {
        const cell = normalizeAvsCode(network, c.code);
        expect(cell.result).toBe(c.result);
        expect(cell.network).toBe(network);
        expect(cell.unmapped).toBe(false);
        expect(isAddressMatchResult(cell.result)).toBe(c.match);
        expect(cell.ceItem3Citable).toBe(c.citable);
      });
    }
  }

  it("normalizes case and whitespace on every network", () => {
    for (const network of NETWORKS) {
      expect(normalizeAvsCode(network, " y ").result).toBe("full_match");
      expect(normalizeAvsCode(network, "n").result).toBe("no_match");
    }
  });

  it("an absent code is `not_checked`, never a negative signal", () => {
    for (const network of NETWORKS) {
      for (const raw of [null, undefined, "", "   "]) {
        const cell = normalizeAvsCode(network, raw);
        expect(cell.code).toBeNull();
        expect(cell.result).toBe("not_checked");
        expect(cell.unmapped).toBe(false);
        expect(cell.ceItem3Citable).toBe(false);
      }
    }
  });
});

describe("authority is recorded, and only primary-sourced cells are citable", () => {
  it("only `Y` and `M` carry v_primary, and only they cite", () => {
    for (const network of NETWORKS) {
      for (const code of ["Y", "M"]) {
        const cell = normalizeAvsCode(network, code);
        expect(cell.authority).toBe("v_primary");
        expect(cell.ceItem3Citable).toBe(true);
      }
      for (const code of ["X", "D", "A", "W", "Z", "N", "C", "U", "S", "R", "G", "E", "Q"]) {
        const cell = normalizeAvsCode(network, code);
        expect(cell.authority).not.toBe("v_primary");
        expect(cell.ceItem3Citable).toBe(false);
      }
    }
  });

  it("the citable set is EXACTLY {Y, M}", () => {
    const citable = ["Y", "M", "X", "D", "A", "W", "Z", "N", "C", "U", "S", "R", "G", "E"].filter(
      (code) => normalizeAvsCode("visa", code).ceItem3Citable,
    );
    expect(citable.sort()).toEqual(["M", "Y"]);
    expect(isCeItem3Code("Y")).toBe(true);
    expect(isCeItem3Code("M")).toBe(true);
    expect(isCeItem3Code("W")).toBe(false);
    expect(isCeItem3Code(null)).toBe(false);
  });

  it("a partial match reaches internal display but never a citation", () => {
    for (const code of ["A", "W", "X", "D"]) {
      const v = readPaymentVerification({ avsResultCode: code });
      // Internal: the merchant sees a match, and scoring still credits it.
      expect(v.addressVerified).toBe(true);
      expect(v.avs.outcome).toBe("match");
      // Bank: nothing.
      expect(v.citableAddressVerified).toBe(false);
      expect(v.citable).toBe(false);
      expect(citableVerificationSummaryEn(v)).toBeNull();
    }
  });
});

describe("unknown / missing / unmapped codes are conservative on every axis", () => {
  const UNMAPPED = ["Q", "F", "B", "P", "1", "ZZ"];

  it("resolve to `unknown`, flagged unmapped, on every network", () => {
    for (const network of NETWORKS) {
      for (const code of UNMAPPED) {
        const cell = normalizeAvsCode(network, code);
        expect(cell.result).toBe("unknown");
        expect(cell.unmapped).toBe(true);
        expect(cell.authority).toBe("unverified");
        expect(cell.ceItem3Citable).toBe(false);
        expect(isAddressMatchResult(cell.result)).toBe(false);
      }
    }
  });

  it("earn no grade, no citation and no address credit", () => {
    for (const code of UNMAPPED) {
      const v = readPaymentVerification({ avsResultCode: code });
      expect(v.avsUnmapped).toBe(true);
      expect(v.addressVerified).toBe(false);
      expect(v.citable).toBe(false);
      expect(citableVerificationSummaryEn(v)).toBeNull();
      expect(gradePaymentVerification(v)).toBe("invalid");
    }
  });

  it("NEVER assert a failure — an unrecognised code is our gap, not the issuer's verdict", () => {
    for (const code of UNMAPPED) {
      const v = readPaymentVerification({ avsResultCode: code });
      expect(v.avs.outcome).toBe("unchecked");
      expect(v.avs.outcome).not.toBe("no_match");
    }
  });

  it("do not suppress an independent CVV match — it still grades moderate", () => {
    const v = readPaymentVerification({ avsResultCode: "Q", cvvResultCode: "M" });
    expect(v.securityCodeVerified).toBe(true);
    expect(gradePaymentVerification(v)).toBe("moderate");
    expect(v.citable).toBe(false);
  });
});

describe("grading does not move (C-13 is a citation change)", () => {
  const grade = (avs?: string, cvv?: string) =>
    gradePaymentVerification(
      readPaymentVerification({ avsResultCode: avs, cvvResultCode: cvv }),
    );

  it("the carried-over scoring set still grades exactly as before", () => {
    for (const code of ["Y", "A", "W", "X", "D", "M"]) {
      expect(grade(code)).toBe("moderate");
      expect(grade(code, "M")).toBe("strong");
    }
    expect(grade("N", "N")).toBe("invalid");
    expect(grade("Z", "M")).toBe("moderate");
  });

  it("a narrowed citation never changes the grade it was cited from", () => {
    const w = readPaymentVerification({ avsResultCode: "W", cvvResultCode: "M" });
    expect(gradePaymentVerification(w)).toBe("strong");
    expect(w.citable).toBe(false);
  });
});
