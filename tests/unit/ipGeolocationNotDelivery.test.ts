/**
 * An IP geolocating to a country is not a parcel arriving at an address.
 *
 * ── WHY THE SENTENCE NEEDED THIS ──────────────────────────────────────
 *
 * The bank-facing IP sentence went through three rewrites, each optimising to
 * survive `classifyAddressDeliveryClaim` rather than to inform a reviewer,
 * and arrived at:
 *
 *   "The order originated from the same country recorded on this order,
 *    with no VPN, proxy or datacenter signals."
 *
 * "the order" is both subject and reference point, the comparison names no
 * second term, and the IP — the actual evidence — is never mentioned. It is
 * safe and close to meaningless.
 *
 * Naming the shipping destination is what the earlier versions could not do:
 * the model quotes the sentence and CONTINUES it, and a destination noun
 * gives that trailing clause an address to bind to (three packages failed
 * that way in the #535 window). So the detector has to distinguish an IP
 * GEOLOCATING to a country from a PARCEL ARRIVING at a place.
 *
 * ── WHAT THIS FILE IS FOR ─────────────────────────────────────────────
 *
 * The false-negative half is written FIRST and must pass unchanged before
 * and after the detector change. A false positive costs a regeneration; a
 * false negative sends an unsupported claim to an issuer. If widening the
 * detector for the IP sentence lets any of the MUST_BLOCK cases through, the
 * widening is wrong — not the test.
 */

import { describe, it, expect } from "vitest";
import { classifyAddressDeliveryClaim } from "@/lib/defence/claimCapabilities";
import { generateBankParagraph } from "@/lib/packs/sources/deviceLocationSource";

/* ── 1. THE GUARDS. Nothing here may ever pass. ────────────────────── */

const MUST_BLOCK: Array<[string, string]> = [
  [
    "the plain delivery-to-address claim",
    "The parcel was delivered to the cardholder's billing address.",
  ],
  [
    "delivery to a shipping destination",
    "The goods were delivered to the shipping destination on 12 May 2026.",
  ],
  [
    "arrival at a destination",
    "The shipment arrived at its destination on 12 May 2026.",
  ],
  [
    "the closing-summary shape that failed five production packages",
    "The available delivery records are consistent with the goods having reached their destination.",
  ],
  [
    "an IP clause does not license a delivery claim beside it",
    "The order was placed from an IP address in the shipping destination country, and the parcel was delivered to that address.",
  ],
  [
    "an IP clause does not license a delivery claim after a semicolon",
    "The order IP geolocated to the same country as the shipping destination; the goods reached that destination.",
  ],
  [
    "'shipped to' with a destination noun",
    "The order shipped to the customer's stated destination.",
  ],
  [
    "a literal street address as the destination",
    "The package went to 42 Elm Road.",
  ],
  /* ── Added 2026-08-14 with the paraphrase-tolerant exemption below.
   *
   * Widening what the detector ALLOWS is the moment to widen what it must
   * still refuse. Each of these puts an IP mention and a shipping-country
   * comparand in one sentence — the exemption's own shape — with a delivery
   * predicate that must survive it. */
  [
    "a delivery predicate between the IP mention and the comparand",
    "The IP record shows the parcel was delivered in the same country as the shipping destination.",
  ],
  [
    "an IP mention that arrives only AFTER the delivery claim",
    "The parcel was delivered to the same country as the shipping destination, per the IP record.",
  ],
  [
    "an IP clause does not license a delivery claim joined with 'and'",
    "The order IP geolocated to the same country as the shipping destination and the parcel reached that address.",
  ],
];

/* ── 1b. THE PARAPHRASES. The model rewords the approved sentence. ──
 *
 * `narrativeWriter` tells the model to quote `generateBankParagraph`'s
 * sentence; it does not always. On 2026-08-14 it wrote the subject form
 * ("The order IP address geolocated to…") instead of the predicate form
 * ("The order was placed from an IP address geolocating to…"), the
 * lead-in-keyed exemption missed, and blume-box dispute 11051073729 reached
 * its deadline with nothing filed. Same fact, same comparison, one reworded
 * opening. An allowlist that only knows one phrasing is a denylist wearing
 * the opposite sign. */
const MUST_ALLOW: Array<[string, string]> = [
  [
    "the production paraphrase that cost dispute 11051073729 its deadline",
    "The order IP address geolocated to the same country as the order's shipping destination, with no VPN, proxy, or datacenter signals detected — consistent with a cardholder placing the order from their usual location.",
  ],
  [
    "the subject form with 'resolved' and 'shipping address'",
    "The customer's IP address resolved to the same country as the shipping address.",
  ],
  [
    "a bare IP mention with no geolocation verb at all",
    "The order was placed from an IP address in the same country as the shipping destination.",
  ],
];

describe("paraphrases of the approved IP sentence still pass", () => {
  for (const [name, text] of MUST_ALLOW) {
    it(`allows: ${name}`, () => {
      expect(classifyAddressDeliveryClaim(text), `for: ${text}`).toBe("none");
    });
  }
});

describe("false-negative guards — these must block, before and after", () => {
  for (const [name, text] of MUST_BLOCK) {
    it(`blocks: ${name}`, () => {
      const v = classifyAddressDeliveryClaim(text);
      expect(v === "affirmative" || v === "ambiguous", `got "${v}" for: ${text}`).toBe(true);
    });
  }
});

/* ── 2. THE SENTENCE ITSELF. ───────────────────────────────────────── */

const approved = () =>
  generateBankParagraph(
    { country: "SE", city: "Stockholm" } as never,
    1 as never,
    "consistent" as never,
    "same_country" as never,
    { country: "SE" } as never,
  )!;

/** The real production tail — the model quotes the sentence, then continues. */
const MODEL_TAIL =
  " — consistent with an order placed from a location aligned with the cardholder's account details.";

describe("the approved IP sentence", () => {
  it("names the IP — the evidence, not 'the order'", () => {
    expect(approved().toLowerCase()).toContain("ip address");
  });

  it("states what the country is compared TO", () => {
    /* The v13 sentence compared "the order" to "this order". A reviewer
     * cannot extract a fact from a comparison with one term. */
    expect(approved().toLowerCase()).toMatch(/shipping (destination|address)/);
  });

  it("still carries the privacy signals", () => {
    expect(approved().toLowerCase()).toMatch(/vpn|proxy|datacenter/);
  });

  it("passes the structural guard alone", () => {
    expect(classifyAddressDeliveryClaim(approved())).toBe("none");
  });

  it("passes WITH the model's appended clause — the lesson of #537", () => {
    /* Verified in isolation and shipped twice before; both times the package
     * still failed, because the model continues the sentence. */
    expect(classifyAddressDeliveryClaim(approved().replace(/\.$/, "") + MODEL_TAIL)).toBe("none");
  });

  it("guard the guard — a real delivery claim plus that same tail still fails", () => {
    /* Proves the assertion above is discriminating rather than vacuous. */
    const REAL = "The parcel was delivered to the cardholder's shipping destination";
    expect(classifyAddressDeliveryClaim(REAL + MODEL_TAIL)).not.toBe("none");
  });
});

/* ── 3. THE GENERATOR ENFORCES ITS OWN PRECONDITION. ───────────────── */

describe("generateBankParagraph refuses to assert a match nobody computed", () => {
  /* Every parameter but `ipinfo` was `_`-prefixed and ignored, so this
   * returned the same COUNTRY-MATCH claim whenever an IPinfo response
   * existed. Gating lived only at the single call site — which held, but the
   * export advertised itself as safe to call directly when it was not. Same
   * shape as the defects PR-C1 and PR-C4 retired: copy asserting authority
   * the derivation never established. */
  const ipinfo = { country: "SE", city: "Stockholm" } as never;
  const clean = {} as never;
  const seShipping = { country: "SE" } as never;

  it("emits the sentence when the signal genuinely qualifies", () => {
    const t = generateBankParagraph(ipinfo, 1 as never, "consistent" as never, "same_country" as never, seShipping, clean);
    expect(t).not.toBeNull();
    expect(t!.toLowerCase()).toContain("ip address");
  });

  it("returns null on a country MISMATCH — the dangerous case", () => {
    expect(
      generateBankParagraph(ipinfo, 1 as never, "consistent" as never, "different_country" as never, seShipping, clean),
    ).toBeNull();
  });

  it("returns null on an unknown match", () => {
    expect(
      generateBankParagraph(ipinfo, 1 as never, "consistent" as never, "unknown" as never, seShipping, clean),
    ).toBeNull();
  });

  it("returns null when the IP routes through a VPN / proxy / datacenter", () => {
    for (const flag of ["vpn", "proxy", "hosting"]) {
      expect(
        generateBankParagraph(
          ipinfo, 1 as never, "consistent" as never, "same_country" as never, seShipping,
          { [flag]: true } as never,
        ),
        `${flag} must suppress the sentence — it claims "no VPN, proxy or datacenter signals"`,
      ).toBeNull();
    }
  });

  it("returns null when the customer's IP is variable across orders", () => {
    expect(
      generateBankParagraph(ipinfo, 1 as never, "variable" as never, "same_country" as never, seShipping, clean),
    ).toBeNull();
  });

  it("returns null with no shipping country — nothing to compare against", () => {
    expect(
      generateBankParagraph(ipinfo, 1 as never, "consistent" as never, "same_country" as never, { country: null } as never, clean),
    ).toBeNull();
    expect(
      generateBankParagraph(ipinfo, 1 as never, "consistent" as never, "same_country" as never, null, clean),
    ).toBeNull();
  });

  it("returns null with no IPinfo response at all", () => {
    expect(
      generateBankParagraph(null, 1 as never, "consistent" as never, "same_country" as never, seShipping, clean),
    ).toBeNull();
  });
});
