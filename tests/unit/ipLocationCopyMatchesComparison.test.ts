/**
 * IP-location copy must describe the comparison that actually ran.
 *
 * ── THE MISMATCH ──────────────────────────────────────────────────────
 *
 * `computeLocationMatch(ipinfo, shipping)` compares the IP against
 * `order.shippingAddress`. Every sentence built from its verdict said
 * **billing**:
 *
 *   generateSummary        "Location matches billing country."
 *   generateBankParagraph  "consistent with the customer's billing details"
 *   visa_10_4_fraud        "the same country as the billing and shipping address"
 *
 * So a bank-facing paragraph described a comparison that never ran — and the
 * Visa sentence went further, asserting a relationship between the billing and
 * shipping addresses, which is the RETIRED agreement claim.
 *
 * The collector is deliberately NOT changed to compare billing. Which address
 * an IP should be checked against is an evidence-design decision with its own
 * consequences; silently switching it under a copy fix would be exactly the
 * kind of unreviewed change this whole series exists to stop.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  computeLocationMatch,
  generateSummary,
  generateBankParagraph,
} from "@/lib/packs/sources/deviceLocationSource";
import { visa_10_4_fraud } from "@/lib/defence/reasonCodes/visa_10_4_fraud";

const ROOT = resolve(__dirname, "../..");
const SRC = readFileSync(resolve(ROOT, "lib/packs/sources/deviceLocationSource.ts"), "utf8");

const ipinfo = { country: "SE", city: "Stockholm" } as never;
const shipping = { city: "Stockholm", countryCode: "SE" };

describe("the comparison target is shipping, and stays that way", () => {
  it("computeLocationMatch takes the SHIPPING address", () => {
    /* Pinned so a later "fix" that repoints it at billing has to be a
     * deliberate, reviewed change rather than a quiet one. */
    expect(SRC).toMatch(/export function computeLocationMatch\(\s*\n?\s*ipinfo: IpinfoResponse \| null,\s*\n?\s*shipping:/);
    expect(computeLocationMatch(ipinfo, shipping)).not.toBe("unknown");
  });

  it("a country difference is measured against shipping", () => {
    expect(computeLocationMatch(ipinfo, { city: "Oslo", countryCode: "NO" })).toBe(
      "different_country",
    );
  });
});

describe("no IP-location surface invents a billing relationship", () => {
  const MATCHES = ["same_city", "same_country", "different_country"] as const;

  for (const match of MATCHES) {
    it(`generateSummary(${match}) does not mention billing`, () => {
      const text = generateSummary(
        ipinfo,
        shipping as never,
        match as never,
        { vpn: false, proxy: false, hosting: false } as never,
        "consistent" as never,
      );
      expect(text.toLowerCase()).not.toContain("billing");
    });
  }

  it("generateBankParagraph describes the shipping destination, not billing", () => {
    const text = generateBankParagraph(
      ipinfo,
      1 as never,
      "consistent" as never,
      "same_country" as never,
      { country: "SE" } as never,
    );
    expect(text).not.toBeNull();
    expect(text!.toLowerCase()).not.toContain("billing");
    expect(text!.toLowerCase()).toContain("shipping");
  });

  it("no surface asserts billing↔shipping agreement — the retired claim", () => {
    /* The Visa sentence used to say "the same country as the billing and
     * shipping address", which states a relationship between the two. */
    for (const text of [SRC, visa_10_4_fraud.promptBody]) {
      expect(text).not.toMatch(/billing and shipping address/i);
      expect(text).not.toMatch(/billing\s*(?:↔|and|matches)\s*shipping\s+(?:address(?:es)?)\s+(?:match|agree)/i);
    }
  });

  it("the Visa module's IP guidance names shipping and forbids the billing framing", () => {
    expect(visa_10_4_fraud.promptBody).toMatch(/same country as the shipping destination/);
    expect(visa_10_4_fraud.promptBody).toMatch(/comparison is against the SHIPPING address/);
    expect(visa_10_4_fraud.promptBody).toMatch(/retired agreement claim/);
  });

  it("its pre-gate description matches the gate that actually runs", () => {
    expect(visa_10_4_fraud.promptBody).not.toMatch(/same country\/city as billing/);
    expect(visa_10_4_fraud.promptBody).toMatch(/same country\/city as the SHIPPING address/);
  });
});
