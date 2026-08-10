/**
 * The plan's input unit — one candidate record, already canonical.
 *
 * WHY A LOCAL SHAPE RATHER THAN `CaseEvidenceRecord` DIRECTLY. The derivation
 * needs exactly five properties, and taking the whole record would let a future
 * change reach for `payload` and re-classify inside the plan — which is the one
 * thing `CaseArgumentPlan` exists to stop. Narrowing the input is the structural
 * version of "the plan consumes classification, it does not perform it".
 *
 * Nothing here is derived from raw collector JSON. Every field is carried
 * straight off a `CaseEvidenceRecord` by `planCandidatesFromModel`.
 */

import type { CaseEvidenceModel } from "@/lib/evidence/model/types";
import { definitionFor } from "@/lib/evidence/model/definitions";
import type { CitationEligibility, ValidityState } from "@/lib/evidence/model/vocabulary";

export interface PlanCandidate {
  /** Stable, source-derived. Never positional. */
  recordId: string;
  fieldKey: string;
  /** The argument category this record would support. Drives allow-list checks. */
  factCategory: string;
  validity: ValidityState;
  citation: CitationEligibility;
}

/**
 * `CaseEvidenceModel` → plan candidates.
 *
 * Every record of every field, flattened. Nothing is collapsed here: sibling
 * collapse is a PRESENTATION decision owned by `projections.ts`, and collapsing
 * during planning would silently drop a record whose exclusion the merchant is
 * owed a reason for.
 */
export function planCandidatesFromModel(model: CaseEvidenceModel): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  for (const summary of Object.values(model.fields)) {
    const definition = definitionFor(summary.fieldKey);
    for (const record of summary.records) {
      out.push({
        recordId: record.recordId,
        fieldKey: summary.fieldKey,
        factCategory: definition.factCategory,
        validity: record.validity.state,
        citation: record.citation.eligibility,
      });
    }
  }
  return out;
}
