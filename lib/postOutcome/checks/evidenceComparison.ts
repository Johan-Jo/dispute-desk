/**
 * Stage 3 — evidence inventory comparison (plan §7 Stage 3).
 *
 * Classifies every snapshot evidence item against the exact submitted package,
 * and raises the plan's highest-value finding — `AVAILABLE_EVIDENCE_OMITTED`,
 * §9's canonical DEFINITE — when the record can prove one.
 *
 * ── The limit this stage runs into, and refuses to paper over ──
 *
 * For a fact, inclusion is not in question: `facts_json` IS the package's
 * record of what it carried.
 *
 * For a Gorgias passage it is. A passage reaches a package as ONE aggregate
 * `customer_communication` fact carrying `{fieldKey, messageCount,
 * lastMessageAt, customerConfirmsOrder}` with `sourceRef: null`. Measured on
 * prod 2026-08-30: three such facts exist across the analyzable set, none links
 * to a `gorgias_evidence_messages.id`, and the disputes carrying them hold 5, 2
 * and 1 approved passages respectively.
 *
 * So on the dispute with five approved passages and one aggregate fact, the
 * retained record cannot say whether four were dropped or all five were
 * summarised. `INCLUDED_ACCURATELY` would issue a false clean bill;
 * `AVAILABLE_BUT_OMITTED` would accuse the pipeline of losing evidence it may
 * well have carried. The classification is `INCLUSION_UNVERIFIABLE`, and the
 * gap itself becomes a DATA_QUALITY finding — because the fix is to record
 * per-passage provenance, and until that exists this stage can never answer the
 * plan's central question for communications evidence.
 *
 * `AVAILABLE_EVIDENCE_OMITTED` therefore fires only where inclusion is
 * genuinely determinable — the package carries no issuer-facing fact from the
 * source — and the rationale then names which of two mechanisms applied:
 *
 *   never carried    no fact from that source exists at all.
 *   built, withheld  a fact was derived and then not cleared for issuer-facing
 *                    use, so a classification decision kept it from the bank.
 *
 * Those have different owners and only one is a mapping gap, so a reviewer must
 * see which happened. The live example is prod dispute #345617: two approved
 * passages (`delivery_recognition`, `resolution_attempt`), one derived Gorgias
 * fact, and that fact carrying `bankEligible: false`. The absence is proven;
 * whether it was a mistake is a review decision, which is why the finding is
 * DEFINITE on the absence but only MEDIUM severity and says so in its text.
 *
 * Note this is NOT the deliberate refund/cancellation exclusion (PR#352) —
 * those categories are hard-blocked from bank packs by design, and neither of
 * these two messages is in them.
 */

import type { DraftFinding } from "../findings";
import type {
  PostOutcomeSourceSnapshot,
  SnapshotEvidenceItem,
} from "../snapshotContract";
import type { EvidenceClassification } from "../taxonomy";

export interface ClassifiedEvidence extends SnapshotEvidenceItem {
  classification: EvidenceClassification;
  /** Why this classification, in one line, for the admin detail panel. */
  rationale: string;
}

export interface EvidenceComparisonResult {
  classified: ClassifiedEvidence[];
  findings: DraftFinding[];
  counts: Record<string, number>;
}

/** Sources whose inclusion collapses into an aggregate fact (see header). */
const AGGREGATED_SOURCES = new Set(["gorgias"]);

function classifyAvailable(
  item: SnapshotEvidenceItem,
  packageHasAggregateFor: (source: string) => boolean,
  packageBuiltButWithheld: (source: string) => boolean,
): { classification: EvidenceClassification; rationale: string } {
  // Presence is checked FIRST. An earlier ordering asked about eligibility
  // first and labelled 379 of 540 prod items "correctly excluded" — including
  // facts that were in the issuer-facing package. Being in the package settles
  // the question; eligibility only explains an absence.
  if (item.presentInSubmittedPackage) {
    return {
      classification: "INCLUDED_ACCURATELY",
      rationale: "Reached the issuer-facing content of the submitted package.",
    };
  }

  // Absent and ineligible: correct behaviour, never a defect. The two reasons
  // are different statements and an admin needs to tell them apart.
  if (!item.inclusionEligible) {
    if (item.approvedAt === null) {
      // Never cleared for use. Plan §7 Stage 3 is explicit that pending
      // communication evidence must never be counted as omitted.
      return {
        classification: "PENDING_AND_CORRECTLY_EXCLUDED",
        rationale:
          "Awaiting review at submission time, so it was correctly left out of the package.",
      };
    }
    // Reviewed and deliberately withheld from the issuer — an internal-only or
    // submission-risk fact. We held it; it was never ours to send.
    return {
      classification: "AVAILABLE_BUT_NOT_APPROVED",
      rationale:
        "Held at submission time but not cleared for issuer-facing use, so its absence is deliberate.",
    };
  }

  if (AGGREGATED_SOURCES.has(item.source)) {
    if (packageHasAggregateFor(item.source)) {
      return {
        classification: "INCLUSION_UNVERIFIABLE",
        rationale:
          "The package carries an issuer-facing aggregate fact for this source with no per-item reference, so inclusion cannot be determined either way.",
      };
    }
    if (packageBuiltButWithheld(item.source)) {
      // The pipeline DID carry this source; a classification decision then kept
      // it from the issuer. Distinct from never carrying it, and a reviewer
      // needs to see which happened before calling either one a defect.
      return {
        classification: "AVAILABLE_BUT_OMITTED",
        rationale:
          "A fact was derived from this source but was not cleared for issuer-facing use, so the approved item did not reach the package.",
      };
    }
    return {
      classification: "AVAILABLE_BUT_OMITTED",
      rationale:
        "Approved and eligible before submission, and the package carries no fact from this source at all.",
    };
  }

  return {
    classification: "AVAILABLE_BUT_OMITTED",
    rationale: "Approved and eligible before submission, and absent from the submitted package.",
  };
}

export function runEvidenceComparison(
  snapshot: PostOutcomeSourceSnapshot,
): EvidenceComparisonResult {
  const classified: ClassifiedEvidence[] = [];
  const findings: DraftFinding[] = [];

  // Which sources the package carries at all. A fact IS the package's record of
  // itself, so its own source is present by construction.
  const packageSources = new Set(
    snapshot.availableBeforeSubmission
      .filter((e) => e.presentInSubmittedPackage)
      .map((e) => e.source),
  );
  const packageHasAggregateFor = (source: string) => packageSources.has(source);

  // Sources the pipeline DID derive a fact from, which was then not cleared for
  // issuer-facing use. "We never carried it" and "we carried it and withheld
  // it" are different defects with different owners, and only one of them is a
  // mapping gap.
  const withheldSources = new Set(
    snapshot.availableBeforeSubmission
      .filter((e) => e.id.startsWith("fact:") && !e.presentInSubmittedPackage)
      .map((e) => e.source),
  );
  const packageBuiltButWithheld = (source: string) =>
    !packageSources.has(source) && withheldSources.has(source);

  for (const item of snapshot.availableBeforeSubmission) {
    const { classification, rationale } = classifyAvailable(
      item,
      packageHasAggregateFor,
      packageBuiltButWithheld,
    );
    classified.push({ ...item, classification, rationale });
  }

  for (const item of snapshot.arrivedAfterSubmission) {
    classified.push({
      ...item,
      classification: "ARRIVED_AFTER_SUBMISSION",
      rationale:
        "Obtained after submission. Relevant to future process, never an omission from this package.",
    });
  }

  for (const item of snapshot.availabilityUnknown) {
    classified.push({
      ...item,
      classification: "AVAILABILITY_UNKNOWN",
      rationale: "Whether this existed at submission time could not be reconstructed.",
    });
  }

  const counts: Record<string, number> = {};
  for (const c of classified) {
    counts[c.classification] = (counts[c.classification] ?? 0) + 1;
  }

  /* ── Provable omission ────────────────────────────────────────────────── */
  const omitted = classified.filter((c) => c.classification === "AVAILABLE_BUT_OMITTED");
  if (omitted.length > 0) {
    findings.push({
      category: "AVAILABLE_EVIDENCE_OMITTED",
      // The ABSENCE is proven; whether it was a mistake is not. The mechanism
      // is stated so a reviewer can tell a dropped item from a deliberate
      // classification decision, and severity stays MEDIUM because a withheld
      // item may have been withheld correctly.
      confidence: "DEFINITE",
      severity: "MEDIUM",
      title: `${omitted.length} approved item(s) available before submission did not reach the issuer`,
      description:
        "Evidence that was approved and held before submission is absent from the issuer-facing content of the package that was filed. Whether it should have been included is a review decision.",
      observedFact: omitted
        .map(
          (o) =>
            `${o.id} (${o.category ?? "uncategorised"}, approved ${o.approvedAt ?? "unknown"}): ${o.rationale}`,
        )
        .join(" "),
      counterfactualImprovement:
        "Confirm whether approved evidence of this kind should be cleared for issuer-facing use, and if so include it or regenerate the package after a late approval.",
      actionClass: "EVIDENCE_MAPPING",
      evidenceRefs: omitted.map((o) => ({ id: o.id })),
      ruleRefs: [{ id: "evidence.available_but_omitted", version: 1 }],
    });
  }

  /* ── The provenance gap that blocks the question entirely ─────────────── */
  const unverifiable = classified.filter(
    (c) => c.classification === "INCLUSION_UNVERIFIABLE",
  );
  if (unverifiable.length > 0) {
    findings.push({
      category: "DATA_INTEGRITY_FAILURE",
      confidence: "DEFINITE",
      severity: "MEDIUM",
      title: `Inclusion cannot be verified for ${unverifiable.length} approved item(s)`,
      description:
        "These items were approved and eligible before submission, but the package records them only as an aggregate with no per-item reference, so whether each one was filed cannot be determined.",
      observedFact:
        "The package carries an aggregate fact for this source with no per-item reference; the approved items cannot be matched to it individually.",
      counterfactualImprovement:
        "Record per-item provenance when communication evidence enters a package, so a decided case can be traced to the passages actually filed.",
      actionClass: "DATA_QUALITY",
      evidenceRefs: unverifiable.map((u) => ({ id: u.id })),
      ruleRefs: [{ id: "evidence.inclusion_unverifiable", version: 1 }],
    });
  }

  return { classified, findings, counts };
}
