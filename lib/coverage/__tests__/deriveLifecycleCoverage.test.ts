/**
 * Coverage reports the EFFECTIVE mode, and says where it came from.
 *
 * The bug this pins: after the per-family rules collapsed into one store-wide
 * switch, the only setup rows left were the fallback (`match: {}`) and the
 * safeguard (`match: { amount_range }`). Neither carries a `reason`, and a rule
 * without a `reason` cannot define a family's mode — so every one of the seven
 * families fell through to `"none"`, which the page renders as "Review". A shop
 * on Auto-pilot saw seven rows saying Review.
 *
 * Failure proofs are stated per test.
 */

import { describe, it, expect } from "vitest";
import { deriveLifecycleCoverage } from "../deriveLifecycleCoverage";

const NO_PACKS: never[] = [];
const NO_MAPPINGS: never[] = [];

/** The two rows a collapsed store actually has. Neither names a reason. */
const STORE_ROWS = [
  {
    id: "fallback",
    enabled: true,
    match: {},
    action: { mode: "auto" },
  },
  {
    id: "safeguard",
    enabled: true,
    match: { amount_range: { min: 500 } },
    action: { mode: "review" },
  },
];

function familyById(
  summary: ReturnType<typeof deriveLifecycleCoverage>,
  id: string,
) {
  const family = summary.families.find((f) => f.familyId === id);
  if (!family) throw new Error(`no family ${id}`);
  return family;
}

describe("deriveLifecycleCoverage — effective mode vs override", () => {
  it("a family with no rule of its own inherits the store switch", () => {
    // Failure proof: restore the `: "none"` fallback in derivePhaseHandling and
    // every family reads review_first here, whatever the switch says.
    const summary = deriveLifecycleCoverage(
      STORE_ROWS,
      NO_PACKS,
      NO_MAPPINGS,
      "auto",
    );
    for (const family of summary.families) {
      expect(family.chargeback.automationMode).toBe("automated");
      expect(family.chargeback.automationSource).toBe("store_default");
      expect(family.inquiry.automationMode).toBe("automated");
    }
  });

  it("a store on review reads review, from the same inherited path", () => {
    const summary = deriveLifecycleCoverage(
      STORE_ROWS,
      NO_PACKS,
      NO_MAPPINGS,
      "review",
    );
    expect(familyById(summary, "fraud").chargeback.automationMode).toBe(
      "review_first",
    );
    expect(familyById(summary, "fraud").chargeback.automationSource).toBe(
      "store_default",
    );
  });

  it("a group row overrides the switch, and says so", () => {
    // The case the merchant cannot otherwise explain: one family behaves
    // differently from the rest, and flipping the switch won't move it.
    const summary = deriveLifecycleCoverage(
      [
        ...STORE_ROWS,
        {
          id: "group-fraud",
          enabled: true,
          match: { reason: ["FRAUDULENT", "UNRECOGNIZED"] },
          action: { mode: "review" },
          },
      ],
      NO_PACKS,
      NO_MAPPINGS,
      "auto",
    );

    const fraud = familyById(summary, "fraud");
    expect(fraud.chargeback.automationMode).toBe("review_first");
    expect(fraud.chargeback.automationSource).toBe("override");

    // Unaffected families still inherit — and are labelled as inheriting.
    const pnr = familyById(summary, "pnr");
    expect(pnr.chargeback.automationMode).toBe("automated");
    expect(pnr.chargeback.automationSource).toBe("store_default");
  });

  it("defaults to review when the caller passes no store mode", () => {
    // Back-compat: an older caller must not silently start reporting Auto.
    const summary = deriveLifecycleCoverage(STORE_ROWS, NO_PACKS, NO_MAPPINGS);
    expect(familyById(summary, "fraud").chargeback.automationMode).toBe(
      "review_first",
    );
  });
});

describe("deriveLifecycleCoverage — a gap is a missing playbook", () => {
  it("no playbook is a gap even though the family has a mode", () => {
    // Failure proof: re-add `automationMode === "none" &&` to hasGap and this
    // goes false, because every family now has a mode.
    const summary = deriveLifecycleCoverage(
      STORE_ROWS,
      NO_PACKS,
      NO_MAPPINGS,
      "auto",
    );
    expect(familyById(summary, "fraud").chargeback.hasGap).toBe(true);
    expect(summary.gapsCount).toBe(summary.totalFamilies);
    expect(summary.fullyConfiguredCount).toBe(0);
  });

  it("an installed playbook closes the gap, with no rule involved", () => {
    const summary = deriveLifecycleCoverage(
      STORE_ROWS,
      [
        {
          id: "pack-1",
          name: "Fraud standard",
          dispute_type: "FRAUDULENT",
          status: "ACTIVE",
        },
      ],
      NO_MAPPINGS,
      "auto",
    );

    const fraud = familyById(summary, "fraud");
    expect(fraud.chargeback.hasGap).toBe(false);
    expect(fraud.overallCovered).toBe(true);
    expect(summary.gapsCount).toBe(summary.totalFamilies - 1);
    expect(summary.fullyConfiguredCount).toBe(1);
  });

  it("stops warning about automation, because there is always automation", () => {
    const summary = deriveLifecycleCoverage(
      STORE_ROWS,
      NO_PACKS,
      NO_MAPPINGS,
      "auto",
    );
    for (const family of summary.families) {
      expect(family.chargeback.warnings).not.toContain("coverage.noAutomation");
      expect(family.chargeback.warnings).toContain("coverage.noPlaybook");
    }
  });
});
