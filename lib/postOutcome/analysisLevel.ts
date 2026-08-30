/**
 * The analysis-level gate — plan §4.4, decision of 2026-08-30.
 *
 * This module answers one question: how much is the analyzer ALLOWED to
 * conclude about this case? Everything downstream reads the answer; nothing
 * downstream may widen it.
 *
 * ── Why the gate is strict about "submitted" ──
 *
 * `defence_packages.shopify_response` proves DisputeDesk attached evidence to
 * Shopify and verified the readback — `verified`,
 * `finalStatus: saved_to_shopify_verified`, `evidenceGid`, `fileGid`. It does
 * NOT prove Shopify forwarded that evidence to the issuer or the card network.
 * Neither does `defence_packages.status = 'submitted'`, which means submitted
 * *to Shopify*.
 *
 * Measured in prod on 2026-08-30, over the 53 submitted packages on decided
 * disputes:
 *
 *   49 pkgs  submission_state=submitted_confirmed  status=submitted  verified=true  submitted_at PRESENT
 *    4 pkgs  submission_state=saved_to_shopify     status=submitted  verified=true  submitted_at NULL
 *
 * Those four read as "submitted" by both the package status and the save
 * confirmation, while Shopify never reported forwarding them. An analyzer
 * keying off either signal scores them as sent to the network.
 *
 * The forwarding signal is `submitted_confirmed` plus a `submitted_at` whose
 * provenance is Shopify's own `evidenceSentOn`. Provenance is what matters, not
 * the existence of a separate log row: `submission_logs` is empty
 * platform-wide, and that absence is not disqualifying. `raw_snapshot.evidenceSentOn`
 * is present as a key on 53/53 and non-null on exactly the 49 confirmed ones —
 * so the four saved-only cases carry an explicit null, which is positive
 * evidence of non-forwarding rather than missing data.
 *
 * ── The cost of the gate, and why it is worth paying ──
 *
 * 47 of 50 analyzable disputes still reach FULL_POST_OUTCOME. The one case that
 * drops to PACKAGE_INTEGRITY_ONLY is the platform's ONLY win. That is the gate
 * working: a win with no forwarding confirmation means the network very likely
 * never saw our package, so the win cannot be attributed to our evidence.
 * Without this gate it would have become the sole
 * EFFECTIVE_CONFIGURATION_CANDIDATE and seeded a "winning configuration"
 * learned from a package nobody adjudicated.
 */

import {
  type AnalysisLevel,
  type PackageEvidenceTie,
  type PaymentProvider,
  type ProviderAccessLevel,
  type ProviderCapabilities,
  type SubmissionConfirmationSource,
} from "./taxonomy";

/** The four §4.4 gate conditions, evaluated independently so each can be reported. */
export interface AnalysisLevelInputs {
  provider: PaymentProvider;
  providerAccessLevel: ProviderAccessLevel;
  /** Condition 1 — frozen package record, hash, and content all present. */
  exactPackageReconstructable: boolean;
  /** Condition 2 — how the package ties to the saved platform evidence. */
  packageEvidenceTie: PackageEvidenceTie;
  /** Condition 3 — provenance of any forwarding claim. */
  submissionConfirmationSource: SubmissionConfirmationSource;
  /** Condition 4 — outcome is a reliable won/lost. */
  outcomeReliable: boolean;
  /** Present at all? A dispute with no package cannot exceed metadata-only. */
  hasSubmittedPackage: boolean;
}

export interface AnalysisLevelDecision {
  level: AnalysisLevel;
  /** True when the package could not be tied to the submission (plan §4.4). */
  dataIntegrityLimitation: boolean;
  /** Which gate conditions failed, for the admin detail panel and findings. */
  blockingReasons: string[];
}

/**
 * Sources that constitute proof of FORWARDING. A merchant's own assertion is
 * not provider confirmation, and a save confirmation is not forwarding.
 */
const FORWARDING_CONFIRMED_SOURCES: ReadonlySet<SubmissionConfirmationSource> =
  new Set(["SHOPIFY_EVIDENCE_SENT_ON", "PROVIDER_LOG"]);

export function isForwardingConfirmed(
  source: SubmissionConfirmationSource,
): boolean {
  return FORWARDING_CONFIRMED_SOURCES.has(source);
}

export function resolveAnalysisLevel(
  inputs: AnalysisLevelInputs,
): AnalysisLevelDecision {
  const blockingReasons: string[] = [];

  if (!inputs.outcomeReliable) {
    return {
      level: "NOT_ANALYZABLE",
      dataIntegrityLimitation: false,
      blockingReasons: ["Outcome is not a reliable won/lost."],
    };
  }

  if (!inputs.hasSubmittedPackage || !inputs.exactPackageReconstructable) {
    return {
      level: "OUTCOME_METADATA_ONLY",
      dataIntegrityLimitation: false,
      blockingReasons: [
        inputs.hasSubmittedPackage
          ? "The exact submitted package could not be reconstructed."
          : "No submitted package exists for this dispute.",
      ],
    };
  }

  // Condition 2. Several submitted packages with no identifiable forwarded one
  // is a defect in its own right, not a reason to guess. Plan §4.4 requires a
  // data-integrity limitation rather than a silent promotion.
  if (inputs.packageEvidenceTie === "AMBIGUOUS_MULTIPLE_PACKAGES") {
    return {
      level: "PACKAGE_INTEGRITY_ONLY",
      dataIntegrityLimitation: true,
      blockingReasons: [
        "Several submitted packages exist and the forwarded one is not identifiable.",
      ],
    };
  }
  if (inputs.packageEvidenceTie === "NONE") {
    return {
      level: "PACKAGE_INTEGRITY_ONLY",
      dataIntegrityLimitation: true,
      blockingReasons: [
        "The package could not be associated with the saved platform evidence.",
      ],
    };
  }

  // Condition 3 — the decision this whole module exists for.
  if (!isForwardingConfirmed(inputs.submissionConfirmationSource)) {
    blockingReasons.push(
      inputs.submissionConfirmationSource === "PLATFORM_SAVE_ONLY"
        ? "Evidence was saved and verified, but the platform never reported forwarding it."
        : inputs.submissionConfirmationSource === "MANUAL_MERCHANT_REPORT"
          ? "Submission is a merchant assertion, not provider confirmation."
          : "No forwarding confirmation from the platform.",
    );
    return {
      level: "PACKAGE_INTEGRITY_ONLY",
      dataIntegrityLimitation: false,
      blockingReasons,
    };
  }

  return {
    level: "FULL_POST_OUTCOME",
    dataIntegrityLimitation: false,
    blockingReasons: [],
  };
}

/**
 * Shopify Payments capability defaults.
 *
 * `PARTIAL_CASE_FILE` permanently, regardless of how good the save
 * confirmation is: we never receive the buyer's narrative or the adjudicator's
 * rationale. `submissionConfirmationAccess` is per-case, not per-provider —
 * it depends on whether THIS dispute carries a trusted `evidenceSentOn`.
 */
export function shopifyPaymentsCapabilities(args: {
  forwardingConfirmed: boolean;
  saveConfirmed: boolean;
}): ProviderCapabilities {
  return {
    claimDetailAccess: false,
    providerEvidenceReadAccess: true,
    providerEvidenceWriteAccess: true,
    platformSaveConfirmation: args.saveConfirmed,
    submissionConfirmationAccess: args.forwardingConfirmed,
    outcomeAccess: true,
    adjudicationReasonAccess: false,
  };
}

/**
 * Klarna and PayPal: no independent case-file access until a real connector
 * supplies their case records (plan §4.3/§4.4). Outcomes may still be visible.
 */
export function noConnectorCapabilities(args: {
  outcomeAccess: boolean;
}): ProviderCapabilities {
  return {
    claimDetailAccess: false,
    providerEvidenceReadAccess: false,
    providerEvidenceWriteAccess: false,
    platformSaveConfirmation: false,
    submissionConfirmationAccess: false,
    outcomeAccess: args.outcomeAccess,
    adjudicationReasonAccess: false,
  };
}

export function providerAccessLevelFor(
  provider: PaymentProvider,
  capabilities: ProviderCapabilities,
): ProviderAccessLevel {
  if (provider === "UNKNOWN") return "UNKNOWN";

  if (capabilities.claimDetailAccess && capabilities.adjudicationReasonAccess) {
    return "FULL_CASE_FILE";
  }
  if (capabilities.providerEvidenceReadAccess) return "PARTIAL_CASE_FILE";
  if (capabilities.outcomeAccess) return "OUTCOME_ONLY";
  return "NO_PROVIDER_CASE_ACCESS";
}
