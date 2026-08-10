/**
 * `selectFileablePackage` — CP-B §4.
 *
 * Three groups of assertions:
 *
 *   1. THE NINE SHARED FIXTURES. Each carries the selection every trigger must
 *      produce; that expectation IS the acceptance contract, so the selector is
 *      driven straight off it rather than off restated expectations.
 *   2. C-11 SUBSUMPTION. The same persisted shapes `packageSafety.test.ts`
 *      blocks must be blocked here, and the same shapes it passes must pass.
 *      That is what makes "212 of 280 blocked on the same population" still
 *      true after the selector replaces the four call sites.
 *   3. THE STRUCTURAL PROPERTIES: never an arbitrary pick, never a fallback to
 *      an older version, and a deadline that relaxes nothing.
 */

import { describe, expect, it } from "vitest";
import {
  CONTRACT_FIXTURES,
  type ContractFixture,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import { mayExecuteAtDeadline, type SelectionTrigger } from "@/lib/pipeline/contracts";
import {
  AMBIGUOUS_NARRATIVE,
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  RETIRED_FACTS,
  UNSAFE_NARRATIVE,
  factJson,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";
import {
  deadlineExecutionConditions,
  selectFileablePackage,
  type SelectableCandidate,
  type SelectFileablePackageInput,
} from "..";

/**
 * A candidate that is healthy in every respect the selector inspects, so any
 * refusal in the fixture sweep is attributable to the fixture's own snapshots
 * and not to the package row.
 */
function healthyCandidate(over: Partial<SelectableCandidate> = {}): SelectableCandidate {
  return {
    packageId: "pkg-1",
    packageVersion: 3,
    artifactId: "defence/pkg-1.pdf",
    status: "final",
    // Contract revision 1 fields. `planInputHash` / `policyVersion` are the
    // candidate's own record of what it was built against; the selector's
    // staleness verdict still comes from the three SNAPSHOTS, so these are
    // carried, not yet compared.
    planInputHash: "strong-plan",
    policyVersion: 1,
    validationPassed: true,
    validationStatus: "ok",
    supersededById: null,
    factsJson: CLEAN_FACTS,
    narrativeJson: CLEAN_NARRATIVE,
    documentFailureCodes: [],
    ...over,
  };
}

/** Current hashes matched to the fixture's own, so only the STALE fixture is stale. */
function inputFor(fixture: ContractFixture, trigger: SelectionTrigger): SelectFileablePackageInput {
  const caseId = fixture.plan.caseId;
  return {
    caseId,
    trigger,
    candidates: [healthyCandidate()],
    assessment: fixture.assessment,
    plan: fixture.plan,
    decision: fixture.decision,
    current: {
      policyVersion: 1,
      assessmentInputHash: `${fixture.assessment.caseId}-assessment`,
      planInputHash: `${caseId}-plan`,
      decisionInputHash: `${fixture.decision.caseId}-decision`,
    },
  };
}

describe("the nine shared fixtures — the acceptance contract", () => {
  for (const fixture of CONTRACT_FIXTURES) {
    it(`${fixture.name}: normal → ${fixture.expected.normal}${
      fixture.expected.normalReason ? ` (${fixture.expected.normalReason})` : ""
    }`, () => {
      const selection = selectFileablePackage(inputFor(fixture, "normal"));
      expect(selection.outcome, fixture.intent).toBe(fixture.expected.normal);
      if (fixture.expected.normalReason && selection.outcome === "none") {
        expect(selection.reason).toBe(fixture.expected.normalReason);
      }
    });

    it(`${fixture.name}: deadline → ${fixture.expected.deadline}${
      fixture.expected.deadlineReason ? ` (${fixture.expected.deadlineReason})` : ""
    }`, () => {
      const selection = selectFileablePackage(inputFor(fixture, "deadline"));
      expect(selection.outcome, fixture.intent).toBe(fixture.expected.deadline);
      if (fixture.expected.deadlineReason && selection.outcome === "none") {
        expect(selection.reason).toBe(fixture.expected.deadlineReason);
      }
    });
  }

  it("a deadline changes the answer ONLY on deadline_only_not_yet_due", () => {
    for (const fixture of CONTRACT_FIXTURES) {
      const normal = selectFileablePackage(inputFor(fixture, "normal"));
      const deadline = selectFileablePackage(inputFor(fixture, "deadline"));
      if (normal.outcome === deadline.outcome) continue;
      expect(normal.outcome, fixture.name).toBe("none");
      if (normal.outcome !== "none") throw new Error("unreachable");
      expect(normal.reason, fixture.name).toBe("deadline_only_not_yet_due");
      expect(deadline.outcome).toBe("selected");
    }
  });

  it("the stale fixture names WHICH freshness rule failed", () => {
    const selection = selectFileablePackage(
      inputFor(CONTRACT_FIXTURES.find((f) => f.name === "stale")!, "deadline"),
    );
    if (selection.outcome !== "none") throw new Error("unreachable");
    expect(selection.staleness).toBe("input_hash_mismatch");
  });

  it("an absent snapshot stales too — the post-R4 legacy shape is not grandfathered", () => {
    const strong = CONTRACT_FIXTURES[0];
    const selection = selectFileablePackage({ ...inputFor(strong, "deadline"), plan: null });
    if (selection.outcome !== "none") throw new Error("unreachable");
    // No plan at all: the freshness check reports it before the argument does.
    expect(selection.reason).toBe("stale");
    expect(selection.staleness).toBe("snapshot_absent");
  });
});

/* ── C-11 subsumption ─────────────────────────────────────────────────── */

describe("C-11 subsumption — the same inputs still block", () => {
  const strong = CONTRACT_FIXTURES[0];
  const base = () => inputFor(strong, "deadline");

  const blocking: Array<[string, Partial<SelectableCandidate>]> = [
    ["a retired delivery fact", { factsJson: RETIRED_FACTS }],
    ["collectedByCustomer", {
      factsJson: [factJson({ category: "shipping_tracking", value: { collectedByCustomer: true } })],
    }],
    ["an affirmative address assertion", { narrativeJson: UNSAFE_NARRATIVE }],
    ["ambiguous address language", { narrativeJson: AMBIGUOUS_NARRATIVE }],
    ["null facts_json", { factsJson: null }],
    ["null narrative_json", { narrativeJson: null }],
    ["null/null", { factsJson: null, narrativeJson: null }],
    ["an incomplete fact object", { factsJson: [{}] }],
    ["an unknown extra fact key", { factsJson: [factJson({ someFutureField: 1 })] }],
    ["an unknown narrative key hiding prose", {
      narrativeJson: {
        ...narrativeJson({ executiveSummary: "clean" }),
        unknownSection: { nested: { text: "The parcel was delivered to the billing address." } },
      },
    }],
    ["a wrapper shape production never held", { factsJson: { approved: CLEAN_FACTS } }],
  ];

  for (const [label, over] of blocking) {
    it(`blocks ${label}`, () => {
      const selection = selectFileablePackage({
        ...base(),
        candidates: [healthyCandidate(over)],
      });
      expect(selection.outcome).toBe("none");
      if (selection.outcome !== "none") throw new Error("unreachable");
      expect(selection.reason).toBe("validation_failed");
    });
  }

  it("does NOT block negated / prohibition language", () => {
    const selection = selectFileablePackage({
      ...base(),
      candidates: [
        healthyCandidate({
          narrativeJson: narrativeJson({
            fulfillmentArgument:
              "We do not claim the parcel was delivered to the cardholder's address.",
          }),
        }),
      ],
    });
    expect(selection.outcome).toBe("selected");
  });

  it("a regenerated safe version is usable even though an older unsafe one exists", () => {
    const selection = selectFileablePackage({
      ...base(),
      candidates: [
        healthyCandidate({
          packageId: "old",
          packageVersion: 2,
          factsJson: RETIRED_FACTS,
          narrativeJson: UNSAFE_NARRATIVE,
        }),
        healthyCandidate({ packageId: "new", packageVersion: 3 }),
      ],
    });
    expect(selection.outcome).toBe("selected");
    if (selection.outcome !== "selected") throw new Error("unreachable");
    expect(selection.package.packageId).toBe("new");
  });

  it("NEVER falls back from a newer unsafe candidate to an older safe one", () => {
    const selection = selectFileablePackage({
      ...base(),
      candidates: [
        healthyCandidate({ packageId: "old-safe", packageVersion: 2 }),
        healthyCandidate({ packageId: "new-unsafe", packageVersion: 3, factsJson: RETIRED_FACTS }),
      ],
    });
    expect(selection.outcome).toBe("none");
  });
});

/* ── Structural properties ────────────────────────────────────────────── */

describe("selection is never an arbitrary pick", () => {
  const strong = CONTRACT_FIXTURES[0];
  const base = () => inputFor(strong, "deadline");

  it("two candidates at the same version is AMBIGUOUS, not the first one", () => {
    const selection = selectFileablePackage({
      ...base(),
      candidates: [
        healthyCandidate({ packageId: "b", packageVersion: 3 }),
        healthyCandidate({ packageId: "a", packageVersion: 3 }),
      ],
    });
    expect(selection.outcome).toBe("ambiguous");
    if (selection.outcome !== "ambiguous") throw new Error("unreachable");
    expect(selection.candidateIds).toEqual(["a", "b"]);
  });

  it("refuses a superseded candidate rather than reaching past it", () => {
    for (const over of [{ supersededById: "pkg-9" }, { status: "superseded" }]) {
      const selection = selectFileablePackage({ ...base(), candidates: [healthyCandidate(over)] });
      if (selection.outcome !== "none") throw new Error("unreachable");
      expect(selection.reason).toBe("superseded");
    }
  });

  it("refuses a candidate with no generated artifact", () => {
    for (const artifactId of [null, "", "   "]) {
      const selection = selectFileablePackage({
        ...base(),
        candidates: [healthyCandidate({ artifactId })],
      });
      if (selection.outcome !== "none") throw new Error("unreachable");
      expect(selection.reason).toBe("artifact_missing");
    }
  });

  it("refuses a candidate whose deterministic validation never ran", () => {
    // `validationPassed: null` is "never run", and never run is not evidence of
    // passing. Contract revision 1 replaced CP-B's `documentValidation: null`
    // with this field; the disposition is unchanged.
    const selection = selectFileablePackage({
      ...base(),
      candidates: [healthyCandidate({ validationPassed: null })],
    });
    if (selection.outcome !== "none") throw new Error("unreachable");
    expect(selection.reason).toBe("validation_failed");
  });

  it("refuses a candidate whose deterministic validation failed", () => {
    const selection = selectFileablePackage({
      ...base(),
      candidates: [
        healthyCandidate({
          validationPassed: false,
          documentFailureCodes: ["orphaned_claim"],
        }),
      ],
    });
    if (selection.outcome !== "none") throw new Error("unreachable");
    expect(selection.reason).toBe("validation_failed");
  });

  it("refuses when there is no candidate at all", () => {
    const selection = selectFileablePackage({ ...base(), candidates: [] });
    if (selection.outcome !== "none") throw new Error("unreachable");
    expect(selection.reason).toBe("no_package");
  });

  it("a candidate that exists but is not final is `not_final`, not `no_package`", () => {
    // Contract revision 1. CP-B mapped this onto `no_package`, which lost the
    // live HTTP split — 409 PACKAGE_NOT_FILEABLE for a draft that exists versus
    // 422 PACKAGE_REVIEW_REQUIRED for one that is missing or blocked — and with
    // it the merchant's next action: approve it, versus regenerate it.
    for (const status of ["draft", "generating", "review"]) {
      const selection = selectFileablePackage({
        ...base(),
        candidates: [healthyCandidate({ status })],
      });
      if (selection.outcome !== "none") throw new Error("unreachable");
      expect(selection.reason, status).toBe("not_final");
    }
  });

  it("carries the artifact identity the selection stands behind", () => {
    const selection = selectFileablePackage(base());
    if (selection.outcome !== "selected") throw new Error("unreachable");
    expect(selection.package).toEqual({
      packageId: "pkg-1",
      packageVersion: 3,
      artifactId: "defence/pkg-1.pdf",
    });
  });

  it("is deterministic — the same inputs select identically", () => {
    expect(selectFileablePackage(base())).toEqual(selectFileablePackage(base()));
  });
});

describe("deadlineExecutionConditions — P-6, six conjunctive conditions", () => {
  const byName = (name: string) => CONTRACT_FIXTURES.find((f) => f.name === name)!;

  it("permits the strong case and names every condition satisfied", () => {
    const conditions = deadlineExecutionConditions(inputFor(byName("strong"), "deadline"));
    // Contract revision 1 made it SIX fields: `noUnsupportedArgument` used to be
    // folded into `hasCurrentValidatedSafePackage`, so P-6's prose named six
    // conditions and this object had five. A reviewer must be able to count
    // them 1:1.
    expect(conditions).toEqual({
      hasCurrentCanonicalDecision: true,
      hasCurrentValidatedSafePackage: true,
      noHardBlock: true,
      notStale: true,
      noAmbiguity: true,
      noUnsupportedArgument: true,
    });
    expect(mayExecuteAtDeadline(conditions)).toBe(true);
  });

  it("names the hard block rather than only saying no", () => {
    const conditions = deadlineExecutionConditions(inputFor(byName("hard_blocked"), "deadline"));
    expect(conditions.noHardBlock).toBe(false);
    expect(mayExecuteAtDeadline(conditions)).toBe(false);
  });

  it("names staleness rather than only saying no", () => {
    const conditions = deadlineExecutionConditions(inputFor(byName("stale"), "deadline"));
    expect(conditions.notStale).toBe(false);
    expect(conditions.hasCurrentCanonicalDecision).toBe(false);
    expect(mayExecuteAtDeadline(conditions)).toBe(false);
  });

  it("names ambiguity rather than only saying no", () => {
    const conditions = deadlineExecutionConditions({
      ...inputFor(byName("strong"), "deadline"),
      candidates: [
        healthyCandidate({ packageId: "a", packageVersion: 3 }),
        healthyCandidate({ packageId: "b", packageVersion: 3 }),
      ],
    });
    expect(conditions.noAmbiguity).toBe(false);
    expect(mayExecuteAtDeadline(conditions)).toBe(false);
  });

  it("a case with no safe argument holds no validated safe package", () => {
    const conditions = deadlineExecutionConditions(
      inputFor(byName("review_required_no_safe_argument"), "deadline"),
    );
    expect(conditions.hasCurrentValidatedSafePackage).toBe(false);
    // …and it is separately an unsupported argument: the plan authorises no
    // fact, so no sentence in the document could have anything behind it.
    expect(conditions.noUnsupportedArgument).toBe(false);
    expect(mayExecuteAtDeadline(conditions)).toBe(false);
  });

  it("names an unsupported argument rather than only saying no", () => {
    // The condition revision 1 un-folded. The package is current, safe by C-11,
    // final, non-ambiguous and NOT stale — every other condition holds — and it
    // still may not be filed, because a section cites a record the plan removed.
    const conditions = deadlineExecutionConditions({
      ...inputFor(byName("strong"), "deadline"),
      candidates: [
        healthyCandidate({
          validationPassed: false,
          documentFailureCodes: ["orphaned_claim"],
        }),
      ],
    });
    expect(conditions.noUnsupportedArgument).toBe(false);
    expect(conditions.notStale).toBe(true);
    expect(conditions.noAmbiguity).toBe(true);
    expect(mayExecuteAtDeadline(conditions)).toBe(false);
  });

  it("a WEAK case satisfies every P-6 condition — odds are not an honesty bar", () => {
    // Contract revision 2. `strength_insufficient` is not a hard block, so the
    // deadline path files a thin but honest letter. Filing nothing would not
    // produce silence; it would produce Shopify's own scrape instead.
    const conditions = deadlineExecutionConditions(inputFor(byName("weak"), "deadline"));
    expect(conditions.noHardBlock).toBe(true);
    expect(mayExecuteAtDeadline(conditions)).toBe(true);
  });
});
