/**
 * Analysis-level gate tests (plan §4.4, §19 "Submission-confirmation tests").
 *
 * The fixtures are the real production shapes measured on 2026-08-30, not
 * invented ones — the 49/4 split of submitted packages on decided disputes, and
 * the 2 disputes carrying several submitted packages.
 */

import { describe, expect, it } from "vitest";
import {
  isForwardingConfirmed,
  noConnectorCapabilities,
  providerAccessLevelFor,
  resolveAnalysisLevel,
  shopifyPaymentsCapabilities,
  type AnalysisLevelInputs,
} from "../analysisLevel";

/** The 49 packages: submitted_confirmed, evidenceSentOn non-null, gid tied. */
function forwardedCase(): AnalysisLevelInputs {
  return {
    provider: "SHOPIFY_PAYMENTS",
    providerAccessLevel: "PARTIAL_CASE_FILE",
    exactPackageReconstructable: true,
    packageEvidenceTie: "EVIDENCE_GID_MATCH",
    submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
    outcomeReliable: true,
    hasSubmittedPackage: true,
  };
}

/** The 4 packages: verified save, status='submitted', but submitted_at NULL. */
function savedNeverForwardedCase(): AnalysisLevelInputs {
  return { ...forwardedCase(), submissionConfirmationSource: "PLATFORM_SAVE_ONLY" };
}

describe("resolveAnalysisLevel — the forwarding decision", () => {
  it("grants FULL_POST_OUTCOME when all four gate conditions hold", () => {
    const decision = resolveAnalysisLevel(forwardedCase());
    expect(decision.level).toBe("FULL_POST_OUTCOME");
    expect(decision.dataIntegrityLimitation).toBe(false);
    expect(decision.blockingReasons).toEqual([]);
  });

  it("refuses FULL_POST_OUTCOME for a verified save with no forwarding report", () => {
    // The exact prod shape that reads as "submitted" by both
    // defence_packages.status and shopify_response.verified.
    const decision = resolveAnalysisLevel(savedNeverForwardedCase());
    expect(decision.level).toBe("PACKAGE_INTEGRITY_ONLY");
    expect(decision.blockingReasons[0]).toMatch(/never reported forwarding/i);
  });

  it("refuses FULL_POST_OUTCOME on a merchant's own assertion", () => {
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      submissionConfirmationSource: "MANUAL_MERCHANT_REPORT",
    });
    expect(decision.level).toBe("PACKAGE_INTEGRITY_ONLY");
    expect(decision.blockingReasons[0]).toMatch(/merchant assertion/i);
  });

  it("treats a provider log as forwarding confirmation when one exists", () => {
    // submission_logs is empty today, but its absence must not be baked in as
    // a permanent rule — a real connector later supplies exactly this.
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      submissionConfirmationSource: "PROVIDER_LOG",
    });
    expect(decision.level).toBe("FULL_POST_OUTCOME");
  });

  it("does not downgrade a case merely because no submission_logs row exists", () => {
    // Provenance of the timestamp matters, not the existence of a log id.
    expect(isForwardingConfirmed("SHOPIFY_EVIDENCE_SENT_ON")).toBe(true);
    expect(isForwardingConfirmed("PLATFORM_SAVE_ONLY")).toBe(false);
    expect(isForwardingConfirmed("MANUAL_MERCHANT_REPORT")).toBe(false);
    expect(isForwardingConfirmed("NONE")).toBe(false);
  });
});

describe("resolveAnalysisLevel — package identity", () => {
  it("flags a data-integrity limitation when the forwarded package is ambiguous", () => {
    // 2 real prod disputes carry several submitted packages.
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES",
    });
    expect(decision.level).toBe("PACKAGE_INTEGRITY_ONLY");
    expect(decision.dataIntegrityLimitation).toBe(true);
    expect(decision.blockingReasons[0]).toMatch(/not identifiable/i);
  });

  it("flags a limitation when the package ties to no saved evidence", () => {
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      packageEvidenceTie: "NONE",
    });
    expect(decision.level).toBe("PACKAGE_INTEGRITY_ONLY");
    expect(decision.dataIntegrityLimitation).toBe(true);
  });

  it("ambiguity outranks forwarding confirmation", () => {
    // submitted_at exists, but we cannot say WHICH package went. Plan §4.4
    // requires a limitation, not a promotion on the strength of the timestamp.
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES",
      submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
    });
    expect(decision.level).not.toBe("FULL_POST_OUTCOME");
    expect(decision.dataIntegrityLimitation).toBe(true);
  });
});

describe("resolveAnalysisLevel — coarser gates", () => {
  it("falls to OUTCOME_METADATA_ONLY with no submitted package", () => {
    // ~888 decided prod disputes are historical imports with no package.
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      hasSubmittedPackage: false,
      exactPackageReconstructable: false,
      packageEvidenceTie: "NONE",
      submissionConfirmationSource: "NONE",
    });
    expect(decision.level).toBe("OUTCOME_METADATA_ONLY");
  });

  it("falls to NOT_ANALYZABLE when the outcome is unreliable", () => {
    const decision = resolveAnalysisLevel({
      ...forwardedCase(),
      outcomeReliable: false,
    });
    expect(decision.level).toBe("NOT_ANALYZABLE");
  });
});

describe("provider capabilities", () => {
  it("keeps Shopify Payments at PARTIAL_CASE_FILE even with a verified save", () => {
    const caps = shopifyPaymentsCapabilities({
      forwardingConfirmed: true,
      saveConfirmed: true,
    });
    expect(providerAccessLevelFor("SHOPIFY_PAYMENTS", caps)).toBe(
      "PARTIAL_CASE_FILE",
    );
    // We never get the buyer's narrative or the adjudicator's reasoning.
    expect(caps.claimDetailAccess).toBe(false);
    expect(caps.adjudicationReasonAccess).toBe(false);
  });

  it("never derives forwarding access from a save confirmation", () => {
    const caps = shopifyPaymentsCapabilities({
      forwardingConfirmed: false,
      saveConfirmed: true,
    });
    expect(caps.platformSaveConfirmation).toBe(true);
    expect(caps.submissionConfirmationAccess).toBe(false);
  });

  it("holds Klarna/PayPal at outcome-only until a connector exists", () => {
    const caps = noConnectorCapabilities({ outcomeAccess: true });
    expect(providerAccessLevelFor("KLARNA", caps)).toBe("OUTCOME_ONLY");
    expect(providerAccessLevelFor("PAYPAL", caps)).toBe("OUTCOME_ONLY");
    expect(caps.platformSaveConfirmation).toBe(false);
  });

  it("reports UNKNOWN provider as UNKNOWN access regardless of capabilities", () => {
    const caps = shopifyPaymentsCapabilities({
      forwardingConfirmed: true,
      saveConfirmed: true,
    });
    expect(providerAccessLevelFor("UNKNOWN", caps)).toBe("UNKNOWN");
  });
});

describe("the prod population, bucketed", () => {
  it("reproduces the measured 47 / 1 / 2 split", () => {
    const cases: AnalysisLevelInputs[] = [
      // 45 FRAUDULENT lost + 1 PNR lost + 1 PU lost, all forwarded.
      ...Array.from({ length: 47 }, forwardedCase),
      // The single won case: saved and verified, never reported forwarded.
      savedNeverForwardedCase(),
      // 2 FRAUDULENT lost with several submitted packages.
      ...Array.from({ length: 2 }, () => ({
        ...forwardedCase(),
        packageEvidenceTie: "AMBIGUOUS_MULTIPLE_PACKAGES" as const,
      })),
    ];

    const levels = cases.map((c) => resolveAnalysisLevel(c));
    expect(levels.filter((d) => d.level === "FULL_POST_OUTCOME")).toHaveLength(47);
    expect(levels.filter((d) => d.dataIntegrityLimitation)).toHaveLength(2);
    expect(
      levels.filter(
        (d) => d.level === "PACKAGE_INTEGRITY_ONLY" && !d.dataIntegrityLimitation,
      ),
    ).toHaveLength(1);
  });
});
