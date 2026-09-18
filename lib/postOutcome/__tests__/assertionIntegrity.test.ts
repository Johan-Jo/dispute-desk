/**
 * Stage 4 assertion-integrity tests (plan §19 "Assertion/rule tests").
 *
 * The load-bearing one is the last block: an assertion we cannot check must be
 * NOT_MACHINE_VERIFIABLE, never UNSUPPORTED. Plan §7 Stage 4 says inability to
 * verify is not evidence of falsehood, and this is where a checker most easily
 * drifts into asserting one from the other.
 */

import { describe, expect, it } from "vitest";
import { runAssertionIntegrity } from "../checks/assertionIntegrity";
import { validateFinding } from "../findings";
import {
  SNAPSHOT_CONTRACT_VERSION,
  type PostOutcomeSourceSnapshot,
  type SnapshotAssertion,
  type SnapshotEvidenceItem,
} from "../snapshotContract";

function fact(id: string, issuerFacing: boolean): SnapshotEvidenceItem {
  return {
    id,
    source: "shopify_order",
    category: "order_record",
    availableAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    signalValue: null,
    inclusionEligible: issuerFacing,
    presentInSubmittedPackage: issuerFacing,
  };
}

function assertion(overrides: Partial<SnapshotAssertion> = {}): SnapshotAssertion {
  return {
    id: "section:executiveSummary",
    text: "AVS and CVV matched the issuer's records.",
    supportingEvidenceIds: [],
    unresolvedEvidenceIds: [],
    ruleRef: null,
    presentInSubmittedPdf: true,
    ...overrides,
  };
}

function snapshot(
  facts: SnapshotEvidenceItem[],
  assertions: SnapshotAssertion[],
): PostOutcomeSourceSnapshot {
  return {
    contractVersion: SNAPSHOT_CONTRACT_VERSION,
    dispute: {
      id: "d-1",
      shopId: "s-1",
      phase: "chargeback",
      reason: "FRAUDULENT",
      networkReasonCode: "10.4",
      amount: "1",
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
      promptVersion: "v6",
      validatorVersion: 4,
      reasonCodeModule: "FRAUDULENT",
    },
    caseStrengthAtSubmission: "not_assessed",
    availableBeforeSubmission: facts,
    arrivedAfterSubmission: [],
    availabilityUnknown: [],
    assertions,
    reconstructionGaps: [],
  };
}

describe("citations to facts the package does not carry", () => {
  it("is UNSUPPORTED and DEFINITE", () => {
    const { assertions, findings } = runAssertionIntegrity(
      snapshot([fact("fact:f1", true)], [
        assertion({
          supportingEvidenceIds: ["fact:f1"],
          unresolvedEvidenceIds: ["fact:ghost"],
        }),
      ]),
    );
    expect(assertions[0].classification).toBe("UNSUPPORTED");
    const finding = findings.find((f) => f.title.includes("does not contain"));
    expect(finding?.confidence).toBe("DEFINITE");
    expect(finding?.actionClass).toBe("RULE_ENGINE");
  });

  it("does not fire when every citation resolves", () => {
    // Prod: zero dangling citations across 308 sections. The check stays
    // because a rule that never fires is the one that stops being enforced.
    const { findings } = runAssertionIntegrity(
      snapshot([fact("fact:f1", true)], [
        assertion({ supportingEvidenceIds: ["fact:f1"] }),
      ]),
    );
    expect(findings.filter((f) => f.title.includes("does not contain"))).toHaveLength(0);
  });
});

describe("sections resting entirely on suppressed facts", () => {
  it("raises a MODERATE finding, not a DEFINITE one", () => {
    // 26 paymentAuthenticationArgument and 25 transactionOverviewArgument
    // sections in prod are in this state. What the record proves is the absence
    // of listed support, not that the prose overstates.
    const { findings } = runAssertionIntegrity(
      snapshot([fact("fact:f1", false)], [
        assertion({ supportingEvidenceIds: ["fact:f1"] }),
      ]),
    );
    const finding = findings.find((f) => f.title.includes("Evidence Basis does not list"));
    expect(finding?.confidence).toBe("MODERATE");
    expect(finding?.severity).toBe("MEDIUM");
  });

  it("does not fire when at least one cited fact reached the issuer", () => {
    const { findings } = runAssertionIntegrity(
      snapshot(
        [fact("fact:f1", true), fact("fact:f2", false)],
        [assertion({ supportingEvidenceIds: ["fact:f1", "fact:f2"] })],
      ),
    );
    expect(
      findings.filter((f) => f.title.includes("Evidence Basis does not list")),
    ).toHaveLength(0);
  });
});

describe("the known C-1 divergence is observed, not re-litigated", () => {
  it("records suppressed citations as an observation, never a finding", () => {
    // Convergence is deliberately deferred in lib/defence/bankInclusion.ts.
    // Re-reporting it as 53 defects would be noise, not learning.
    const { observations, findings } = runAssertionIntegrity(
      snapshot(
        [fact("fact:f1", true), fact("fact:f2", false)],
        [assertion({ supportingEvidenceIds: ["fact:f1", "fact:f2"] })],
      ),
    );
    const obs = observations.find((o) => o.key === "cites_suppressed_facts");
    expect(obs).toBeDefined();
    expect(obs?.detail).toMatch(/C-1/);
    expect(findings).toEqual([]);
  });
});

describe("unverifiable is not the same as false", () => {
  it("classifies a checkable-support assertion as NOT_MACHINE_VERIFIABLE", () => {
    // The prose may or may not overstate; deciding needs reading, not joins.
    const { assertions } = runAssertionIntegrity(
      snapshot([fact("fact:f1", true)], [
        assertion({ supportingEvidenceIds: ["fact:f1"] }),
      ]),
    );
    expect(assertions[0].classification).toBe("NOT_MACHINE_VERIFIABLE");
    expect(assertions[0].supportedByIssuerFacing).toEqual(["fact:f1"]);
  });

  it("never labels an unverifiable assertion UNSUPPORTED", () => {
    const { assertions } = runAssertionIntegrity(
      snapshot([fact("fact:f1", false)], [
        assertion({ supportingEvidenceIds: ["fact:f1"] }),
      ]),
    );
    expect(assertions[0].classification).toBe("NOT_MACHINE_VERIFIABLE");
    expect(assertions[0].supportedBySuppressed).toEqual(["fact:f1"]);
  });
});

describe("emitted findings satisfy the schema validator", () => {
  it("passes validateFinding for both Stage 4 findings", () => {
    const { findings } = runAssertionIntegrity(
      snapshot([fact("fact:f1", false)], [
        assertion({
          supportingEvidenceIds: ["fact:f1"],
          unresolvedEvidenceIds: ["fact:ghost"],
        }),
      ]),
    );
    for (const f of findings) {
      expect(
        validateFinding(f, { outcome: "lost", analysisLevel: "FULL_POST_OUTCOME" }),
      ).toEqual([]);
    }
  });
});
