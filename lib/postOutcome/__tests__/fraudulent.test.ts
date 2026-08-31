/**
 * FRAUDULENT reason-module tests (plan §19, reason-module block).
 *
 * Signal polarity is the whole job. A module that only counted presence would
 * flag 27 correct suppressions as defects and miss the 14 real disclosures, so
 * the polarity cases below are the ones that matter.
 */

import { describe, expect, it } from "vitest";
import { fraudSignalPolarity, runFraudulentModule } from "../reasons/fraudulent";
import { validateFinding } from "../findings";
import {
  SNAPSHOT_CONTRACT_VERSION,
  type PostOutcomeSourceSnapshot,
  type SnapshotEvidenceItem,
} from "../snapshotContract";

function fact(
  category: string,
  value: Record<string, unknown> | null,
  shown: boolean,
  id = `fact:${category}`,
): SnapshotEvidenceItem {
  return {
    id,
    source: "shopify_order",
    category,
    availableAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    signalValue: value,
    inclusionEligible: shown,
    presentInSubmittedPackage: shown,
  };
}

function snapshot(facts: SnapshotEvidenceItem[]): PostOutcomeSourceSnapshot {
  return {
    contractVersion: SNAPSHOT_CONTRACT_VERSION,
    dispute: {
      id: "d-1",
      shopId: "s-1",
      phase: "chargeback",
      reason: "FRAUDULENT",
      networkReasonCode: "10.4",
      amount: "120",
      currencyCode: "USD",
      initiatedAt: null,
    },
    outcome: { finalOutcome: "lost", finalizedAt: null, reliable: true },
    provider: {
      paymentProvider: "SHOPIFY_PAYMENTS",
      providerAccountRef: null,
      cardNetwork: "UNKNOWN",
      capabilities: {
        claimDetailAccess: false,
        providerEvidenceReadAccess: true,
        providerEvidenceWriteAccess: true,
        platformSaveConfirmation: true,
        submissionConfirmationAccess: true,
        outcomeAccess: true,
        adjudicationReasonAccess: false,
      },
      accessLevel: "PARTIAL_CASE_FILE",
      submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
      packageEvidenceTie: "EVIDENCE_GID_MATCH",
    },
    lifecycle: {
      submissionState: "submitted_confirmed",
      submittedAt: "2026-07-10T00:00:00.000Z",
      evidenceSavedToShopifyAt: null,
      platformSaveVerified: true,
      evidenceGid: null,
      disputeEvidenceGid: null,
      evidenceDeadlineAt: null,
      events: [],
    },
    submittedPackage: {
      packageId: "p-1",
      version: 1,
      submittedToPlatformAt: "2026-07-09T00:00:00.000Z",
      contentRevision: 1,
      pdfSha256: null,
      pdfPath: "p.pdf",
      evidenceHash: "h",
      promptVersion: "9",
      validatorVersion: null,
      reasonCodeModule: "FRAUDULENT",
    },
    caseStrengthAtSubmission: "not_assessed",
    availableBeforeSubmission: facts,
    arrivedAfterSubmission: [],
    availabilityUnknown: [],
    assertions: [],
    reconstructionGaps: [],
  };
}

describe("signal polarity", () => {
  it("does not call an uncitable failed AVS a disclosure", () => {
    // Regression: reading avsResult directly produced 14 false DEFINITE
    // findings. A payment_authentication fact carries BOTH results, and the
    // renderer cites only the citable half — for AVS "N" that is nothing. The
    // matching CVV is what those packages actually told the issuer.
    const { polarity, detail } = fraudSignalPolarity(
      fact("payment_authentication", { avsResult: "N", cvvResult: "M" }, true),
    );
    expect(polarity).toBe("SUPPORTS_MERCHANT");
    expect(detail).toMatch(/security code matched/i);
  });

  it("reads a matched AVS as supporting", () => {
    expect(
      fraudSignalPolarity(fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true))
        .polarity,
    ).toBe("SUPPORTS_MERCHANT");
  });

  it("reads an empty verification as neutral, not as a defect", () => {
    // The 27 withheld Mastercard facts carry null codes. Withholding an empty
    // fact is correct; a presence-only module would call it a suppression.
    const { polarity } = fraudSignalPolarity(
      fact("payment_authentication", { network: "mastercard", avsResult: null, cvvResult: null }, false),
    );
    expect(polarity).toBe("NEUTRAL");
  });

  it("is neutral when no supporting result is citable", () => {
    // Address failed AND no code match: we hold a weakness and cite nothing.
    // Nothing reached the issuer, so there is no disclosure to report.
    const { polarity } = fraudSignalPolarity(
      fact("payment_authentication", { avsResult: "N", cvvResult: "N" }, true),
    );
    expect(polarity).toBe("NEUTRAL");
  });

  it("reads order origin by country match", () => {
    expect(
      fraudSignalPolarity(fact("ip_location", { locationMatch: "same_country" }, false)).polarity,
    ).toBe("SUPPORTS_MERCHANT");
    expect(
      fraudSignalPolarity(fact("ip_location", { locationMatch: "different_country" }, false))
        .polarity,
    ).toBe("UNDERCUTS_MERCHANT");
  });

  it("treats an unrecognised payload as neutral rather than guessing", () => {
    expect(
      fraudSignalPolarity(fact("ip_location", { somethingElse: true }, false)).polarity,
    ).toBe("NEUTRAL");
    expect(fraudSignalPolarity(fact("payment_authentication", null, false)).polarity).toBe(
      "NEUTRAL",
    );
  });

  it("counts prior orders only when there are some", () => {
    expect(
      fraudSignalPolarity(fact("prior_customer_history", { priorOrderCount: 4 }, false)).polarity,
    ).toBe("SUPPORTS_MERCHANT");
    expect(
      fraudSignalPolarity(fact("prior_customer_history", { priorOrderCount: 0 }, false)).polarity,
    ).toBe("NEUTRAL");
  });
});

describe("adverse signal disclosed to the issuer", () => {
  it("fires only when an undercutting signal actually reached the issuer", () => {
    // Exercised with order origin, because payment verification can no longer
    // produce this state: an uncitable AVS is never rendered, so it cannot be
    // disclosed. On prod this finding now fires zero times, which matches what
    // the filed packages actually say.
    const { findings } = runFraudulentModule(
      snapshot([fact("ip_location", { locationMatch: "different_country" }, true)]),
    );
    const finding = findings.find((f) => f.title.includes("undercut the merchant"));
    expect(finding?.confidence).toBe("DEFINITE");
    expect(finding?.severity).toBe("HIGH");
    expect(finding?.observedFact).toMatch(/prompt 9/);
    expect(finding?.actionClass).toBe("RULE_ENGINE");
  });

  it("does not fire when the adverse signal was withheld", () => {
    const { findings } = runFraudulentModule(
      snapshot([fact("ip_location", { locationMatch: "different_country" }, false)]),
    );
    expect(findings.filter((f) => f.title.includes("undercut the merchant"))).toHaveLength(0);
  });

  it("does not fire on a failed AVS, because nothing was rendered", () => {
    // The 14-case false positive, pinned so it cannot return.
    const { findings } = runFraudulentModule(
      snapshot([fact("payment_authentication", { avsResult: "N", cvvResult: "M" }, true)]),
    );
    expect(findings.filter((f) => f.title.includes("undercut the merchant"))).toHaveLength(0);
  });
});

describe("supporting signal withheld", () => {
  it("raises a MODERATE finding, since citability is a review decision", () => {
    // 45 of 50 prod fraud packages held `same_country` and showed none of them.
    const { findings } = runFraudulentModule(
      snapshot([fact("ip_location", { locationMatch: "same_country" }, false)]),
    );
    const finding = findings.find((f) => f.title.includes("supporting the merchant"));
    expect(finding?.confidence).toBe("MODERATE");
    expect(finding?.description).toMatch(/review decision/i);
  });

  it("does not fire when the supporting signal was shown", () => {
    const { findings } = runFraudulentModule(
      snapshot([fact("ip_location", { locationMatch: "same_country" }, true)]),
    );
    expect(findings.filter((f) => f.title.includes("supporting the merchant"))).toHaveLength(0);
  });
});

describe("absent elements", () => {
  it("reports acquirable absences without claiming they existed", () => {
    // 15 of 50 prod fraud packages carry no delivery evidence at all.
    const { findings } = runFraudulentModule(
      snapshot([fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true)]),
    );
    const finding = findings.find((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE");
    expect(finding?.confidence).toBe("MODERATE");
    expect(finding?.description).toMatch(/does not mean they existed and were lost/i);
    expect(finding?.actionClass).toBe("EVIDENCE_ACQUISITION");
  });

  it("does not report a non-acquirable element as an acquisition gap", () => {
    // Payment verification and order origin cannot be "collected later".
    const { findings } = runFraudulentModule(
      snapshot([
        fact("delivery_proof", {}, true),
        fact("shipping_tracking", {}, true),
        fact("customer_communication", {}, true),
      ]),
    );
    expect(findings.filter((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE")).toHaveLength(0);
  });
});

describe("no causal claims on an all-loss cohort", () => {
  it("never asserts a configuration would have won", () => {
    const { findings } = runFraudulentModule(
      snapshot([
        fact("payment_authentication", { avsResult: "N", cvvResult: "M" }, true),
        fact("ip_location", { locationMatch: "same_country" }, false),
      ]),
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(
        validateFinding(f, { outcome: "lost", analysisLevel: "FULL_POST_OUTCOME" }),
      ).toEqual([]);
    }
  });
});

describe("delivery evidence is only acquirable if something shipped", () => {
  const orderRecord = (status: string) =>
    fact("order_record", { fulfillmentStatus: status }, false, "fact:order");

  it("does not ask for delivery proof on an unfulfilled order", () => {
    // Manual QA regression: the first version advised "capture delivery
    // confirmation" on 15 prod packages whose orders were 10x UNFULFILLED and
    // 5x ON_HOLD. There was no delivery to confirm.
    const { findings, observations } = runFraudulentModule(
      snapshot([
        orderRecord("UNFULFILLED"),
        fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true),
        fact("prior_customer_history", { priorOrderCount: 2 }, true),
        fact("customer_communication", {}, true),
      ]),
    );
    const missing = findings.find((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE");
    expect(missing).toBeUndefined();
    expect(observations.some((o) => o.key === "order_never_fulfilled")).toBe(true);
  });

  it("treats ON_HOLD the same as unfulfilled", () => {
    const { findings } = runFraudulentModule(
      snapshot([
        orderRecord("ON_HOLD"),
        fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true),
        fact("prior_customer_history", { priorOrderCount: 2 }, true),
        fact("customer_communication", {}, true),
      ]),
    );
    expect(findings.find((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE")).toBeUndefined();
  });

  it("still asks for delivery proof when the order WAS fulfilled", () => {
    const { findings } = runFraudulentModule(
      snapshot([
        orderRecord("FULFILLED"),
        fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true),
        fact("prior_customer_history", { priorOrderCount: 2 }, true),
        fact("customer_communication", {}, true),
      ]),
    );
    const missing = findings.find((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE");
    expect(missing?.observedFact).toMatch(/Delivery confirmation/);
  });

  it("keeps asking when fulfilment state is unknown rather than assuming", () => {
    const { findings } = runFraudulentModule(
      snapshot([fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }, true)]),
    );
    expect(findings.find((f) => f.category === "MISSING_ACQUIRABLE_EVIDENCE")).toBeDefined();
  });
});
