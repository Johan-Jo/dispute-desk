/**
 * Stage 2 lifecycle-check tests (plan §19 "Lifecycle tests").
 *
 * The headline case is the deadline one: it pins that the check reads OUR
 * submission timestamp and not the platform's forwarding timestamp. On prod
 * those differ by an average of 47 hours, and reading the wrong one produces 41
 * false "we filed late" findings against a pipeline that filed a median six
 * days early.
 */

import { describe, expect, it } from "vitest";
import { runLifecycleChecks } from "../checks/lifecycle";
import { validateFinding } from "../findings";
import { resolveAnalysisLevel } from "../analysisLevel";
import {
  SNAPSHOT_CONTRACT_VERSION,
  type PostOutcomeSourceSnapshot,
} from "../snapshotContract";

const DEADLINE = "2026-08-06T23:00:00.000Z";
const WE_SUBMITTED = "2026-07-31T20:00:00.000Z"; // ~6 days early, the prod norm
const PLATFORM_FORWARDED = "2026-08-07T08:39:00.000Z"; // after the deadline

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
      initiatedAt: "2026-06-28T00:00:00.000Z",
    },
    outcome: { finalOutcome: "lost", finalizedAt: "2026-08-20T00:00:00.000Z", reliable: true },
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
      submittedAt: PLATFORM_FORWARDED,
      evidenceSavedToShopifyAt: WE_SUBMITTED,
      platformSaveVerified: true,
      evidenceGid: "gid://shopify/DisputeEvidence/1",
      disputeEvidenceGid: "gid://shopify/DisputeEvidence/1",
      evidenceDeadlineAt: DEADLINE,
      events: [],
    },
    submittedPackage: {
      packageId: "p-1",
      version: 1,
      submittedToPlatformAt: WE_SUBMITTED,
      contentRevision: 1,
      pdfSha256: null,
      pdfPath: "packs/p-1.pdf",
      evidenceHash: "hash",
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
    ...overrides,
  };
}

const FORWARDED_LEVEL = resolveAnalysisLevel({
  provider: "SHOPIFY_PAYMENTS",
  providerAccessLevel: "PARTIAL_CASE_FILE",
  exactPackageReconstructable: true,
  packageEvidenceTie: "EVIDENCE_GID_MATCH",
  submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
  outcomeReliable: true,
  hasSubmittedPackage: true,
});

describe("the deadline check reads OUR timestamp, not the platform's", () => {
  it("raises no late-filing finding when we filed early and the platform forwarded late", () => {
    // The exact prod shape, 41 times over. A check reading
    // lifecycle.submittedAt would fire on every one of them.
    const { findings } = runLifecycleChecks(snapshot(), FORWARDED_LEVEL);
    expect(
      findings.filter((f) => f.title.includes("after the evidence deadline")),
    ).toHaveLength(0);
  });

  it("records the platform's lag as an observation, not a defect", () => {
    const { observations, findings } = runLifecycleChecks(snapshot(), FORWARDED_LEVEL);
    const obs = observations.find((o) => o.key === "platform_forwarded_after_deadline");
    expect(obs).toBeDefined();
    expect(obs?.detail).toMatch(/9\.7h after the deadline/);
    expect(obs?.detail).toMatch(/before the deadline/);
    // It must not carry an action class or a severity — it is not ours to fix.
    expect(findings.some((f) => f.actionClass === "PIPELINE_RELIABILITY")).toBe(false);
  });

  it("does raise a finding when WE genuinely filed late", () => {
    const late = snapshot();
    const result = runLifecycleChecks(
      {
        ...late,
        submittedPackage: {
          ...late.submittedPackage!,
          submittedToPlatformAt: "2026-08-07T02:00:00.000Z",
        },
      },
      FORWARDED_LEVEL,
    );
    const finding = result.findings.find((f) =>
      f.title.includes("after the evidence deadline"),
    );
    expect(finding).toBeDefined();
    expect(finding?.confidence).toBe("DEFINITE");
    expect(finding?.actionClass).toBe("PIPELINE_RELIABILITY");
  });
});

describe("saved but never forwarded", () => {
  it("raises a critical DEFINITE finding", () => {
    const base = snapshot();
    const { findings } = runLifecycleChecks(
      {
        ...base,
        provider: { ...base.provider, submissionConfirmationSource: "PLATFORM_SAVE_ONLY" },
        lifecycle: { ...base.lifecycle, submittedAt: null },
      },
      resolveAnalysisLevel({
        provider: "SHOPIFY_PAYMENTS",
        providerAccessLevel: "PARTIAL_CASE_FILE",
        exactPackageReconstructable: true,
        packageEvidenceTie: "EVIDENCE_GID_MATCH",
        submissionConfirmationSource: "PLATFORM_SAVE_ONLY",
        outcomeReliable: true,
        hasSubmittedPackage: true,
      }),
    );
    const finding = findings.find(
      (f) => f.category === "PROCEDURAL_OR_SUBMISSION_FAILURE",
    );
    expect(finding?.confidence).toBe("DEFINITE");
    expect(finding?.severity).toBe("CRITICAL");
    expect(finding?.observedFact).toMatch(/no platform-originated forwarding/i);
  });
});

describe("ambiguous forwarded package", () => {
  it("raises a DATA_INTEGRITY_FAILURE rather than guessing", () => {
    const base = snapshot();
    const { findings } = runLifecycleChecks(
      {
        ...base,
        provider: {
          ...base.provider,
          packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES",
        },
        submittedPackage: null,
      },
      resolveAnalysisLevel({
        provider: "SHOPIFY_PAYMENTS",
        providerAccessLevel: "PARTIAL_CASE_FILE",
        exactPackageReconstructable: false,
        packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES",
        submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
        outcomeReliable: true,
        hasSubmittedPackage: true,
      }),
    );
    expect(findings.some((f) => f.category === "DATA_INTEGRITY_FAILURE")).toBe(true);
    // And no "forwarding without package" finding: the limitation explains it.
    expect(
      findings.filter((f) => f.title.includes("no package to attribute")),
    ).toHaveLength(0);
  });
});

describe("clean cases stay clean", () => {
  it("produces no findings for a well-formed forwarded case", () => {
    const clean = snapshot();
    const { findings } = runLifecycleChecks(
      {
        ...clean,
        lifecycle: { ...clean.lifecycle, submittedAt: "2026-08-01T00:00:00.000Z" },
      },
      FORWARDED_LEVEL,
    );
    expect(findings).toEqual([]);
  });
});

describe("every emitted finding survives the schema validator", () => {
  it("passes validateFinding for each lifecycle scenario", () => {
    const base = snapshot();
    const scenarios: PostOutcomeSourceSnapshot[] = [
      base,
      {
        ...base,
        provider: { ...base.provider, submissionConfirmationSource: "PLATFORM_SAVE_ONLY" },
      },
      {
        ...base,
        provider: { ...base.provider, packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES" },
        submittedPackage: null,
      },
      {
        ...base,
        submittedPackage: {
          ...base.submittedPackage!,
          submittedToPlatformAt: "2026-08-09T00:00:00.000Z",
        },
      },
    ];

    for (const s of scenarios) {
      const { findings } = runLifecycleChecks(s, FORWARDED_LEVEL);
      for (const finding of findings) {
        expect(
          validateFinding(finding, {
            outcome: s.outcome.finalOutcome,
            analysisLevel: FORWARDED_LEVEL.level,
          }),
        ).toEqual([]);
      }
    }
  });
});
