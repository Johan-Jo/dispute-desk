/**
 * The IP-location signal has ONE approved sentence, and the model quotes it.
 *
 * ── HOW THIS WAS FOUND ────────────────────────────────────────────────
 *
 * The 2026-08-11 post-deploy canary still failed 3 of 4 packages on
 * `unauthorized_claim` / `address_delivery`, after the prompt fix that was
 * supposed to stop it. Reading the rejected narratives — rather than inferring
 * again — located the offending sentence exactly:
 *
 *   paymentAuthenticationArgument:
 *   "The order IP geolocated to the same country as the billing and shipping
 *    address, with no VPN, proxy, or datacenter signals…"
 *
 * An assertion about two addresses, from a fact that names neither. That is the
 * retired billing/shipping agreement claim, and `classifyAddressDeliveryClaim`
 * rates it `ambiguous`, which blocks.
 *
 * ── WHY THE PREVIOUS FIX DIDN'T WORK ──────────────────────────────────
 *
 * PR #530 corrected the prompt's IP example to name the shipping destination,
 * and #533 removed the address-delivery counter-examples. Neither helped,
 * because the model was not copying an example — the phrase appears NOWHERE in
 * the pack or the facts, verified against production. It was filling a gap:
 * the `ip_location` fact carried `locationMatch` alone, a bare enum, and the
 * model had to invent prose for it.
 *
 * Instructions cannot close a gap that the data leaves open. The fix is the
 * one that already works for AVS: the wording is produced by the collector
 * that owns the comparison, travels on the fact, and the model quotes it
 * verbatim or writes nothing.
 */

import { describe, it, expect } from "vitest";
import { classifyAddressDeliveryClaim } from "@/lib/defence/claimCapabilities";
import { visa_10_4_fraud } from "@/lib/defence/reasonCodes/visa_10_4_fraud";
import { generateBankParagraph } from "@/lib/packs/sources/deviceLocationSource";

/* ── 1. The sentence that actually failed in production ──────────────── */

const PRODUCTION_FAILURE =
  "The order IP geolocated to the same country as the billing and shipping address, " +
  "with no VPN, proxy, or datacenter signals — consistent with a cardholder placing " +
  "the order from their usual location.";

describe("the sentence that failed", () => {
  it("is still refused by the unchanged structural guard", () => {
    /* The guard is correct and is NOT being relaxed. The sentence asserts a
     * relationship between two addresses on a case that holds no
     * address_delivery capability. */
    expect(classifyAddressDeliveryClaim(PRODUCTION_FAILURE)).not.toBe("none");
  });

  it("the APPROVED sentence is accepted by that same guard", () => {
    /* The fix is only real if what we now hand the model actually passes. */
    const approved = generateBankParagraph(
      { country: "SE", city: "Stockholm" } as never,
      1 as never,
      "consistent" as never,
      "same_country" as never,
      { country: "SE" } as never,
    );
    expect(approved).not.toBeNull();
    expect(classifyAddressDeliveryClaim(approved!)).toBe("none");
    expect(approved!.toLowerCase()).not.toContain("billing");
  });
});

/* ── 2. The fact carries the wording ─────────────────────────────────── */

describe("the ip_location fact carries an approved sentence", () => {
  it("bankLocationSummary is extracted from the collector's bankParagraph", async () => {
    const { classifyFacts } = await import("@/lib/defence/factClassifier");
    expect(typeof classifyFacts).toBe("function");
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(__dirname, "../../lib/defence/factClassifier.ts"),
      "utf8",
    );
    /* There are TWO `case "ip_location_check"` labels in this file, in
     * different switches. The value-extraction one is the block form; the end
     * marker must be searched AFTER it, or the slice runs backwards and comes
     * back empty — which is how this assertion first passed over nothing. */
    const start = src.indexOf('case "ip_location_check": {');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('case "device_session_consistency"', start));
    expect(block.length).toBeGreaterThan(100);
    expect(block).toMatch(/bankLocationSummary/);
    expect(block).toMatch(/p\.bankParagraph/);
    // Absent or blank must yield null, not an empty string the model may pad.
    expect(block).toMatch(/trim\(\)\.length > 0/);
  });

  it("the collector remains the single owner of the comparison and its wording", () => {
    /* If the sentence were rebuilt here from `locationMatch`, there would be
     * two producers again and they would drift — which is how the copy came to
     * describe billing while the code compared shipping. */
    const approved = generateBankParagraph(
      { country: "SE" } as never,
      1 as never,
      "consistent" as never,
      "same_country" as never,
      { country: "SE" } as never,
    );
    /* Wording changed 2026-08-13 (option A): the sentence now names the IP and
     * what its country is compared to. The point this case pins is unchanged —
     * ONE owner produces the sentence, so the copy cannot drift from the
     * comparison the collector actually ran. */
    expect(approved).toContain("shipping destination");
  });
});

/* ── 3. The prompt requires a verbatim copy, or silence ──────────────── */

describe("the Visa module's IP rule", () => {
  const BODY = visa_10_4_fraud.promptBody;

  it("permits ONLY a verbatim copy of bankLocationSummary", () => {
    expect(BODY).toMatch(/ONLY text you may write about it is a VERBATIM copy/);
    expect(BODY).toMatch(/bankLocationSummary/);
    expect(BODY).toMatch(/do not describe the IP signal in your own words/);
  });

  it("requires silence when the summary is absent", () => {
    expect(BODY).toMatch(/write NOTHING about IP, geolocation or where the order was placed from/);
  });

  it("no longer supplies a phrasing for the model to adapt", () => {
    /* The old rule offered "Acceptable phrasing: …". An example the model may
     * adapt is a gap with a suggestion in it, and adapting is exactly what
     * produced the failure. */
    expect(BODY).not.toMatch(/Acceptable phrasing/);
    expect(BODY).not.toMatch(/The order IP geolocated to the same country as/);
  });

  it("names shipping as the comparison and forbids the agreement claim", () => {
    expect(BODY).toMatch(/COMPARISON IS AGAINST THE SHIPPING ADDRESS AND NOTHING ELSE/);
    expect(BODY).toMatch(/retired agreement claim/);
  });

  it("the cached module block was re-versioned", () => {
    expect(visa_10_4_fraud.version).toBe(10);
  });

  it("no runtime prompt asserts a relationship between the two order addresses", () => {
    expect(BODY).not.toMatch(/billing and shipping address/i);
  });
});


/* ── 4. The test that was missing twice ──────────────────────────────── */

describe("the approved sentence survives what the model writes AROUND it", () => {
  /* THE LESSON OF THIS WHOLE SERIES.
   *
   * The sentence was verified in isolation and shipped twice; both times the
   * package still failed, because the model quotes the sentence and then
   * CONTINUES it. This is the real production tail, from 2026-08-11:
   *
   *   "… — consistent with an order placed from a location aligned with the
   *    cardholder's account details."
   *
   * Neither half trips `classifyAddressDeliveryClaim` alone. Together, with
   * the previous wording, they are `affirmative` — the shipping reference gave
   * the tail an address to bind to. Testing the sentence by itself proved
   * nothing, twice.
   */
  const MODEL_TAIL =
    " — consistent with an order placed from a location aligned with the cardholder's account details.";

  const approved = () =>
    generateBankParagraph(
      { country: "SE" } as never,
      1 as never,
      "consistent" as never,
      "same_country" as never,
      { country: "SE" } as never,
    )!;

  it("passes alone", () => {
    expect(classifyAddressDeliveryClaim(approved())).toBe("none");
  });

  it("passes WITH the model's appended clause", () => {
    expect(classifyAddressDeliveryClaim(approved().replace(/\.$/, "") + MODEL_TAIL)).toBe("none");
  });

  it("guard the guard — the OLD wording plus that same tail still fails", () => {
    /* Proves the assertion above is discriminating: the detector was not
     * weakened, the sentence was changed. */
    const OLD =
      "The order originated from the same country recorded for shipping on this order, with no VPN, proxy or datacenter signals";
    expect(classifyAddressDeliveryClaim(OLD + MODEL_TAIL)).not.toBe("none");
  });
});
