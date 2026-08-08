/**
 * PR-C1 — the central package-candidate safety predicate.
 *
 * Every save / forward / deadline path consults this. The properties that
 * matter operationally are the candidate-based ones: a historical unsafe
 * version stays blocked, a regenerated safe version is usable, and the
 * presence of an old unsafe version never permanently blocks a dispute.
 *
 * The fixtures come from `tests/fixtures/defencePackageShapes` — the exact
 * shapes measured in production, not hand-written approximations. An earlier
 * revision of this file used narratives with one section and no `usedFactIds`,
 * which meant it certified a parser against a shape the database has never
 * held: the test was the reason the loose parser looked correct.
 */

import { describe, expect, it } from "vitest";
import {
  assessPackageCandidateSafety,
  narrativeTexts,
  packageBlockSummary,
} from "../packageSafety";
import {
  AMBIGUOUS_NARRATIVE,
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  RETIRED_FACTS,
  UNSAFE_NARRATIVE,
  factJson,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";

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
      factsJson: [factJson({ category: "shipping_tracking", value: { collectedByCustomer: true } })],
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
      narrativeJson: narrativeJson({
        fulfillmentArgument:
          "We do not claim the parcel was delivered to the cardholder's address.",
      }),
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
      { omittedSections: [], warnings: [] }, // metadata only, no sections
      { fulfillmentArgument: 5 },
      { fulfillmentArgument: { notText: "x" } },
    ];
    for (const narrativeJsonValue of badNarratives) {
      let v!: ReturnType<typeof assessPackageCandidateSafety>;
      expect(() => {
        v = assessPackageCandidateSafety({
          factsJson: CLEAN_FACTS,
          narrativeJson: narrativeJsonValue,
        });
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
    const texts = narrativeTexts(
      narrativeJson({ executiveSummary: "one", conclusion: "two" }),
    );
    expect(texts).toContain("one");
    expect(texts).toContain("two");
  });

  it("reads metadata prose too — a warning is prose the model wrote", () => {
    const texts = narrativeTexts(
      narrativeJson({}, { warnings: ["delivered to the billing address"] }),
    );
    expect(texts).toContain("delivered to the billing address");
  });

  it("returns nothing for an unreadable shape — callers must use the verdict", () => {
    expect(narrativeTexts({ unknownSection: { nested: { text: "hidden" } } })).toEqual([]);
    expect(narrativeTexts(null)).toEqual([]);
  });
});

/* ── SCHEMA v1, enforced exactly ─────────────────────────────────────────
 *
 * The measured contract is 13 fact keys and 11 narrative keys, both 100 %
 * uniform in production. Anything else is a shape this parser has never
 * inspected, and an uninspected shape may not be filed.
 * ------------------------------------------------------------------- */

describe("facts schema — all 13 fields, no unknown keys", () => {
  it("rejects an INCOMPLETE fact object rather than reading it as empty evidence", () => {
    for (const factsJson of [[{}], [{ value: "unexpected" }], [factJson({ value: "s" })]]) {
      const v = assessPackageCandidateSafety({ factsJson, narrativeJson: CLEAN_NARRATIVE });
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });

  it("rejects a fact object missing ANY of the thirteen fields", () => {
    const all = Object.keys(factJson());
    expect(all).toHaveLength(13);
    for (const drop of all) {
      const partial = factJson() as Record<string, unknown>;
      delete partial[drop];
      const v = assessPackageCandidateSafety({ factsJson: [partial], narrativeJson: CLEAN_NARRATIVE });
      expect(v.safe, `missing ${drop} must fail closed`).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });

  it("rejects a mistyped field, including the two the previous parser never checked", () => {
    const mistyped: Array<Record<string, unknown>> = [
      { bankEligible: "yes" },
      { strength: 3 },
      // `sourceRef` and `confidence` went unvalidated in the previous revision.
      { sourceRef: 42 },
      { sourceRef: { id: "x" } },
      { confidence: "high" },
      { confidence: Number.NaN },
      { confidence: {} },
    ];
    for (const over of mistyped) {
      const v = assessPackageCandidateSafety({
        factsJson: [factJson(over)],
        narrativeJson: CLEAN_NARRATIVE,
      });
      expect(v.safe, JSON.stringify(over)).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });

  it("accepts the two nullable fields at BOTH of their measured values", () => {
    for (const over of [{ sourceRef: "evidence_items:1" }, { sourceRef: null }, { confidence: 0.5 }]) {
      const v = assessPackageCandidateSafety({
        factsJson: [factJson(over)],
        narrativeJson: CLEAN_NARRATIVE,
      });
      expect(v.safe, JSON.stringify(over)).toBe(true);
    }
  });

  it("REJECTS an unknown extra key — a future field needs a parser update, not silence", () => {
    // Reversed in review. The previous revision tolerated extra keys and
    // claimed they were "no blind spot"; that only holds if every extra branch
    // is structurally inspected, and none was.
    const v = assessPackageCandidateSafety({
      factsJson: [factJson({ someFutureField: 1 })],
      narrativeJson: CLEAN_NARRATIVE,
    });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_facts_json");
  });

  it("rejects an extra key even when it hides a retired flag or fresh prose", () => {
    for (const over of [
      { legacy: { deliveredToVerifiedAddress: true } },
      { notes: "The parcel was delivered to the billing address." },
    ]) {
      const v = assessPackageCandidateSafety({
        factsJson: [factJson(over)],
        narrativeJson: CLEAN_NARRATIVE,
      });
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_facts_json");
    }
  });
});

describe("narrative schema — all eleven keys, every section exact", () => {
  it("accepts the real 11-key narrative shape", () => {
    const v = assessPackageCandidateSafety({
      factsJson: CLEAN_FACTS,
      narrativeJson: narrativeJson(
        { executiveSummary: "The carrier confirmed delivery on 12 May." },
        { omittedSections: [{ sectionKey: "policyArgument", reason: "n/a" }], warnings: ["w"] },
      ),
    });
    expect(v.safe).toBe(true);
  });

  it("rejects an UNKNOWN narrative key instead of ignoring its nested prose", () => {
    const bad = {
      ...narrativeJson({ executiveSummary: "clean text" }),
      unknownSection: { nested: { text: "The parcel was delivered to the billing address." } },
    };
    const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("rejects a narrative MISSING any required section", () => {
    for (const drop of Object.keys(narrativeJson())) {
      const partial = narrativeJson() as Record<string, unknown>;
      delete partial[drop];
      const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: partial });
      expect(v.safe, `missing ${drop} must fail closed`).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
  });

  it("rejects a section MISSING usedFactIds — the shape the old tests blessed", () => {
    const bad = narrativeJson() as Record<string, unknown>;
    bad.executiveSummary = { text: "The carrier confirmed delivery." };
    const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("rejects mistyped usedFactIds and mistyped identifiers inside it", () => {
    for (const usedFactIds of ["f1", 7, {}, [1], [null], [{ id: "f1" }]]) {
      const bad = narrativeJson() as Record<string, unknown>;
      bad.conclusion = { text: "ok", usedFactIds };
      const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
      expect(v.safe, JSON.stringify(usedFactIds)).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
  });

  it("rejects an EXTRA nested key inside a known section", () => {
    const bad = narrativeJson() as Record<string, unknown>;
    bad.fulfillmentArgument = {
      text: "ok",
      usedFactIds: [],
      draft: { text: "The parcel was delivered to the billing address." },
    };
    const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
    expect(v.safe).toBe(false);
    expect(v.reasons).toContain("unreadable_narrative_json");
  });

  it("rejects a KNOWN section with an unexpected value shape", () => {
    for (const bad of [
      { ...narrativeJson(), executiveSummary: { usedFactIds: [] } },
      { ...narrativeJson(), executiveSummary: "just a string" },
      { ...narrativeJson(), executiveSummary: [{ text: "x" }] },
      { ...narrativeJson(), executiveSummary: null },
      { ...narrativeJson(), warnings: "not-an-array" },
    ]) {
      const v = assessPackageCandidateSafety({ factsJson: CLEAN_FACTS, narrativeJson: bad });
      expect(v.safe).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
  });

  it("rejects malformed metadata ELEMENTS, not just a malformed container", () => {
    const badMetadata: Array<Record<string, unknown>> = [
      { omittedSections: ["policyArgument"] },
      { omittedSections: [{ sectionKey: "policyArgument" }] },
      { omittedSections: [{ sectionKey: "policyArgument", reason: 7 }] },
      { omittedSections: [{ sectionKey: "notASection", reason: "n/a" }] },
      { omittedSections: [{ sectionKey: "policyArgument", reason: "n/a", extra: 1 }] },
      { omittedSections: [null] },
      { warnings: [7] },
      { warnings: [{ message: "x" }] },
      { warnings: [null] },
    ];
    for (const over of badMetadata) {
      const v = assessPackageCandidateSafety({
        factsJson: CLEAN_FACTS,
        narrativeJson: { ...narrativeJson(), ...over },
      });
      expect(v.safe, JSON.stringify(over)).toBe(false);
      expect(v.reasons).toContain("unreadable_narrative_json");
    }
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
