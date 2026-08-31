/**
 * Stage 3 evidence-comparison tests (plan §19 "Evidence-comparison tests").
 *
 * The fixtures mirror the three real Gorgias-bearing prod disputes:
 *   #347844  1 approved passage, issuer-facing aggregate fact  → unverifiable
 *   #345920  5 approved passages, issuer-facing aggregate fact → unverifiable
 *   #345617  2 approved passages, fact derived but withheld    → omitted
 */

import { describe, expect, it } from "vitest";
import { runEvidenceComparison } from "../checks/evidenceComparison";
import { validateFinding } from "../findings";
import {
  SNAPSHOT_CONTRACT_VERSION,
  type PostOutcomeSourceSnapshot,
  type SnapshotEvidenceItem,
} from "../snapshotContract";

function item(overrides: Partial<SnapshotEvidenceItem>): SnapshotEvidenceItem {
  return {
    id: "fact:f1",
    source: "shopify_order",
    category: "order_record",
    availableAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    signalValue: null,
    inclusionEligible: true,
    presentInSubmittedPackage: true,
    ...overrides,
  };
}

function snapshot(
  buckets: Partial<
    Pick<
      PostOutcomeSourceSnapshot,
      "availableBeforeSubmission" | "arrivedAfterSubmission" | "availabilityUnknown"
    >
  >,
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
    availableBeforeSubmission: [],
    arrivedAfterSubmission: [],
    availabilityUnknown: [],
    assertions: [],
    reconstructionGaps: [],
    ...buckets,
  };
}

describe("presence settles inclusion before eligibility explains absence", () => {
  it("classifies an issuer-facing fact as included", () => {
    const { classified } = runEvidenceComparison(
      snapshot({ availableBeforeSubmission: [item({})] }),
    );
    expect(classified[0].classification).toBe("INCLUDED_ACCURATELY");
  });

  it("does not call a withheld internal fact 'pending'", () => {
    // Regression: eligibility-first ordering labelled 367 prod facts
    // PENDING_AND_CORRECTLY_EXCLUDED, including ones sitting in the package.
    const { classified } = runEvidenceComparison(
      snapshot({
        availableBeforeSubmission: [
          item({ inclusionEligible: false, presentInSubmittedPackage: false }),
        ],
      }),
    );
    expect(classified[0].classification).toBe("AVAILABLE_BUT_NOT_APPROVED");
    expect(classified[0].rationale).toMatch(/deliberate/i);
  });

  it("reserves PENDING for items never cleared for use", () => {
    const { classified } = runEvidenceComparison(
      snapshot({
        availableBeforeSubmission: [
          item({
            id: "gorgias:g-1",
            source: "gorgias",
            approvedAt: null,
            inclusionEligible: false,
            presentInSubmittedPackage: false,
          }),
        ],
      }),
    );
    expect(classified[0].classification).toBe("PENDING_AND_CORRECTLY_EXCLUDED");
  });
});

describe("aggregate sources", () => {
  const approvedPassage = item({
    id: "gorgias:g-1",
    source: "gorgias",
    category: "delivery_recognition",
    inclusionEligible: true,
    presentInSubmittedPackage: false,
  });

  it("is unverifiable when an issuer-facing aggregate fact exists", () => {
    // #347844 / #345920. Claiming inclusion would be a false clean bill;
    // claiming omission would be a false accusation.
    const { classified, findings } = runEvidenceComparison(
      snapshot({
        availableBeforeSubmission: [
          item({ id: "fact:f9", source: "gorgias", category: "customer_communication" }),
          approvedPassage,
        ],
      }),
    );
    const passage = classified.find((c) => c.id === "gorgias:g-1");
    expect(passage?.classification).toBe("INCLUSION_UNVERIFIABLE");
    expect(findings.some((f) => f.actionClass === "DATA_QUALITY")).toBe(true);
    expect(findings.some((f) => f.category === "AVAILABLE_EVIDENCE_OMITTED")).toBe(false);
  });

  it("names the mechanism when a fact was derived but withheld", () => {
    // #345617: two approved passages, one derived fact, bankEligible false.
    const { classified, findings } = runEvidenceComparison(
      snapshot({
        availableBeforeSubmission: [
          item({
            id: "fact:f10",
            source: "gorgias",
            inclusionEligible: false,
            presentInSubmittedPackage: false,
          }),
          approvedPassage,
        ],
      }),
    );
    const passage = classified.find((c) => c.id === "gorgias:g-1");
    expect(passage?.classification).toBe("AVAILABLE_BUT_OMITTED");
    expect(passage?.rationale).toMatch(/not cleared for issuer-facing use/i);

    const finding = findings.find((f) => f.category === "AVAILABLE_EVIDENCE_OMITTED");
    // The absence is proven; whether it was a mistake is a review decision.
    expect(finding?.confidence).toBe("DEFINITE");
    expect(finding?.severity).toBe("MEDIUM");
    expect(finding?.description).toMatch(/review decision/i);
  });

  it("reports a plain omission when no fact from the source exists at all", () => {
    const { classified } = runEvidenceComparison(
      snapshot({ availableBeforeSubmission: [approvedPassage] }),
    );
    const passage = classified.find((c) => c.id === "gorgias:g-1");
    expect(passage?.classification).toBe("AVAILABLE_BUT_OMITTED");
    expect(passage?.rationale).toMatch(/no fact from this source at all/i);
  });
});

describe("late and unknown evidence", () => {
  it("never scores post-submission arrivals as omissions", () => {
    const { classified, findings } = runEvidenceComparison(
      snapshot({
        arrivedAfterSubmission: [
          item({ id: "gorgias:g-late", source: "gorgias", presentInSubmittedPackage: false }),
        ],
      }),
    );
    expect(classified[0].classification).toBe("ARRIVED_AFTER_SUBMISSION");
    expect(findings).toEqual([]);
  });

  it("keeps unreconstructable availability separate from unverifiable inclusion", () => {
    const { classified } = runEvidenceComparison(
      snapshot({
        availabilityUnknown: [item({ id: "gorgias:g-?", source: "gorgias" })],
      }),
    );
    expect(classified[0].classification).toBe("AVAILABILITY_UNKNOWN");
  });
});

describe("emitted findings satisfy the schema validator", () => {
  it("passes validateFinding for both Stage 3 findings", () => {
    const { findings } = runEvidenceComparison(
      snapshot({
        availableBeforeSubmission: [
          item({
            id: "fact:f10",
            source: "gorgias",
            inclusionEligible: false,
            presentInSubmittedPackage: false,
          }),
          item({
            id: "gorgias:g-1",
            source: "gorgias",
            inclusionEligible: true,
            presentInSubmittedPackage: false,
          }),
        ],
      }),
    );
    for (const f of findings) {
      expect(
        validateFinding(f, { outcome: "lost", analysisLevel: "FULL_POST_OUTCOME" }),
      ).toEqual([]);
    }
  });
});
