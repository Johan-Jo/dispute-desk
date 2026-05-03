/**
 * Regression suite for the bank-facing IP/location leakage bug.
 *
 * Background: dispute AEE832AD shipped with the rebuttal containing
 * "The transaction originated from an IP address located in Rio de
 * Janeiro, Rio de Janeiro, BR, associated with AS18881 TELEFÔNICA
 * BRASIL S.A. … While the purchase location differs from the
 * shipping destination, this is consistent with legitimate
 * cross-border purchasing behavior and does not indicate
 * unauthorized use." That is a leak: the BR-IP / US-shipping
 * mismatch was not bank-eligible (pack-side `bankEligible: false`)
 * yet the rebuttal still leaked city / region / country / ISP / ASN
 * AND defensively reframed the mismatch as "cross-border purchasing
 * behavior".
 *
 * Two contracts are pinned here:
 *
 *   1. BANNED_NARRATIVES — phrases that must never exist in
 *      bank-facing copy under any input. These are codebase-level
 *      invariants: defensive reframings of risk signals are
 *      categorically forbidden, regardless of which surface
 *      generates them.
 *
 *   2. Structural no-leak — for any input where the IP signal is
 *      not bank-eligible, the actual values from the fixture
 *      (data.ipCity, data.ipRegion, data.ipCountry, data.ipOrg)
 *      must not appear in the output. We assert against the live
 *      fixture data, not hardcoded strings, so the test stays
 *      correct if fixtures are renamed or relocalized.
 */

import { describe, it, expect } from "vitest";
import { extractEvidenceDataFromPack } from "../evidenceDataFromPack";
import { buildBankGradeRebuttal, type EvidenceData } from "../responseEngine";

/**
 * Phrases that are categorically forbidden in bank-facing copy. These
 * are the literal narrative shapes — and lexical fragments of them —
 * that explain away or soften a risk signal. If a future change
 * reintroduces any of these (in this file or a parallel formatter),
 * this guard fires.
 */
const BANNED_NARRATIVES = [
  "cross-border",
  "consistent with legitimate cross-border",
  "does not indicate unauthorized use",
  "differs from the shipping destination",
] as const;

/** Assert no banned defensive narrative appears in `text`. */
function expectNoBannedNarrative(text: string): void {
  for (const phrase of BANNED_NARRATIVES) {
    expect(text, `bank-facing text must not contain "${phrase}"`).not.toContain(phrase);
  }
}

/**
 * Assert that none of the IP-signal values from `data` appear in
 * `text`. The values are read live from the EvidenceData under test
 * — the test is not coupled to any specific city/region/country
 * string, so it stays correct under fixture changes and across
 * locales.
 */
function expectNoIpSignalLeak(text: string, data: EvidenceData): void {
  for (const [field, value] of [
    ["ipCity", data.ipCity],
    ["ipRegion", data.ipRegion],
    ["ipCountry", data.ipCountry],
    ["ipOrg", data.ipOrg],
  ] as const) {
    if (typeof value === "string" && value.trim().length > 0) {
      expect(
        text,
        `bank-facing text must not contain ${field} value "${value}"`,
      ).not.toContain(value);
    }
  }
}

const BR_US_MISMATCH_SECTIONS = [
  // Order ships to US.
  {
    type: "order",
    label: "Order #1074",
    source: "shopify_order",
    fieldsProvided: ["order_confirmation"],
    data: {
      orderName: "#1074",
      financialStatus: "PAID",
      shippingAddress: { city: "Key Biscayne", countryCode: "US" },
      billingAddress: { city: "New York", countryCode: "US" },
    },
  },
  // IP geolocates to Brazil. Pack-side `bankEligible: false` because
  // the country mismatch makes the signal unsafe to submit to the
  // bank. This is the exact shape produced by deviceLocationSource
  // for AEE832AD on 2026-04-25.
  {
    type: "other",
    label: "IP & Location Check",
    source: "ipinfo_io",
    fieldsProvided: ["ip_location_check"],
    data: {
      ip: "2804:1b3:7000:b37c:51a8:8de9:3646:e9a8",
      bankEligible: false,
      bankParagraph: null,
      locationMatch: "different_country",
      shippingAddress: { city: "Key Biscayne", region: "FL", country: "US" },
      ipinfo: {
        ip: "2804:1b3:7000:b37c:51a8:8de9:3646:e9a8",
        city: "Rio de Janeiro",
        region: "Rio de Janeiro",
        country: "BR",
        org: "AS18881 TELEFÔNICA BRASIL S.A",
        privacy: { vpn: false, proxy: false, hosting: false },
      },
    },
  },
];

describe("bank-facing IP leak — AEE832AD regression", () => {
  it("extracts EvidenceData with bankEligible=false and ipCountryMatchesShipping=false", () => {
    const data = extractEvidenceDataFromPack(BR_US_MISMATCH_SECTIONS);
    expect(data.bankEligible).toBe(false);
    expect(data.ipCountryMatchesShipping).toBe(false);
    // The raw IP fields are still present on EvidenceData — the
    // gate's job is to make sure they never reach bank-facing text.
    expect(data.ipCity).toBeTruthy();
    expect(data.ipCountry).toBeTruthy();
    expect(data.ipOrg).toBeTruthy();
  });

  it("rebuttal omits every IP signal value when bankEligible=false", () => {
    const data = extractEvidenceDataFromPack(BR_US_MISMATCH_SECTIONS);
    const text = buildBankGradeRebuttal(data);
    expectNoIpSignalLeak(text, data);
    expectNoBannedNarrative(text);
  });

  it("rebuttal omits every IP signal value when only ipCountryMatchesShipping=false", () => {
    // Defense in depth: even if the upstream pack flag drifts to
    // true, a country mismatch alone must still suppress the
    // paragraph.
    const data: EvidenceData = {
      ipCity: "Rio de Janeiro",
      ipRegion: "Rio de Janeiro",
      ipCountry: "BR",
      ipOrg: "AS18881 TELEFÔNICA BRASIL S.A",
      ipNoVpnProxyHosting: true,
      ipCountryMatchesShipping: false,
      bankEligible: true,
    };
    const text = buildBankGradeRebuttal(data);
    expectNoIpSignalLeak(text, data);
    expectNoBannedNarrative(text);
  });

  it("rebuttal omits every IP signal value when ipNoVpnProxyHosting is unknown", () => {
    // Unknown VPN status is treated as not-clean: bank-facing text
    // requires an explicitly clean privacy signal.
    const data: EvidenceData = {
      ipCity: "Stockholm",
      ipRegion: "Stockholm County",
      ipCountry: "SE",
      ipOrg: "AS3301 TELIA NET",
      ipNoVpnProxyHosting: null,
      ipCountryMatchesShipping: true,
      bankEligible: true,
    };
    const text = buildBankGradeRebuttal(data);
    expectNoIpSignalLeak(text, data);
    expectNoBannedNarrative(text);
    // Also assert the structural envelope is suppressed — there's
    // no IP paragraph at all, not just a paragraph with the values
    // redacted.
    expect(text).not.toContain("originated from an IP address");
    expect(text).not.toContain("No VPN, proxy, or hosting indicators");
  });
});

describe("bank-facing IP narrative — positive case still works", () => {
  it("emits the IP paragraph end-to-end when bankEligible=true and country matches", () => {
    const sections = [
      {
        type: "order",
        label: "Order #2001",
        source: "shopify_order",
        fieldsProvided: ["order_confirmation"],
        data: {
          orderName: "#2001",
          financialStatus: "PAID",
          shippingAddress: { city: "Stockholm", countryCode: "SE" },
        },
      },
      {
        type: "other",
        label: "IP & Location Check",
        source: "ipinfo_io",
        fieldsProvided: ["ip_location_check"],
        data: {
          ip: "1.2.3.4",
          bankEligible: true,
          bankParagraph: null,
          locationMatch: "match",
          ipinfo: {
            ip: "1.2.3.4",
            city: "Stockholm",
            region: "Stockholm County",
            country: "SE",
            org: "AS3301 TELIA NET",
            privacy: { vpn: false, proxy: false, hosting: false },
          },
          shippingAddress: { country: "SE" },
        },
      },
    ];
    const data = extractEvidenceDataFromPack(sections);
    expect(data.bankEligible).toBe(true);
    expect(data.ipCountryMatchesShipping).toBe(true);
    expect(data.ipNoVpnProxyHosting).toBe(true);

    const text = buildBankGradeRebuttal(data);
    // The eligible-case paragraph contains every IP signal value by
    // design. We assert each one is present, structurally — not by
    // hardcoding the joined sentence — so the test survives copy
    // tweaks (e.g. swapping commas for "and") as long as the values
    // still surface.
    expect(text).toContain(data.ipCity!);
    expect(text).toContain(data.ipRegion!);
    expect(text).toContain(data.ipCountry!);
    expect(text).toContain(data.ipOrg!);
    expect(text).toContain(
      "No VPN, proxy, or hosting indicators were detected, indicating a standard consumer network.",
    );
    // Banned defensive reframings must never appear, even in the
    // positive case.
    expectNoBannedNarrative(text);
  });
});
