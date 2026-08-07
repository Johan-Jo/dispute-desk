/**
 * PR-C1 — the central package-candidate safety predicate.
 *
 * Every save / forward / deadline path consults this. The properties that
 * matter operationally are the candidate-based ones: a historical unsafe
 * version stays blocked, a regenerated safe version is usable, and the
 * presence of an old unsafe version never permanently blocks a dispute.
 */

import { describe, expect, it } from "vitest";
import {
  assessPackageCandidateSafety,
  narrativeTexts,
  packageBlockSummary,
} from "../packageSafety";

const CLEAN_NARRATIVE = {
  executiveSummary: {
    text: "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
  },
  fulfillmentArgument: { text: "The carrier recorded a signature on delivery." },
};

const UNSAFE_NARRATIVE = {
  fulfillmentArgument: {
    text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
  },
};

const AMBIGUOUS_NARRATIVE = {
  fulfillmentArgument: { text: "Delivery to the customer's address." },
};

/** The full 13-key persisted fact shape, measured over 2 576 prod objects. */
const CLEAN_FACTS = [{
    id: "f1",
    category: "delivery_proof",
    label: "Delivery confirmation",
    source: "shopify_fulfillments",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    value: { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "1" },
  }];

const RETIRED_FACTS = [{
    id: "f1",
    category: "delivery_proof",
    label: "Delivery confirmation",
    source: "shopify_fulfillments",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    value: { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true },
  }];

describe("assessPackageCandidateSafety", () => {
  it("a clean candidate is safe", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(packageBlockSummary(v)).toBe("");
  });

  it("blocks on a retired delivery fact even when the narrative is clean", () => {
    const v = assessPackageCandidateSafety({
      factsJson: RETIRED_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("retired_delivery_fact");
    expect(v.retiredKeys).toContain("deliveredToVerifiedAddress");
  });

  it("blocks on collectedByCustomer too", () => {
    const v = assessPackageCandidateSafety({
      factsJson: [
        { ...CLEAN_FACTS[0], category: "shipping_tracking", value: { collectedByCustomer: true } },
      ],
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.retiredKeys).toContain("collectedByCustomer");
  });

  it("blocks on an affirmative address assertion even when facts are clean", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: UNSAFE_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("affirmative_address_delivery_claim");
  });

  it("blocks on ambiguous address language — fails closed", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: AMBIGUOUS_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("ambiguous_address_delivery_claim");
  });

  it("does NOT block on negated / prohibition language", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: {
        fulfillmentArgument: {
          text: "We do not claim the parcel was delivered to the cardholder's address.",
        },
      },
    });
    expect(v.safe).toBe(true);
  });

  // ── FAIL CLOSED ───────────────────────────────────────────────────
  //
  // An earlier revision asserted `factsJson: null, narrativeJson: null → safe`.
  // That was wrong: a final PDF whose supporting JSON cannot be inspected
  // carries an UNKNOWN claim, and an unknown claim may not be filed.

  it("null facts_json is UNREADABLE, not safe", () => {
    const v = assessPackageCandidateSafety({
      factsJson: null,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_facts_json");
  });

  it("null narrative_json is UNREADABLE, not safe", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: null,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("null/null is unsafe on BOTH counts", () => {
    const v = assessPackageCandidateSafety({ factsJson: null, narrativeJson: null });
    expect(v.safe).toBe(false);
    expect(v.reasons).toEqual(
      expect.arrayContaining(["unreadable_facts_json", "unreadable_narrative_json"]),
    );
  });

  it("every malformed or unknown shape fails closed, and none throws", () => {
    const badFacts = [
      undefined, 42, "nope", true, {},
      { approved: RETIRED_FACTS }, // wrapper shapes do NOT exist in prod
      { facts: RETIRED_FACTS },
      { approvedFacts: RETIRED_FACTS },
      [1, 2, 3], // array of non-objects
      [null], // array with a null member
      [["nested"]], // array of arrays
    ];
    for (const factsJson of badFacts) {
      let v!: ReturnType<typeof assessPackageCandidateSafety>;
      expect(() => {
        v = assessPackageCandidateSafety({ factsJson, narrativeJson: CLEAN_NARRATIVE });
      }).not.toThrow();
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }

    const badNarratives = [
      undefined, 7, "nope", true, {},
      [], // array is not a section object
      [{ text: "x" }],
      { omittedSections: [], warnings: [] }, // present but carries no prose
      { fulfillmentArgument: 5 },
      { fulfillmentArgument: { notText: "x" } },
    ];
    for (const narrativeJson of badNarratives) {
      let v!: ReturnType<typeof assessPackageCandidateSafety>;
      expect(() => {
        v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson });
      }).not.toThrow();
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
  });

  it("an unreadable candidate gets merchant-safe copy with no JSON detail", () => {
    const msg = packageBlockSummary(
      assessPackageCandidateSafety({ factsJson: null, narrativeJson: null }),
    );
    expect(msg).toContain("Regenerate");
    expect(msg).not.toMatch(/json|facts_json|narrative|null|parse/i);
  });

  it("reads the ONE bare-array shape production actually holds", () => {
    // Measured 2026-08-07T13:14:52.052Z: 241 × array[object], 39 × null.
    expect(
      assessPackageCandidateSafety({ factsJson: RETIRED_FACTS, narrativeJson: CLEAN_NARRATIVE }).safe,
    ).toBe(false);
    expect(
      assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: CLEAN_NARRATIVE }).safe,
    ).toBe(true);
    // An empty fact list is a legitimate readable shape (a package with no
    // approved facts), not an unreadable one.
    expect(
      assessPackageCandidateSafety({ factsJson: [], narrativeJson: CLEAN_NARRATIVE }).reasons,
    ).not.toContain("unreadable_facts_json");
  });
});

describe("candidate-based blocking", () => {
  it("a regenerated safe version is usable even though an older unsafe version exists", () => {
    // Selectors read the LATEST version only; each candidate is judged alone.
    const older = assessPackageCandidateSafety({
      factsJson: RETIRED_FACTS,
      narrativeJson: UNSAFE_NARRATIVE,
    });
    const newer = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(older.safe).toBe(false);
    expect(newer.safe).toBe(true);
  });

  it("the verdict depends on nothing but the candidate's own persisted content", () => {
    const a = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: CLEAN_NARRATIVE });
    const b = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: CLEAN_NARRATIVE });
    expect(a).toEqual(b);
  });
});

describe("narrativeTexts — recursive, so nothing hides", () => {
  it("reads every section's text", () => {
    const texts = narrativeTexts({
      executiveSummary: { text: "one", usedFactIds: [] },
      conclusion: { text: "two", usedFactIds: [] },
    });
    expect(texts).toContain("one");
    expect(texts).toContain("two");
  });

  it("returns nothing for an unreadable shape — callers must use the verdict", () => {
    expect(narrativeTexts({ unknownSection: { nested: { text: "hidden" } } })).toEqual([]);
    expect(narrativeTexts(null)).toEqual([]);
  });
});

describe("schema-aware structural validation", () => {
  it("rejects an INCOMPLETE fact object rather than reading it as empty evidence", () => {
    // The two shapes called out in review. Both used to pass as "readable,
    // no retired keys found, therefore safe".
    for (const factsJson of [[{}], [{ value: "unexpected" }], [{ ...CLEAN_FACTS[0], value: "s" }]]) {
      const v = assessPackageCandidateSafety({ factsJson, narrativeJson: CLEAN_NARRATIVE });
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });

  it("rejects a fact object missing any required discriminating field", () => {
    for (const drop of ["id", "category", "label", "source", "strength", "bankEligible", "submissionRisk"]) {
      const partial = { ...CLEAN_FACTS[0] } as Record<string, unknown>;
      delete partial[drop];
      const v = assessPackageCandidateSafety({ factsJson: [partial], narrativeJson: CLEAN_NARRATIVE });
      expect(v.safe, `missing ${drop} must fail closed`).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });

  it("rejects a mistyped required field", () => {
    const v = assessPackageCandidateSafety({
      factsJson: [{ ...CLEAN_FACTS[0], bankEligible: "yes" }],
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_facts_json");
  });

  it("tolerates an EXTRA key on a well-formed fact — forward compatibility", () => {
    // An added field creates no blind spot: the retired-key scan reads
    // `value`'s own keys. Rejecting it would turn a future schema addition
    // into a fleet-wide block.
    const v = assessPackageCandidateSafety({
      factsJson: [{ ...CLEAN_FACTS[0], someFutureField: 1 }],
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(true);
  });

  it("rejects an UNKNOWN narrative key instead of ignoring its nested prose", () => {
    // The partial-valid / partial-unknown case: one good section plus an
    // unknown branch that used to go uninspected.
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: {
        executiveSummary: { text: "clean text", usedFactIds: [] },
        unknownSection: { nested: { text: "The parcel was delivered to the billing address." } },
      },
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("rejects a KNOWN section with an unexpected value shape", () => {
    for (const bad of [
      { executiveSummary: { usedFactIds: [] } },
      { executiveSummary: "just a string" },
      { executiveSummary: [{ text: "x" }] },
      { executiveSummary: { text: "ok", usedFactIds: [] }, warnings: "not-an-array" },
    ]) {
      const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
  });

  it("accepts the real 11-key narrative shape", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: {
        executiveSummary: { text: "The carrier confirmed delivery on 12 May.", usedFactIds: ["f1"] },
        transactionOverviewArgument: { text: "", usedFactIds: [] },
        chronologyArgument: { text: "", usedFactIds: [] },
        paymentAuthenticationArgument: { text: "", usedFactIds: [] },
        fulfillmentArgument: { text: "", usedFactIds: [] },
        communicationArgument: { text: "", usedFactIds: [] },
        policyArgument: { text: "", usedFactIds: [] },
        manualEvidenceArgument: { text: "", usedFactIds: [] },
        conclusion: { text: "", usedFactIds: [] },
        omittedSections: [{ sectionKey: "policyArgument", reason: "n/a" }],
        warnings: [],
      },
    });
    expect(v.safe).toBe(true);
  });
});

describe("packageBlockSummary", () => {
  it("is merchant-safe: no gateway codes, no addresses, no bank framing", () => {
    const msg = packageBlockSummary(
      assessPackageCandidateSafety({ factsJson: RETIRED_FACTS, narrativeJson: UNSAFE_NARRATIVE }),
    );
    expect(msg).toContain("Regenerate");
    expect(msg).not.toMatch(/AVS|CVV|\bY\b|\bN\b/);
  });
});
