/**
 * Our own boilerplate must not trip our own guard.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * "The submitted records ADDRESS the item-not-received claim: delivery was
 * confirmed by the carrier on …"
 *
 * `ADDRESS_TERMS` matches the word `address` with no part-of-speech
 * distinction, so the VERB reads as the NOUN. Coupled with "delivery" in the
 * same sentence, the thesis line is a delivery-to-address claim and the
 * package fails `unauthorized_claim` at the `thesis` layer — a layer that is
 * not model output at all, but a fact-templated string we write.
 *
 * Production #12936 (cay-collective) v6, 2026-08-13, prompt v14: the LLM prose
 * was CLEAN — the destination-phrasing fix had worked — and that is precisely
 * what exposed this. The thesis line had been carrying the trip all along,
 * masked because the model's own claims failed first.
 *
 * ── WHY A SWEEP RATHER THAN TWO ASSERTIONS ────────────────────────────
 *
 * Two templates carried the verb, but nothing stopped a third from being
 * added. Every template is rendered with a realistic fact set and judged, so
 * the next one that reaches for an address-adjacent word fails here rather
 * than on a merchant's dispute three days before its deadline.
 */

import { describe, it, expect } from "vitest";
import { THESIS_TEMPLATES } from "@/lib/defence/pdf/thesisTemplates";
import { classifyAddressDeliveryClaim } from "@/lib/defence/claimCapabilities";

/** Token placeholders resolved to the wording the real extractors emit. */
const SPECIMEN_CLAUSES: Record<string, string> = {
  deliveryClause: "delivery was confirmed by the carrier on 2026-07-06T18:16:00Z (PostNord SE)",
  digitalAccessClause: "the customer's access to the service is logged",
  refundProcessedClause: "a refund of 249.00 SEK was processed",
  communicationClause: "the customer's correspondence with the merchant is on record",
  signatureClause: "delivery was confirmed via carrier signature (PostNord SE)",
};

/** Render a template with every optional clause present — the worst case. */
function renderWorstCase(template: string): string {
  return template
    // `[[: {{token}}]]` — keep the literal text, substitute the token.
    .replace(/\[\[(.*?)\]\]/g, "$1")
    .replace(/\{\{(\w+)\}\}/g, (_m, name: string) => SPECIMEN_CLAUSES[name] ?? `the ${name} is on record`)
    .replace(/\s+/g, " ")
    .trim();
}

describe("no thesis template makes an address-delivery claim", () => {
  it("there are templates to check (guards the guard)", () => {
    expect(THESIS_TEMPLATES.length).toBeGreaterThan(0);
  });

  for (const t of THESIS_TEMPLATES) {
    it(`${t.key} passes with every optional clause present`, () => {
      const rendered = renderWorstCase(t.template);
      const verdict = classifyAddressDeliveryClaim(rendered);
      expect(verdict, `"${rendered}"`).toBe("none");
    });
  }

  it("the specific sentence that failed #12936 now passes", () => {
    const fixed =
      "The submitted records respond to the item-not-received claim: delivery was confirmed by the carrier on 2026-07-06T18:16:00Z (PostNord SE).";
    expect(classifyAddressDeliveryClaim(fixed)).toBe("none");
  });

  it("guard the guard — the OLD wording still trips it", () => {
    /* Proves the sweep above is discriminating rather than vacuously passing:
     * the detector is unchanged, the template was. */
    const broken =
      "The submitted records address the item-not-received claim: delivery was confirmed by the carrier on 2026-07-06T18:16:00Z (PostNord SE).";
    expect(classifyAddressDeliveryClaim(broken)).not.toBe("none");
  });

  it("no template uses 'address' as a verb", () => {
    /* The narrow lexical check behind the sweep. `ADDRESS_TERMS` cannot tell
     * the verb from the noun, so the word is simply unusable here. */
    for (const t of THESIS_TEMPLATES) {
      expect(t.template, `${t.key} uses the word "address"`).not.toMatch(/\baddress\b/i);
    }
  });
});
