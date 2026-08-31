/**
 * Stage 2 — deterministic lifecycle and submission checks (plan §7 Stage 2).
 *
 * Pure. Every check reads the immutable snapshot and nothing else, so each one
 * is a fixture test rather than a database experiment.
 *
 * ── The check that is NOT here, and why ──
 *
 * "We filed after the evidence deadline" was the obvious first check, and on a
 * naive reading of the data it fires 41 times out of 53. It is wrong 41 times
 * out of 41.
 *
 * `disputes.raw_snapshot.evidenceSentOn` is when SHOPIFY forwarded the
 * evidence. `defence_packages.submitted_at` is when WE handed it over. Measured
 * on prod 2026-08-30:
 *
 *   we submitted after the deadline .................  0 / 53
 *   we saved after the deadline .....................  0 / 53
 *   Shopify forwarded after the deadline ............ 41 / 53
 *   mean lead time we gave (deadline − our submit) ... 147 h  (min 4.4 h)
 *   mean lag Shopify added (forward − our submit) ....  47 h
 *
 * We were never late. Not once. A deadline check that reads the platform's
 * timestamp as ours manufactures 41 procedural failures against a pipeline that
 * filed a median six days early — the precise failure mode this feature exists
 * to avoid, arriving in the feature's own first stage.
 *
 * So the deadline check below tests OUR timestamp, and the platform's lag is
 * reported as an observation rather than a finding: it is real, it is worth an
 * admin's attention, and it is not a defect we own or an outcome we can
 * attribute.
 */

import type { DraftFinding, LifecycleObservation } from "../findings";
import type { PostOutcomeSourceSnapshot } from "../snapshotContract";
import type { AnalysisLevelDecision } from "../analysisLevel";

export interface LifecycleCheckResult {
  findings: DraftFinding[];
  observations: LifecycleObservation[];
}

function hoursBetween(later: string, earlier: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 3_600_000;
}

export function runLifecycleChecks(
  snapshot: PostOutcomeSourceSnapshot,
  level: AnalysisLevelDecision,
): LifecycleCheckResult {
  const findings: DraftFinding[] = [];
  const observations: LifecycleObservation[] = [];

  const { lifecycle, provider, submittedPackage } = snapshot;
  const deadline = lifecycle.evidenceDeadlineAt;
  const ourSubmit = submittedPackage?.submittedToPlatformAt ?? null;
  const platformForwarded = lifecycle.submittedAt;

  /* ── Saved and verified, but never forwarded ──────────────────────────── */
  if (provider.submissionConfirmationSource === "PLATFORM_SAVE_ONLY") {
    findings.push({
      category: "PROCEDURAL_OR_SUBMISSION_FAILURE",
      confidence: "DEFINITE",
      severity: "CRITICAL",
      title: "Evidence was saved to the platform but never reported as forwarded",
      description:
        "The platform confirmed it stored the evidence and read it back, but never reported forwarding it to the issuer. The package may not have reached an adjudicator.",
      observedFact: lifecycle.platformSaveVerified
        ? "Platform save confirmed (verified readback with an evidence id); no platform-originated forwarding timestamp exists."
        : "Evidence was recorded as saved; no platform-originated forwarding timestamp exists.",
      counterfactualImprovement:
        "Detect a save that is never followed by a forwarding confirmation, and surface it while the deadline can still be met.",
      actionClass: "PIPELINE_RELIABILITY",
      evidenceRefs: [],
      ruleRefs: [{ id: "lifecycle.saved_not_forwarded", version: 1 }],
    });
  }

  /* ── Several submitted packages; the forwarded one is unidentifiable ──── */
  if (provider.packageEvidenceTie === "AMBIGUOUS_MULTIPLE_PACKAGES") {
    findings.push({
      category: "DATA_INTEGRITY_FAILURE",
      confidence: "DEFINITE",
      severity: "HIGH",
      title: "The forwarded package cannot be identified",
      description:
        "More than one package on this dispute carries a submission timestamp, and the record does not say which one the platform forwarded. Package-level analysis is not possible.",
      observedFact:
        "Multiple submitted packages exist for this dispute and none is distinguishable as the forwarded one.",
      counterfactualImprovement:
        "Record which package a submission forwarded, so a decided case can be traced to the exact content that was filed.",
      actionClass: "PIPELINE_RELIABILITY",
      evidenceRefs: [],
      ruleRefs: [{ id: "lifecycle.ambiguous_forwarded_package", version: 1 }],
    });
  }

  /* ── We filed after the deadline (OUR timestamp; see the module header) ── */
  if (deadline && ourSubmit && Date.parse(ourSubmit) > Date.parse(deadline)) {
    findings.push({
      category: "PROCEDURAL_OR_SUBMISSION_FAILURE",
      confidence: "DEFINITE",
      severity: "CRITICAL",
      title: "Evidence was submitted after the evidence deadline",
      description:
        "DisputeDesk handed the package to the platform after the stated evidence deadline had passed.",
      observedFact: `Our submission at ${ourSubmit} is after the evidence deadline of ${deadline}.`,
      counterfactualImprovement:
        "Ensure the deadline path submits before the stated deadline rather than on or after it.",
      actionClass: "PIPELINE_RELIABILITY",
      evidenceRefs: [],
      ruleRefs: [{ id: "lifecycle.we_submitted_after_deadline", version: 1 }],
    });
  }

  /* ── Package built after it was already forwarded ─────────────────────── */
  // A package generated after the submission cannot be what was filed, so
  // analysing its content as the filed argument would be an error.
  if (
    submittedPackage &&
    platformForwarded &&
    ourSubmit &&
    Date.parse(ourSubmit) > Date.parse(platformForwarded)
  ) {
    findings.push({
      category: "DATA_INTEGRITY_FAILURE",
      confidence: "HIGH",
      severity: "HIGH",
      title: "The retained package post-dates the submission it is attached to",
      description:
        "The package we hold was handed over after the platform had already forwarded evidence for this dispute, so it may not be the content that was filed.",
      observedFact: `Package submission at ${ourSubmit} is after the platform forwarding at ${platformForwarded}.`,
      counterfactualImprovement:
        "Pin the forwarded content at submission time so a later rebuild cannot displace the filed record.",
      actionClass: "DATA_QUALITY",
      evidenceRefs: [],
      ruleRefs: [{ id: "lifecycle.package_postdates_submission", version: 1 }],
    });
  }

  /* ── Contradictory state: confirmed forwarding with no package of ours ── */
  if (platformForwarded && !submittedPackage && !level.dataIntegrityLimitation) {
    findings.push({
      category: "DATA_INTEGRITY_FAILURE",
      confidence: "HIGH",
      severity: "MEDIUM",
      title: "Forwarding is recorded with no package to attribute it to",
      description:
        "A forwarding timestamp exists for this dispute but no package of ours is associated with it.",
      observedFact: `Platform forwarding recorded at ${platformForwarded} with no submitted package captured.`,
      counterfactualImprovement:
        "Distinguish evidence the platform assembled itself from evidence DisputeDesk built and filed.",
      actionClass: "DATA_QUALITY",
      evidenceRefs: [],
      ruleRefs: [{ id: "lifecycle.forwarding_without_package", version: 1 }],
    });
  }

  /* ── Observations: real, measurable, and not ours to fix ──────────────── */
  if (deadline && platformForwarded && Date.parse(platformForwarded) > Date.parse(deadline)) {
    const lateHours = hoursBetween(platformForwarded, deadline);
    const leadHours = ourSubmit ? hoursBetween(deadline, ourSubmit) : null;
    observations.push({
      key: "platform_forwarded_after_deadline",
      summary: "The platform forwarded this evidence after its own stated deadline",
      detail:
        `Forwarded ${lateHours.toFixed(1)}h after the deadline` +
        (leadHours !== null
          ? `, having received it from DisputeDesk ${leadHours.toFixed(1)}h before the deadline.`
          : ".") +
        " Whether the issuer considered evidence forwarded after the deadline is not something the record shows.",
    });
  }

  if (deadline && ourSubmit && Date.parse(ourSubmit) <= Date.parse(deadline)) {
    observations.push({
      key: "submitted_before_deadline",
      summary: "DisputeDesk submitted before the evidence deadline",
      detail: `Submitted ${hoursBetween(deadline, ourSubmit).toFixed(1)}h before the deadline.`,
    });
  }

  for (const gap of snapshot.reconstructionGaps) {
    observations.push({
      key: "reconstruction_gap",
      summary: "Part of the submission-time record could not be reconstructed",
      detail: gap,
    });
  }

  return { findings, observations };
}
