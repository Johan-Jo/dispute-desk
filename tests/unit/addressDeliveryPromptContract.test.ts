/**
 * No runtime prompt prints an address-delivery sentence.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────
 *
 * The 2026-08-11 post-deploy canary rebuilt four blume-box cases. Three of the
 * four packages failed deterministic validation on `unauthorized_claim` /
 * `address_delivery`, across `chronologyArgument`, `fulfillmentArgument` and
 * `paymentAuthenticationArgument`.
 *
 * The approved facts for those cases carry NO address. The payload was clean —
 * `order_record`, `shipping_tracking`, `delivery_proof`, `payment_authentication`
 * and the rest expose carrier, tracking, timestamps and flags, and not one of
 * them contains a street, city or postcode. So the model was not reading an
 * address; it was reproducing one from its instructions.
 *
 * Rule 14 printed three:
 *
 *     WRONG → "the parcel was delivered to the cardholder's verified address"
 *     WRONG → "delivery was made to the address on file"
 *     WRONG → "the billing and shipping addresses match"
 *
 * ── WHY THIS KEEPS HAPPENING ──────────────────────────────────────────
 *
 * This is the same mechanism as the AVS regression, one rule further down, and
 * it survived that fix because only the AVS examples were removed. An
 * illustration of a banned claim is still an instance of the claim, sitting in
 * the context window on every call — including the calls where the case holds
 * no evidence for it. Framing a sentence as WRONG does not remove it from the
 * prompt.
 *
 * So this file asserts the property structurally, across EVERY runtime prompt
 * body rather than the one that happened to be wrong: base, all reason-code
 * modules, all family overlays. A future rule that reaches for an illustration
 * fails here.
 */

import { describe, it, expect } from "vitest";
import { BASE_SYSTEM_PROMPT, CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";
import { ALL_REASON_CODE_MODULES } from "@/lib/defence/reasonCodes/registry";
import { ALL_REASON_CODE_FAMILIES } from "@/lib/defence/reasonCodes/familyRegistry";

/** Every cached system block the model can receive, by name. */
const RUNTIME_PROMPTS: Array<[string, string]> = [
  ["BASE_SYSTEM_PROMPT", BASE_SYSTEM_PROMPT],
  ...ALL_REASON_CODE_MODULES.map(
    (m) => [`module:${m.key}`, m.promptBody ?? ""] as [string, string],
  ),
  ...(ALL_REASON_CODE_FAMILIES as Array<{ key: string; overlayPromptBody?: string }>).map(
    (f) => [`family:${f.key}`, f.overlayPromptBody ?? ""] as [string, string],
  ),
];

/**
 * Sentence shapes that attach a delivery to an address, or relate two
 * addresses. Shape-based, because the point is not to ban three specific
 * strings — it is that no concrete instance of the claim may appear.
 */
const ADDRESS_DELIVERY_SHAPES: Array<[string, RegExp]> = [
  ["delivered to/at an address", /deliver\w*[^."]{0,40}\b(?:to|at)\s+the\s+[^."]{0,40}address/i],
  ["an address received the parcel", /address[^."]{0,30}\breceived\b/i],
  ["billing↔shipping agreement", /billing and shipping addresses/i],
  ["address on file / of record as a destination", /\b(?:to|at)\s+the\s+address\s+(?:on\s+file|of\s+record)/i],
];

describe("no runtime prompt prints an address-delivery claim", () => {
  it("the corpus under test is the real one, and non-empty", () => {
    /* Guard the guard. If the registries were renamed or came back empty,
     * every assertion below would pass over nothing. */
    expect(RUNTIME_PROMPTS.length).toBeGreaterThan(10);
    expect(BASE_SYSTEM_PROMPT.length).toBeGreaterThan(2000);
    expect(ALL_REASON_CODE_MODULES.length).toBeGreaterThan(3);
  });

  for (const [label, pattern] of ADDRESS_DELIVERY_SHAPES) {
    it(`no prompt contains: ${label}`, () => {
      const offenders = RUNTIME_PROMPTS.filter(([, body]) => pattern.test(body)).map(
        ([name]) => name,
      );
      expect(offenders, `${label} appears in: ${offenders.join(", ")}`).toEqual([]);
    });
  }

  it("the three sentences that actually caused the failures are gone", () => {
    for (const [, body] of RUNTIME_PROMPTS) {
      expect(body).not.toContain("delivered to the cardholder's verified address");
      expect(body).not.toContain("delivery was made to the address on file");
      expect(body).not.toContain("the billing and shipping addresses match");
    }
  });
});

/* ── The rule still prohibits, and still permits ─────────────────────── */

describe("rule 14 states the prohibition as a class", () => {
  it("still forbids characterising the delivery destination", () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/"address_delivery" is NOT authorized/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/never characterise the DELIVERY DESTINATION at all/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/nothing true you can say about where the parcel went/);
  });

  it("explains why no counter-example is printed", () => {
    expect(BASE_SYSTEM_PROMPT).toMatch(/NO EXAMPLE OF THE FORBIDDEN SENTENCE IS PRINTED HERE/);
  });

  it("KEEPS the permitted delivery wording, which carries no address", () => {
    /* The positive template is safe and useful — a model given nothing to copy
     * invents, which is the failure mode one level up. Both examples cite
     * carrier, tracking and date only. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/the carrier confirmed delivery on 12 May 2026/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/the carrier recorded a signature on delivery/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/Permitted delivery wording/);
  });

  it("points a section with no expressible fact at omission, not invention", () => {
    /* The three failures were in sections the model had to fill. Rules 9 and 13
     * already permit omission; rule 14 now names that as the answer here. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/return an empty string for it and list it in omittedSections/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/An empty section is correct/);
  });

  it("prohibits the OTHER nouns for a place, not just 'address'", () => {
    /* v13 named addresses and nothing else, so "the goods reached their
     * destination" read as permitted while `classifyAddressDeliveryClaim`
     * rates it `affirmative` — DESTINATION_TERMS has covered it all along.
     * Five production packages failed on that shape on 2026-08-13. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/A PLACE IS AN ADDRESS, WHATEVER YOU CALL IT/);
    // The list wraps across lines in the template literal, so match tolerantly
    // on each noun rather than on one fragile single-line string.
    for (const noun of ["destination", "premises", "residence", "home", "location"]) {
      expect(BASE_SYSTEM_PROMPT, `rule 14 must name "${noun}"`).toContain(noun);
    }
  });

  it("tells the model to stop at the evidence, not summarise it as an arrival", () => {
    /* Every one of the five was a CLOSING sentence restating correctly worded
     * carrier/tracking/date evidence as an arrival. The evidence was right;
     * the summary was the claim. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/DO NOT CLOSE A SECTION BY RESTATING THE DELIVERY AS AN ARRIVAL/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/Stop at the evidence/);
  });

  it("STILL prints no instance of the forbidden claim", () => {
    /* v13's finding: an illustration of a banned claim is still an instance of
     * it, sitting in the context window on every call — three of four canary
     * packages reproduced the printed examples. The new block is a
     * prohibition, not a sample. */
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/reached (its|their) (intended )?destination/i);
    expect(BASE_SYSTEM_PROMPT).not.toMatch(/delivered to the .*address/i);
  });

  it("the cached prompt was re-versioned", () => {
    // Without a bump the corrected block would sit behind the cached old one.
    //
    // `>=`, not `toBe`. The contract is that this rule is not serving from a
    // stale cache — which an exact pin does not actually test. What it tests is
    // that nobody ever bumps the version again, so it fails on every CORRECT
    // change too; it failed on v15, whose only purpose was to fix a defect in
    // this very rule. A tripwire that fires on the fix is noise, and noise is
    // what gets suppressed.
    expect(CURRENT_PROMPT_VERSION).toBeGreaterThanOrEqual(14);
  });

  it("binds the summarising sections by name (v15)", () => {
    /* v14 told the model to "stop at the evidence" and cited fulfillmentArgument
     * and conclusion. executiveSummary was never named, and "stop at the
     * evidence" is close to self-contradictory in a section that exists to
     * restate — so package 6b47d368 wrote the arrival into the summary anyway,
     * after a retry, at prompt 14. Naming the sections is half the fix. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/THE SUMMARISING SECTIONS ARE NOT EXEMPT/);
    expect(BASE_SYSTEM_PROMPT).toMatch(/executiveSummary and conclusion are bound by this rule/);
    /* The other half: the rule must give those sections somewhere else to go.
     * Prohibition alone is what already failed — the section still had to close
     * on something, and the only thing it had was the delivery. */
    expect(BASE_SYSTEM_PROMPT).toMatch(/close on something else|close on nothing/);
  });
});
