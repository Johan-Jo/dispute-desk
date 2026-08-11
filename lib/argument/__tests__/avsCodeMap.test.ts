import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isAddressMatchResult,
  isCeItem3Citable,
  normalizeAvsCode,
  resolveCardNetwork,
  visaCeItem3Codes,
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

/** The only cells with a primary source: register R-E is a VISA document. */
const VISA_CITABLE = new Set(visaCeItem3Codes());

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

  it("an unknown network is not punitive: the code normalizes and scores the same", () => {
    for (const network of NETWORKS) {
      const cell = normalizeAvsCode(network, "Y");
      expect(cell.result).toBe("full_match");
      expect(isAddressMatchResult(cell.result)).toBe(true);
    }
  });

  it("...but only a SOURCED network cell may cite it", () => {
    expect(normalizeAvsCode("visa", "Y").ceItem3Citable).toBe(true);
    expect(normalizeAvsCode("mastercard", "Y").ceItem3Citable).toBe(false);
    expect(normalizeAvsCode("amex", "Y").ceItem3Citable).toBe(false);
    expect(normalizeAvsCode("unknown", "Y").ceItem3Citable).toBe(false);
  });
});

describe("the map — table-driven, every network", () => {
  const CASES: Array<{
    code: string;
    result: string;
    match: boolean;
    citable: boolean;
  }> = [
    { code: "Y", result: "full_match", match: true, citable: false },
    { code: "M", result: "full_match", match: true, citable: false },
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
        // The base table cites nothing. Citation comes from the network
        // override, and only Visa has one.
        expect(cell.ceItem3Citable).toBe(network === "visa" && VISA_CITABLE.has(c.code));
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

describe("authority is recorded, and only primary-sourced CELLS are citable", () => {
  it("v_primary exists on VISA Y/M and nowhere else", () => {
    for (const code of ["Y", "M"]) {
      expect(normalizeAvsCode("visa", code).authority).toBe("v_primary");
      expect(normalizeAvsCode("visa", code).ceItem3Citable).toBe(true);
      for (const network of ["mastercard", "amex", "unknown"] as CardNetwork[]) {
        const cell = normalizeAvsCode(network, code);
        expect(cell.authority).toBe("unverified");
        expect(cell.ceItem3Citable).toBe(false);
      }
    }
    for (const network of NETWORKS) {
      for (const code of ["X", "D", "A", "W", "Z", "N", "C", "U", "S", "R", "G", "E", "Q"]) {
        const cell = normalizeAvsCode(network, code);
        expect(cell.authority).not.toBe("v_primary");
        expect(cell.ceItem3Citable).toBe(false);
      }
    }
  });

  it("the citable set is EXACTLY {(visa, Y), (visa, M)}", () => {
    const ALL_CODES = ["Y", "M", "X", "D", "A", "W", "Z", "N", "C", "U", "S", "R", "G", "E", "Q"];
    const citable: string[] = [];
    for (const network of NETWORKS) {
      for (const code of ALL_CODES) {
        if (normalizeAvsCode(network, code).ceItem3Citable) citable.push(network + "/" + code);
      }
    }
    expect(citable.sort()).toEqual(["visa/M", "visa/Y"]);
  });

  it("the citability helper is network-aware — there is no code-only bypass", () => {
    expect(isCeItem3Citable("visa", "Y")).toBe(true);
    expect(isCeItem3Citable("visa", "M")).toBe(true);
    expect(isCeItem3Citable("mastercard", "Y")).toBe(false);
    expect(isCeItem3Citable("amex", "M")).toBe(false);
    expect(isCeItem3Citable("unknown", "Y")).toBe(false);
    expect(isCeItem3Citable("visa", "W")).toBe(false);
    expect(isCeItem3Citable("visa", null)).toBe(false);

    // The module must expose NO function answering citability from a code
    // alone — that shape is the bypass this rule exists to prevent.
    const surface = fs.readFileSync(
      path.join(process.cwd(), "lib/argument/avsCodeMap.ts"),
      "utf8",
    );
    expect(surface).not.toMatch(/export function isCeItem3Code[^C]/);
  });

  it("a partial match reaches internal display but never a citation", () => {
    for (const code of ["A", "W", "X", "D"]) {
      const v = readPaymentVerification({ avsResultCode: code, cardCompany: "Visa" });
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

  it("a MISSING network does not reduce the grade — missing information, not a result", () => {
    for (const brand of [null, "Mastercard", "American Express", "Visa"]) {
      const v = readPaymentVerification({
        avsResultCode: "Y",
        cvvResultCode: "M",
        ...(brand ? { cardCompany: brand } : {}),
      });
      expect(v.addressVerified).toBe(true);
      expect(v.avs.outcome).toBe("match");
      expect(gradePaymentVerification(v)).toBe("strong");
    }
  });
});
