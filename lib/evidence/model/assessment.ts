/**
 * Layer 2 — `CaseAssessment`: what the evidence is worth.
 *
 * Separate from `CaseEvidenceModel` and carrying its own `scoringPolicyVersion`,
 * so changing a threshold cannot change the meaning or version of "what
 * evidence exists". Plan §3.6.
 *
 * DELIBERATELY AN ADAPTER, NOT A PORT. This builds the scorer's inputs from
 * `model.fields` and calls the existing `calculateCaseStrength`. Rewriting the
 * family rules here would mean the P2b transition matrix measured two things
 * at once — the change of input AND my porting mistakes — and there would be
 * no way to tell them apart. Because the scorer is shared, every difference the
 * matrix reports is attributable to exactly one cause: the model sees evidence
 * the checklist never had a row for (the 76 divergences in
 * docs/evidence-model/divergence-manifest.json).
 *
 * The scorer is inlined into `lib/argument/caseStrength.ts` in a later phase,
 * once the checklist has no other consumers. Doing it now would be a rewrite
 * with no baseline.
 */

import {
  calculateCaseStrength,
  type CaseStrengthGates,
  type EvidencePayloadSource,
} from "@/lib/argument/caseStrength";
import type { CaseStrengthResult } from "@/lib/argument/types";
import type {
  ChecklistItemV2,
  EvidenceItemPriority,
  SubmissionReadiness,
} from "@/lib/types/evidenceItem";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import { definitionFor } from "./definitions";
import type { CaseEvidenceModel } from "./types";
import type { RelevanceLevel } from "./vocabulary";

/** Bumped when the scoring inputs or policy change. Recorded on every result. */
export const SCORING_POLICY_VERSION = 1;

export interface CaseAssessment {
  assessmentVersion: number;
  scoringPolicyVersion: number;
  modelVersion: number;
  sectionsHash: string;
  gates: CaseStrengthGates;
  strength: CaseStrengthResult;
  completeness: {
    score: number;
    evidenceStrengthScore: number;
    readiness: SubmissionReadiness;
    blockers: string[];
  };
}

const PRIORITY_BY_RELEVANCE: Record<RelevanceLevel, EvidenceItemPriority> = {
  critical: "critical",
  recommended: "recommended",
  optional: "optional",
  // A record that exists but the reason does not weigh. It still enters the
  // scorer — that is the whole correction — at the lowest weight, so its
  // presence can never be MORE important than a field the template asked for.
  not_applicable: "optional",
};

/**
 * `model.fields` → the scorer's checklist view.
 *
 * One row per field that actually has records. A field with no records is
 * omitted rather than emitted as `missing`, because `calculateCaseStrength`
 * only scores `available` rows and an empty row would change
 * `coveragePercent` (which divides by registered items) without changing
 * `overall` — a silent fleet-wide number move inside a scoring change.
 */
export interface ScoringPolicy {
  /**
   * Does a record whose reason template says `not_applicable` contribute to
   * strength?
   *
   * THIS IS A PRODUCT DECISION, NOT A REFACTOR DETAIL, and it is the only
   * behavioural choice in P2b. Both readings are defensible:
   *
   *   true  — "collection is fact" taken to its conclusion. The merchant has
   *           the evidence and we already cite it to the issuer, so it should
   *           count. Measured effect: 2 of 76 open disputes go weak → moderate
   *           (#352767 FRAUDULENT gains customer_account_info +
   *           no_return_initiated; #352501 DUPLICATE gains eleven fields
   *           including delivery_proof and avs_cvv_match).
   *   false — relevance means what it says. The record stays VISIBLE to the
   *           merchant and citable to the bank, but a field the reason does
   *           not weigh cannot move the score. Measured effect: zero strength
   *           changes; the 76 divergences are fixed for visibility only.
   *
   * Default `false` — the conservative reading. Making a case stronger is the
   * direction that files evidence we would otherwise have held, so it needs an
   * explicit decision rather than a default.
   */
  scoreNotApplicable: boolean;
}

export const DEFAULT_SCORING_POLICY: ScoringPolicy = { scoreNotApplicable: false };

export function checklistFromModel(
  model: CaseEvidenceModel,
  policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
): ChecklistItemV2[] {
  const out: ChecklistItemV2[] = [];
  for (const summary of Object.values(model.fields)) {
    if (summary.records.length === 0) continue;
    if (summary.relevance === "not_applicable" && !policy.scoreNotApplicable) continue;
    const def = definitionFor(summary.fieldKey);
    out.push({
      field: summary.fieldKey,
      // English label intentionally empty — `lib/**` must not emit English and
      // the scorer never reads it. Merchant-facing text resolves from
      // `def.labelToken` in the projection layer.
      label: "",
      status: summary.status.waived
        ? "waived"
        : summary.status.available
          ? "available"
          : "missing",
      priority: PRIORITY_BY_RELEVANCE[summary.relevance],
      blocking: summary.status.blocking,
      source: def.merchantSuppliable ? "manual_upload" : "auto_shopify",
    });
  }
  return out;
}

/**
 * `model.fields` → the checklist COMPLETENESS reads.
 *
 * Deliberately NOT `checklistFromModel`. Scoring only looks at `available`
 * rows, so omitting empty fields there is free. Completeness divides present
 * weight by TOTAL weight, so an omitted empty field shrinks the denominator
 * and silently inflates the score — which would push packs over their shop's
 * `auto_save_min_score` and auto-file cases that park today. The two
 * projections answer different questions and must stay separate.
 *
 * The row set mirrors today's template: fields the reason actually weighs.
 * Collected-but-`not_applicable` fields join only under the permissive
 * policy, and then they enter BOTH numerator and denominator.
 */
export function completenessChecklistFromModel(
  model: CaseEvidenceModel,
  policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
): ChecklistItemV2[] {
  const out: ChecklistItemV2[] = [];
  for (const summary of Object.values(model.fields)) {
    const isRelevant = summary.relevance !== "not_applicable";
    const counts =
      isRelevant || (policy.scoreNotApplicable && summary.records.length > 0);
    if (!counts) continue;
    const def = definitionFor(summary.fieldKey);
    out.push({
      field: summary.fieldKey,
      label: "",
      // `unavailable` is NOT "missing". `deriveCompletenessMetrics` drops
      // unavailable rows from the denominator entirely, so an order with no
      // refund is not penalised for having no refund record. Collapsing the
      // two read ~30 points low against prod.
      status: summary.status.waived
        ? "waived"
        : summary.status.available
          ? "available"
          : summary.status.applicable
            ? "missing"
            : "unavailable",
      priority: PRIORITY_BY_RELEVANCE[summary.relevance],
      blocking: summary.status.blocking,
      source: def.merchantSuppliable ? "manual_upload" : "auto_shopify",
    });
  }
  return out;
}

export function deriveCaseAssessment(args: {
  model: CaseEvidenceModel;
  gates: CaseStrengthGates;
  /**
   * Passed through UNCHANGED, exactly as the caller would give it to
   * `calculateCaseStrength` today.
   *
   * An earlier version built this from the model instead, keying one payload
   * per field. That silently changed a second variable: `buildPack` uses the
   * `list` form over ALL sections, and some fields (`avs_cvv_match`) are
   * emitted by two sections, so a first-match map handed the categorizer the
   * wrong payload and rated a real AVS match `invalid`. The transition matrix
   * then reported 56 of 76 prod packs as "stale" — a false finding produced
   * entirely by the adapter.
   *
   * The adapter must change exactly ONE thing: the checklist. Anything else
   * makes the matrix unattributable.
   */
  payloadSource: EvidencePayloadSource | undefined;
  policy?: ScoringPolicy;
}): CaseAssessment {
  const { model, gates, payloadSource, policy = DEFAULT_SCORING_POLICY } = args;
  const strength = calculateCaseStrength(
    checklistFromModel(model, policy),
    model.reason,
    payloadSource,
    gates,
  );
  // Same adapter discipline as strength: reuse the real engine rather than
  // restate the weights, so a difference can only come from the row set.
  const completeness = deriveCompletenessMetrics(
    completenessChecklistFromModel(model, policy),
  );
  return {
    assessmentVersion: 1,
    scoringPolicyVersion: SCORING_POLICY_VERSION,
    modelVersion: model.modelVersion,
    sectionsHash: model.derivedFrom.sectionsHash,
    gates,
    strength,
    completeness: {
      score: completeness.completenessScore,
      evidenceStrengthScore: completeness.evidenceStrengthScore,
      readiness: completeness.submissionReadiness,
      blockers: completeness.blockers,
    },
  };
}
