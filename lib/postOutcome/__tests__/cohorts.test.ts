/**
 * Cohort gate tests (plan §15.6, §18, §19 admin block).
 *
 * The most important case is the last one: on the real production shape every
 * benchmark must refuse. A gate that only works on synthetic data is not a gate.
 */

import { describe, expect, it } from "vitest";
import {
  COHORT_THRESHOLDS,
  cohortKey,
  describeBlockers,
  evaluateCohort,
  matchesCohort,
  type CohortCase,
  type CohortDefinition,
} from "../cohorts";

function definition(overrides: Partial<CohortDefinition> = {}): CohortDefinition {
  return {
    paymentProvider: "SHOPIFY_PAYMENTS",
    providerAccessLevel: "PARTIAL_CASE_FILE",
    merchantNiche: "HOME_AND_GARDEN",
    phase: "chargeback",
    reasonFamily: "FRAUDULENT",
    networkReasonCode: null,
    cardNetwork: "UNKNOWN",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-09-01T00:00:00.000Z",
    analyzerVersions: null,
    excludeShopId: null,
    ...overrides,
  };
}

function decidedCase(overrides: Partial<CohortCase> = {}): CohortCase {
  return {
    disputeId: "d-1",
    shopId: "peer-1",
    outcome: "lost",
    finalizedAt: "2026-07-15T00:00:00.000Z",
    paymentProvider: "SHOPIFY_PAYMENTS",
    providerAccessLevel: "PARTIAL_CASE_FILE",
    merchantNiche: "HOME_AND_GARDEN",
    phase: "chargeback",
    reasonFamily: "FRAUDULENT",
    networkReasonCode: "10.4",
    cardNetwork: "UNKNOWN",
    analyzerVersion: 1,
    ...overrides,
  };
}

/** A cohort that clears every floor, for testing the positive path. */
function sufficientPopulation(): CohortCase[] {
  const peers: CohortCase[] = [];
  for (let shop = 1; shop <= 4; shop++) {
    for (let i = 0; i < 10; i++) {
      peers.push(
        decidedCase({
          disputeId: `peer-${shop}-${i}`,
          shopId: `peer-${shop}`,
          outcome: i < 3 ? "won" : "lost",
        }),
      );
    }
  }
  for (let i = 0; i < 12; i++) {
    peers.push(
      decidedCase({
        disputeId: `subject-${i}`,
        shopId: "subject",
        outcome: i < 6 ? "won" : "lost",
      }),
    );
  }
  return peers;
}

describe("dimension matching", () => {
  it("never merges an unknown network with a known one", () => {
    // 49 of 50 prod cases carry an unknown network; a merge would pool almost
    // everything into one misleading cohort.
    const known = decidedCase({ cardNetwork: "VISA" });
    expect(matchesCohort(known, definition({ cardNetwork: "UNKNOWN" }))).toBe(false);
    expect(matchesCohort(decidedCase(), definition({ cardNetwork: "VISA" }))).toBe(false);
  });

  it("refuses a cross-provider or cross-access comparison", () => {
    expect(
      matchesCohort(decidedCase({ paymentProvider: "KLARNA" }), definition()),
    ).toBe(false);
    expect(
      matchesCohort(decidedCase({ providerAccessLevel: "OUTCOME_ONLY" }), definition()),
    ).toBe(false);
  });

  it("keeps an unclassified niche out of a niche cohort", () => {
    expect(matchesCohort(decidedCase({ merchantNiche: null }), definition())).toBe(false);
    // …and a classified merchant out of the unclassified bucket.
    expect(
      matchesCohort(decidedCase(), definition({ merchantNiche: null })),
    ).toBe(false);
  });

  it("honours the decision window", () => {
    expect(
      matchesCohort(decidedCase({ finalizedAt: "2026-01-01T00:00:00.000Z" }), definition()),
    ).toBe(false);
  });

  it("gives the same key for the same question", () => {
    expect(cohortKey(definition())).toBe(cohortKey(definition()));
    expect(cohortKey(definition())).not.toBe(
      cohortKey(definition({ cardNetwork: "VISA" })),
    );
  });
});

describe("the subject is excluded from its own benchmark", () => {
  it("does not count the selected merchant among its peers", () => {
    const result = evaluateCohort(definition(), sufficientPopulation(), "subject");
    expect(result.counts.peerMerchants).toBe(4);
    expect(result.counts.peerCases).toBe(40);
    expect(result.counts.subjectCases).toBe(12);
  });
});

describe("rates exist only when the floors are cleared", () => {
  it("returns rates on a sufficient cohort", () => {
    const result = evaluateCohort(definition(), sufficientPopulation(), "subject");
    expect(result.status).toBe("SUFFICIENT");
    if (result.status !== "SUFFICIENT") throw new Error("unreachable");
    expect(result.peerWinRate).toBeCloseTo(12 / 40);
    expect(result.subjectWinRate).toBeCloseTo(6 / 12);
    expect(result.absoluteDifference).toBeCloseTo(0.5 - 0.3);
  });

  it("carries no rate at all when a floor fails", () => {
    // The type is the gate: an insufficient result has no rate property to read,
    // so a caller cannot render a percentage from four cases by forgetting a flag.
    const thin = sufficientPopulation().filter(
      (c) => c.shopId !== "peer-3" && c.shopId !== "peer-4",
    );
    const result = evaluateCohort(definition(), thin, "subject");
    expect(result.status).toBe("INSUFFICIENT_SAMPLE");
    expect(result).not.toHaveProperty("peerWinRate");
    expect(result).not.toHaveProperty("absoluteDifference");
  });

  it("names every failing gate, not just the first", () => {
    const result = evaluateCohort(definition(), [decidedCase()], "subject");
    if (result.status === "SUFFICIENT") throw new Error("unreachable");
    expect(result.blockers).toContain("TOO_FEW_PEER_MERCHANTS");
    expect(result.blockers).toContain("TOO_FEW_PEER_CASES");
    expect(result.blockers).toContain("TOO_FEW_SUBJECT_CASES");
    expect(describeBlockers(result).join(" ")).toMatch(/3 required/);
  });

  it("reports NO_COMPARABLE_COHORT when nothing matches at all", () => {
    const result = evaluateCohort(
      definition({ cardNetwork: "AMEX" }),
      sufficientPopulation(),
      "subject",
    );
    expect(result.status).toBe("NO_COMPARABLE_COHORT");
  });

  it("blocks a niche benchmark for an unclassified merchant", () => {
    const result = evaluateCohort(
      definition({ merchantNiche: null }),
      sufficientPopulation(),
      "subject",
    );
    if (result.status === "SUFFICIENT") throw new Error("unreachable");
    expect(result.blockers).toContain("NICHE_UNKNOWN");
  });
});

describe("the real production shape", () => {
  it("refuses every benchmark, because it should", () => {
    // Prod: 3 shops with analyzable decided cases — 47 blume-box, 2 others.
    // No niche is classified. Every benchmark must refuse and say why.
    const prodShaped: CohortCase[] = [
      ...Array.from({ length: 47 }, (_, i) =>
        decidedCase({ disputeId: `b-${i}`, shopId: "blume-box", merchantNiche: null }),
      ),
      decidedCase({ disputeId: "c-1", shopId: "cay-collective", outcome: "won", merchantNiche: null }),
      decidedCase({ disputeId: "s-1", shopId: "surasvenne", merchantNiche: null }),
    ];

    for (const subject of ["blume-box", "cay-collective", "surasvenne"]) {
      const result = evaluateCohort(
        definition({ merchantNiche: null }),
        prodShaped,
        subject,
      );
      expect(result.status).not.toBe("SUFFICIENT");
      expect(result).not.toHaveProperty("peerWinRate");
      expect(result.counts.peerMerchants).toBeLessThan(
        COHORT_THRESHOLDS.minPeerMerchants,
      );
    }
  });
});

describe("exactly at the floor is sufficient", () => {
  it("accepts 3 peer merchants, 30 peer cases, 10 subject cases", () => {
    // Pinned deliberately: the thresholds are >=, and a later "tighten by one"
    // would change what the product promises without anyone noticing.
    const atFloor: CohortCase[] = [];
    for (let shop = 1; shop <= COHORT_THRESHOLDS.minPeerMerchants; shop++) {
      for (let i = 0; i < 10; i++) {
        atFloor.push(
          decidedCase({ disputeId: `p${shop}-${i}`, shopId: `peer-${shop}` }),
        );
      }
    }
    for (let i = 0; i < COHORT_THRESHOLDS.minSubjectCases; i++) {
      atFloor.push(decidedCase({ disputeId: `s-${i}`, shopId: "subject" }));
    }
    const result = evaluateCohort(definition(), atFloor, "subject");
    expect(result.counts.peerMerchants).toBe(3);
    expect(result.counts.peerCases).toBe(30);
    expect(result.counts.subjectCases).toBe(10);
    expect(result.status).toBe("SUFFICIENT");
  });
});
