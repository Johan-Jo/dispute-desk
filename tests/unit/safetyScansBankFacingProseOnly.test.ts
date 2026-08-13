/**
 * The safety predicate judges the prose that reaches the ISSUER, not the
 * generator's build diagnostics.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * `readNarrative` walked every string in `narrative_json`, `warnings` and
 * `omittedSections.reason` included. Neither reaches a bank: measured
 * 2026-08-13, `composePdfBlocks` reads `omittedSections[].sectionKey` (an
 * enum) and nothing anywhere reads `reason` or `warnings`.
 *
 * Judging them produced a self-negating block. Package v4 of dispute
 * 392379b2 (#347625, blume-box, due 2026-08-16) was refused on this
 * generator note:
 *
 *   "claimCapabilities array is empty; no delivery, address, or fulfillment
 *    claims have been made."
 *
 * — the model correctly reporting it made NO address claim. "delivery" +
 * "address" in one sentence, unresolvable, failed closed. Four packages with
 * `validation_status: ok` and a rendered PDF were unfileable for saying they
 * were clean, and the merchant was told to "regenerate" a package that had
 * nothing wrong with it.
 *
 * It also split the two gates — `validateNarrative` passed these (it judges
 * the nine sections) while this predicate blocked them (it judged
 * everything), which is how a `draft / ok / PDF` row shows "cannot be filed".
 */

import { describe, it, expect } from "vitest";
import { assessPackageCandidateSafety } from "@/lib/defence/packageSafety";

const SECTION_KEYS = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
] as const;

/** The measured production shape: 13-key facts, 9 sections + 2 metadata. */
function narrative(
  overrides: Partial<Record<string, unknown>> = {},
  sectionText = "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 123).",
) {
  const n: Record<string, unknown> = {};
  for (const k of SECTION_KEYS) n[k] = { text: sectionText, usedFactIds: [] };
  n.omittedSections = [];
  n.warnings = [];
  return { ...n, ...overrides };
}

const FACTS = [
  {
    id: "f1",
    category: "delivery_proof",
    label: "Delivery",
    source: "carrier",
    strength: "moderate",
    bankEligible: true,
    includeInBankNarrative: true,
    internalOnly: false,
    merchantVisible: true,
    submissionRisk: false,
    sourceRef: null,
    confidence: null,
    value: { proofType: "delivered_confirmed" },
  },
];

describe("build diagnostics are not judged as issuer-facing claims", () => {
  it("THE PRODUCTION CASE: the generator's own 'no claims made' note", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({
        warnings: [
          "claimCapabilities array is empty; no delivery, address, or fulfillment claims have been made.",
        ],
      }),
    });
    expect(v.safe, JSON.stringify(v.reasons)).toBe(true);
  });

  it("an omittedSections reason naming an address does not block", () => {
    /* The model explains WHY it omitted a section. That explanation is a
     * build diagnostic — `composePdfBlocks` reads only `sectionKey`. */
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({
        omittedSections: [
          {
            sectionKey: "fulfillmentArgument",
            reason: "no delivery-to-address evidence is available for this order",
          },
        ],
      }),
    });
    expect(v.safe, JSON.stringify(v.reasons)).toBe(true);
  });

  it("both at once, as a real failed build would carry them", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({
        warnings: ["f11 (ip_location): category is in the avoid list — fact excluded."],
        omittedSections: [
          { sectionKey: "policyArgument", reason: "the parcel was delivered to the billing address" },
        ],
      }),
    });
    expect(v.safe, JSON.stringify(v.reasons)).toBe(true);
  });
});

describe("section prose is still judged, in full and at any depth", () => {
  it("an affirmative claim in a SECTION still blocks", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative(
        {},
        "The parcel was delivered to the cardholder's billing address on 12 May 2026.",
      ),
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("affirmative_address_delivery_claim");
  });

  it("an ambiguous claim in a SECTION still blocks — fail-closed is intact", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({}, "Delivery to the customer's address."),
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("ambiguous_address_delivery_claim");
  });

  it("a claim nested inside a section is still reached (defence in depth)", () => {
    /* `collectStrings` recurses, and that is deliberately preserved for the
     * nine sections: an unknown nested branch inside a section must still
     * have its prose read. Only the METADATA keys stopped being walked. */
    const n = narrative();
    (n.executiveSummary as Record<string, unknown>) = {
      text: "Clean summary.",
      usedFactIds: ["The parcel was delivered to the billing address."],
    };
    const v = assessPackageCandidateSafety({ factsJson: FACTS, narrativeJson: n });
    expect(v.safe).toBe(false);
  });
});

describe("the schema guard is unchanged", () => {
  it("a malformed warnings array is still unreadable", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({ warnings: [{ not: "a string" }] }),
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("a malformed omittedSections entry is still unreadable", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({ omittedSections: [{ sectionKey: "nope", reason: "x" }] }),
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("an unknown top-level key is still unreadable", () => {
    const v = assessPackageCandidateSafety({
      factsJson: FACTS,
      narrativeJson: narrative({ surpriseKey: { text: "hi", usedFactIds: [] } }),
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });
});
