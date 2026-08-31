/**
 * Snapshot contract tests (plan §5, §19 "Snapshot tests").
 *
 * The contract's job is to make submission-time truth unforgeable. These tests
 * pin the two properties that carry that: a stable hash for identical content,
 * and structural refusal of the states that would let a hypothesis be stored as
 * an observation.
 */

import { describe, expect, it } from "vitest";
import {
  computeSnapshotHash,
  SNAPSHOT_CONTRACT_VERSION,
  validateSnapshotContract,
  type PostOutcomeSourceSnapshot,
  type SnapshotEvidenceItem,
} from "../snapshotContract";

function evidence(
  id: string,
  overrides: Partial<SnapshotEvidenceItem> = {},
): SnapshotEvidenceItem {
  return {
    id,
    source: "facts_json",
    category: "delivery",
    availableAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    signalValue: null,
    inclusionEligible: true,
    presentInSubmittedPackage: true,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<PostOutcomeSourceSnapshot> = {},
): PostOutcomeSourceSnapshot {
  return {
    contractVersion: SNAPSHOT_CONTRACT_VERSION,
    dispute: {
      id: "d-1",
      shopId: "s-1",
      phase: "chargeback",
      reason: "FRAUDULENT",
      networkReasonCode: "10.4",
      amount: "120.00",
      currencyCode: "USD",
      initiatedAt: "2026-07-01T00:00:00.000Z",
    },
    outcome: {
      finalOutcome: "lost",
      finalizedAt: "2026-08-01T00:00:00.000Z",
      reliable: true,
    },
    provider: {
      paymentProvider: "SHOPIFY_PAYMENTS",
      providerAccountRef: null,
      cardNetwork: "VISA",
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
      evidenceSavedToShopifyAt: "2026-07-09T00:00:00.000Z",
      platformSaveVerified: true,
      evidenceGid: "gid://shopify/DisputeEvidence/1",
      disputeEvidenceGid: "gid://shopify/DisputeEvidence/1",
      evidenceDeadlineAt: "2026-07-15T00:00:00.000Z",
      events: [],
    },
    submittedPackage: {
      packageId: "p-1",
      version: 1,
      submittedToPlatformAt: "2026-07-10T00:00:00.000Z",
      contentRevision: 1,
      pdfSha256: "abc",
      pdfPath: "packs/p-1.pdf",
      evidenceHash: "def",
      promptVersion: "v6",
      validatorVersion: 4,
      reasonCodeModule: "FRAUDULENT",
    },
    caseStrengthAtSubmission: "moderate",
    availableBeforeSubmission: [evidence("e-1")],
    arrivedAfterSubmission: [],
    availabilityUnknown: [],
    assertions: [],
    reconstructionGaps: [],
    ...overrides,
  };
}

describe("computeSnapshotHash", () => {
  it("is stable across key order and numeric representation", () => {
    const a = snapshot();
    const b = snapshot();
    // Same content, different insertion order for one nested object.
    b.dispute = {
      initiatedAt: a.dispute.initiatedAt,
      currencyCode: a.dispute.currencyCode,
      amount: a.dispute.amount,
      networkReasonCode: a.dispute.networkReasonCode,
      reason: a.dispute.reason,
      phase: a.dispute.phase,
      shopId: a.dispute.shopId,
      id: a.dispute.id,
    };
    expect(computeSnapshotHash(a)).toBe(computeSnapshotHash(b));
  });

  it("moves when a timestamp moves", () => {
    // Unlike computeEvidenceHash, snapshots must NOT drop timestamps: the
    // difference between "approved before submission" and "arrived after" is
    // the whole basis of an omission finding.
    const before = snapshot();
    const after = snapshot({
      availableBeforeSubmission: [
        evidence("e-1", { approvedAt: "2026-07-20T00:00:00.000Z" }),
      ],
    });
    expect(computeSnapshotHash(before)).not.toBe(computeSnapshotHash(after));
  });

  it("moves when evidence moves between availability buckets", () => {
    const omitted = snapshot({
      availableBeforeSubmission: [evidence("e-1", { presentInSubmittedPackage: false })],
    });
    const late = snapshot({
      availableBeforeSubmission: [],
      arrivedAfterSubmission: [evidence("e-1", { presentInSubmittedPackage: false })],
    });
    expect(computeSnapshotHash(omitted)).not.toBe(computeSnapshotHash(late));
  });
});

describe("validateSnapshotContract", () => {
  it("accepts a well-formed snapshot", () => {
    expect(validateSnapshotContract(snapshot())).toEqual([]);
  });

  it("rejects evidence appearing in two availability buckets", () => {
    // Overlap would let one item be both an omission and a late arrival.
    const errors = validateSnapshotContract(
      snapshot({
        availableBeforeSubmission: [evidence("e-1")],
        arrivedAfterSubmission: [evidence("e-1")],
      }),
    );
    expect(errors.join(" ")).toMatch(/appears in both/);
  });

  it("rejects a forwarding timestamp with no captured package", () => {
    const errors = validateSnapshotContract(snapshot({ submittedPackage: null }));
    expect(errors.join(" ")).toMatch(/no submitted package/i);
  });

  it("rejects a save-only source claiming forwarding access", () => {
    // The conflation this whole feature guards against, caught structurally.
    const base = snapshot();
    const errors = validateSnapshotContract({
      ...base,
      provider: {
        ...base.provider,
        submissionConfirmationSource: "PLATFORM_SAVE_ONLY",
        capabilities: {
          ...base.provider.capabilities,
          submissionConfirmationAccess: true,
        },
      },
    });
    expect(errors.join(" ")).toMatch(/PLATFORM_SAVE_ONLY/);
  });

  it("rejects an assertion referencing evidence not in the snapshot", () => {
    const errors = validateSnapshotContract(
      snapshot({
        assertions: [
          {
            id: "a-1",
            text: "Delivery was confirmed.",
            supportingEvidenceIds: ["e-missing"],
            unresolvedEvidenceIds: [],
            ruleRef: null,
            presentInSubmittedPdf: true,
          },
        ],
      }),
    );
    expect(errors.join(" ")).toMatch(/unknown evidence e-missing/);
  });

  it("rejects a stale contract version", () => {
    const errors = validateSnapshotContract(snapshot({ contractVersion: 0 }));
    expect(errors.join(" ")).toMatch(/contractVersion/);
  });
});
