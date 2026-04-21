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

describe("generateSummary (conclusion-first, no org/ASN)", () => {
  it("leads with 'Supports legitimate' on same_city clean + first_seen", () => {
    const s = generateSummary(
      ipinfo({ city: "São Paulo", country: "BR" }),
      { country: "BR" },
      "same_city",
      CLEAN,
      "first_seen",
    );
    expect(s).toMatch(/^Supports legitimate customer activity — IP origin matches shipping location \(São Paulo, BR\)\.$/);
    expect(s).not.toContain("AS");
    expect(s).not.toContain("Google");
  });

  it("leads with 'Location mismatch' on different_country", () => {
    const s = generateSummary(
      ipinfo({ city: "Lisbon", country: "PT" }),
      { country: "BR" },
      "different_country",
      CLEAN,
      "consistent",
    );
    expect(s).toMatch(/^Location mismatch — IP origin \(Lisbon, PT\) differs from shipping address \(BR\)\.$/);
  });

  it("leads with 'Network reliability reduced' when any privacy flag set", () => {
    const s = generateSummary(ipinfo(), { country: "US" }, "same_city", VPN, "consistent");
    expect(s).toMatch(/^Network reliability reduced/);
  });

  it("mentions variable consistency when same_city + variable", () => {
    const s = generateSummary(
      ipinfo({ city: "Austin", country: "US" }),
      { country: "US" },
      "same_city",
      CLEAN,
      "variable",
    );
    expect(s).toContain("with caveats");
    expect(s).toContain("used multiple IPs");
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

describe("generateBankParagraph (only called when eligible)", () => {
  it("leads with 'support customer legitimacy' and never mentions org/ASN", () => {
    const p = generateBankParagraph(
      ipinfo({ city: "São Paulo", country: "BR", org: "AS28573 Claro" }),
      3,
      "consistent",
      "same_city",
      { country: "BR" },
    )!;
    expect(p).toMatch(/^These signals support customer legitimacy\./);
    expect(p).toContain("São Paulo, BR");
    expect(p).toContain("matching the shipping location");
    expect(p).toContain("3 prior orders");
    expect(p).toContain("No VPN, proxy, or data-center flags");
    expect(p).not.toContain("AS28573");
    expect(p).not.toContain("Claro");
    expect(p).not.toContain("fraud");
    expect(p).not.toContain("proves");
  });

  it("uses 'first order' for first_seen", () => {
    const p = generateBankParagraph(ipinfo(), 0, "first_seen", "same_city", { country: "US" })!;
    expect(p).toContain("first order recorded from this IP");
  });

  it("singular 'prior order' for reuseCount === 1", () => {
    const p = generateBankParagraph(ipinfo(), 1, "consistent", "same_city", { country: "US" })!;
    expect(p).toContain("1 prior order");
    expect(p).not.toContain("1 prior orders");
  });

  it("same_country phrasing omits city", () => {
    const p = generateBankParagraph(
      ipinfo({ city: "Dallas", country: "US" }),
      2,
      "consistent",
      "same_country",
      { country: "US" },
    )!;
    expect(p).toContain("resolves to US — the same country as the shipping address");
    expect(p).not.toContain("Dallas");
  });
});
