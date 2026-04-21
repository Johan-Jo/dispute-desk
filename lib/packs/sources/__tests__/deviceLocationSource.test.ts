import { describe, expect, it } from "vitest";
import {
  computeBankEligible,
  computeIpConsistencyLevel,
  computeLocationMatch,
  computeRiskLevel,
  computeScore,
  generateBankParagraph,
  generateMerchantGuidance,
  generateSummary,
} from "../deviceLocationSource";
import type { IpinfoResponse } from "@/lib/enrichment/ipinfo";

const CLEAN: IpinfoResponse["privacy"] = { vpn: false, proxy: false, hosting: false };
const VPN: IpinfoResponse["privacy"] = { vpn: true, proxy: false, hosting: false };
const HOSTING: IpinfoResponse["privacy"] = { vpn: false, proxy: false, hosting: true };

function ipinfo(overrides: Partial<IpinfoResponse> = {}): IpinfoResponse {
  return {
    ip: "1.2.3.4",
    city: "San Francisco",
    region: "California",
    country: "US",
    loc: "37.7749,-122.4194",
    org: "AS15169 Google",
    privacy: CLEAN,
    ...overrides,
  };
}

describe("computeLocationMatch", () => {
  it("same_city when city + country both match (case-insensitive)", () => {
    expect(
      computeLocationMatch(ipinfo({ city: "São Paulo", country: "BR" }), {
        city: "são paulo",
        countryCode: "br",
      }),
    ).toBe("same_city");
  });

  it("same_country when country matches but city differs", () => {
    expect(
      computeLocationMatch(ipinfo({ city: "Austin", country: "US" }), {
        city: "Dallas",
        countryCode: "US",
      }),
    ).toBe("same_country");
  });

  it("different_country when countries differ", () => {
    expect(
      computeLocationMatch(ipinfo({ country: "CA" }), { city: "Austin", countryCode: "US" }),
    ).toBe("different_country");
  });

  it("unknown when ipinfo missing", () => {
    expect(computeLocationMatch(null, { city: "X", countryCode: "US" })).toBe("unknown");
  });

  it("unknown when shipping missing", () => {
    expect(computeLocationMatch(ipinfo(), null)).toBe("unknown");
  });

  it("unknown when country strings empty", () => {
    expect(
      computeLocationMatch(ipinfo({ country: null }), { city: "Austin", countryCode: "US" }),
    ).toBe("unknown");
  });
});

describe("computeRiskLevel", () => {
  it("high for VPN", () => expect(computeRiskLevel(VPN)).toBe("high"));
  it("medium for hosting only", () => expect(computeRiskLevel(HOSTING)).toBe("medium"));
  it("low for clean", () => expect(computeRiskLevel(CLEAN)).toBe("low"));
});

describe("computeIpConsistencyLevel", () => {
  it("first_seen on no prior orders", () => {
    expect(computeIpConsistencyLevel(0, 0)).toBe("first_seen");
  });
  it("first_seen when prior orders exist but no matches", () => {
    expect(computeIpConsistencyLevel(0, 4)).toBe("first_seen");
  });
  it("consistent at >= 50% match ratio", () => {
    expect(computeIpConsistencyLevel(2, 4)).toBe("consistent");
    expect(computeIpConsistencyLevel(3, 4)).toBe("consistent");
  });
  it("variable when match ratio < 50% and >0", () => {
    expect(computeIpConsistencyLevel(1, 4)).toBe("variable");
  });
});

describe("computeScore", () => {
  it("same_city clean + first_seen → Strong", () => {
    expect(computeScore("same_city", CLEAN, "first_seen")).toBe("Strong");
    expect(computeScore("same_city", CLEAN, "consistent")).toBe("Strong");
  });
  it("same_city clean + variable → Moderate (downgrade)", () => {
    expect(computeScore("same_city", CLEAN, "variable")).toBe("Moderate");
  });
  it("same_country clean → Moderate regardless of consistency", () => {
    expect(computeScore("same_country", CLEAN, "first_seen")).toBe("Moderate");
    expect(computeScore("same_country", CLEAN, "consistent")).toBe("Moderate");
    expect(computeScore("same_country", CLEAN, "variable")).toBe("Moderate");
  });
  it("any match + VPN flag → Moderate cap", () => {
    expect(computeScore("same_city", VPN, "consistent")).toBe("Moderate");
    expect(computeScore("same_country", VPN, "first_seen")).toBe("Moderate");
  });
  it("different_country + VPN → Weak (flags + mismatch both bad)", () => {
    expect(computeScore("different_country", VPN, "consistent")).toBe("Weak");
  });
  it("different_country clean + consistent → Moderate (prior same-IP softens)", () => {
    expect(computeScore("different_country", CLEAN, "consistent")).toBe("Moderate");
  });
  it("different_country clean + first_seen/variable → Weak", () => {
    expect(computeScore("different_country", CLEAN, "first_seen")).toBe("Weak");
    expect(computeScore("different_country", CLEAN, "variable")).toBe("Weak");
  });
  it("unknown → Missing", () => {
    expect(computeScore("unknown", CLEAN, "first_seen")).toBe("Missing");
  });
});

describe("computeBankEligible", () => {
  it("eligible when same_city + clean + consistent", () => {
    expect(computeBankEligible("same_city", CLEAN, "consistent")).toBe(true);
  });
  it("eligible when same_country + clean + first_seen", () => {
    expect(computeBankEligible("same_country", CLEAN, "first_seen")).toBe(true);
  });
  it("NOT eligible when different_country", () => {
    expect(computeBankEligible("different_country", CLEAN, "consistent")).toBe(false);
  });
  it("NOT eligible when any privacy flag set", () => {
    expect(computeBankEligible("same_city", VPN, "consistent")).toBe(false);
    expect(computeBankEligible("same_city", HOSTING, "consistent")).toBe(false);
  });
  it("NOT eligible when variable consistency", () => {
    expect(computeBankEligible("same_city", CLEAN, "variable")).toBe(false);
  });
  it("NOT eligible when location unknown", () => {
    expect(computeBankEligible("unknown", CLEAN, "first_seen")).toBe(false);
  });
});

describe("generateSummary (interpreted, plain English, no raw IP/org/city)", () => {
  it("same_city clean + consistent → 'matches billing country and prior customer activity'", () => {
    const s = generateSummary(ipinfo(), { country: "US" }, "same_city", CLEAN, "consistent");
    expect(s).toBe("Location matches billing country and prior customer activity.");
  });

  it("same_city clean + first_seen → 'matches billing country' (no consistency line on this row)", () => {
    const s = generateSummary(ipinfo(), { country: "US" }, "same_city", CLEAN, "first_seen");
    expect(s).toBe("Location matches billing country.");
  });

  it("same_country clean + variable → 'matches billing country' (variable downgrade not exposed on IP row)", () => {
    const s = generateSummary(ipinfo(), { country: "US" }, "same_country", CLEAN, "variable");
    expect(s).toBe("Location matches billing country.");
  });

  it("different_country clean → 'Purchase location differs from billing country.'", () => {
    const s = generateSummary(ipinfo({ country: "PT" }), { country: "BR" }, "different_country", CLEAN, "consistent");
    expect(s).toBe("Purchase location differs from billing country.");
  });

  it("any privacy flag adds a second reliability line", () => {
    const s = generateSummary(ipinfo(), { country: "US" }, "same_city", VPN, "consistent");
    expect(s).toBe(
      "Location matches billing country and prior customer activity.\nVPN or proxy detected — location reliability reduced.",
    );
  });

  it("never includes raw IP, org/ASN, city, or country code", () => {
    const s = generateSummary(
      ipinfo({ city: "São Paulo", country: "BR", org: "AS28573 Claro" }),
      { country: "BR" },
      "same_city",
      CLEAN,
      "consistent",
    );
    expect(s).not.toContain("São Paulo");
    expect(s).not.toContain("BR");
    expect(s).not.toContain("AS28573");
    expect(s).not.toContain("Claro");
    expect(s).not.toContain("1.2.3.4");
  });

  it("returns empty string when ipinfo is null", () => {
    expect(generateSummary(null, { country: "US" }, "unknown", CLEAN, "first_seen")).toBe("");
  });
});

describe("generateMerchantGuidance", () => {
  it("returns the optional-evidence line when no ipinfo", () => {
    const g = generateMerchantGuidance("unknown", CLEAN, "first_seen", null);
    expect(g).toContain("optional evidence");
  });
  it("returns null when everything clean + positive match + consistent", () => {
    expect(generateMerchantGuidance("same_city", CLEAN, "consistent", ipinfo())).toBeNull();
  });
  it("concats multiple guidance lines when multiple negatives", () => {
    const g = generateMerchantGuidance("different_country", VPN, "variable", ipinfo());
    expect(g).not.toBeNull();
    expect(g).toContain("Location mismatch");
    expect(g).toContain("VPN, proxy, or data-center");
    expect(g).toContain("used multiple IP addresses");
  });
});

describe("generateBankParagraph (only called when eligible) — bank-grade short form", () => {
  it("returns the rule-5G sentence and nothing else", () => {
    const p = generateBankParagraph(
      ipinfo({ city: "São Paulo", country: "BR", org: "AS28573 Claro" }),
      3,
      "consistent",
      "same_city",
      { country: "BR" },
    );
    expect(p).toBe(
      "The purchase originated from a location consistent with the customer's billing details and prior activity.",
    );
  });

  it("returns the same sentence regardless of reuse count or match level", () => {
    const a = generateBankParagraph(ipinfo(), 0, "first_seen", "same_city", { country: "US" });
    const b = generateBankParagraph(ipinfo(), 5, "consistent", "same_country", { country: "US" });
    expect(a).toBe(b);
    expect(a).toBe(
      "The purchase originated from a location consistent with the customer's billing details and prior activity.",
    );
  });

  it("never includes raw IP, org/ASN, city, or country", () => {
    const p = generateBankParagraph(
      ipinfo({ city: "São Paulo", country: "BR", org: "AS28573 Claro" }),
      3,
      "consistent",
      "same_city",
      { country: "BR" },
    )!;
    expect(p).not.toContain("São Paulo");
    expect(p).not.toContain("BR");
    expect(p).not.toContain("AS28573");
    expect(p).not.toContain("Claro");
    expect(p).not.toMatch(/\d+ prior order/);
  });

  it("returns null when ipinfo is null", () => {
    expect(
      generateBankParagraph(null, 0, "first_seen", "unknown", { country: null }),
    ).toBeNull();
  });
});
