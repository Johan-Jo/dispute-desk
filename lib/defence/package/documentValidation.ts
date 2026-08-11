/**
 * Deterministic claim/document validation, run AFTER composition (CP-B §3).
 *
 * A FAILURE MAKES THE PACKAGE NON-FILEABLE. Never a warning, never a score,
 * never something a caller may weigh against a deadline. `DocumentValidationResult`
 * has exactly two fields for that reason: a boolean and machine codes.
 *
 * WHY AFTER COMPOSITION. Validating the model's JSON proves something about the
 * model's JSON. The thing that reaches the issuer is the COMPOSED document —
 * templated thesis, model body, deterministic fallback — and each of those three
 * layers has produced a claim the others had not. `validateComposedDocument`
 * already runs the phrase and claim-guard machinery over all three; this module
 * adds the checks that only exist once the plan is in the picture, and returns
 * the whole thing as one verdict.
 *
 * DETERMINISTIC MEANS DETERMINISTIC. No clock, no I/O, no model call, no
 * randomness. The same document produces the same verdict on every run, so a
 * failure is a fact about the document rather than a mood. Pinned by a test that
 * runs the same input twice and compares.
 */

import type {
  CaseArgumentPlanSnapshot,
  DocumentValidationResult,
} from "@/lib/pipeline/contracts";
import { RETIRED_PAYLOAD_KEYS } from "@/lib/evidence/model/retiredKeys";
import { validateComposedDocument } from "../validateNarrative";
import type {
  ComposedDocumentBlock,
  EvidenceFact,
  FactPredicateId,
  PackageMode,
} from "../types";
import type { OrphanedClaim } from "./projectFromPlan";

/**
 * Every way a composed document can be refused, enumerated.
 *
 * Enumerated rather than free-text because each one routes differently and
 * because a reviewer must be able to prove the list is exhaustive. The five
 * `ValidationErrorRule` values are carried through unchanged — renaming them
 * here would create a second vocabulary for the same failures.
 */
export type DocumentFailureCode =
  /** The plan says nothing safe remains. Nothing may be composed at all. */
  | "no_safe_argument"
  /** A section cited a record the plan removed. The orphaned-claim defect. */
  | "orphaned_claim"
  /** The plan authorises a record for which no fact exists. Inputs disagree. */
  | "plan_fact_mismatch"
  /** Composition produced no prose. An empty letter is not a safe letter. */
  | "empty_document"
  /** A persisted fact value still carries a retired delivery key (C-11). */
  | "retired_delivery_fact"
  | "forbidden_phrase"
  | "unsupported_claim"
  | "unauthorized_claim"
  | "unknown_fact_id"
  | "omitted_section_inconsistent"
  | "narrow_mode_aggressive_conclusion"
  | "internal_only_fact_referenced"
  | "missing_required_section";

export interface ValidatePackageDocumentInput {
  plan: CaseArgumentPlanSnapshot;
  blocks: ComposedDocumentBlock[];
  /** Exactly `plan.included`, resolved. Nothing else may be passed. */
  includedFacts: EvidenceFact[];
  orphaned: readonly OrphanedClaim[];
  missingRecordIds: readonly string[];
  packageMode: PackageMode;
  extraHardPhrases?: readonly RegExp[];
  guardedPhrases?: readonly { pattern: RegExp; requires: FactPredicateId }[];
}

/** Any prose at all in a block — thesis, body or fallback. */
function blockHasProse(block: ComposedDocumentBlock): boolean {
  return (
    block.thesisText.trim().length > 0 ||
    block.llmText.trim().length > 0 ||
    block.fallbackText.trim().length > 0
  );
}

/**
 * C-11's content rule, applied at composition time.
 *
 * `packageSafety` enforces it on PERSISTED rows, which is the boundary that
 * matters for the 212 already in the database. This is the same rule one step
 * earlier, so a newly composed document cannot become one of them.
 */
function retiredKeyFailure(facts: readonly EvidenceFact[]): boolean {
  for (const fact of facts) {
    const value = fact.value;
    if (!value || typeof value !== "object") continue;
    for (const key of RETIRED_PAYLOAD_KEYS) {
      if (key in (value as Record<string, unknown>)) return true;
    }
  }
  return false;
}

export function validatePackageDocument(
  input: ValidatePackageDocumentInput,
): DocumentValidationResult {
  const codes = new Set<DocumentFailureCode>();

  // 1. The plan's own verdict. Checked FIRST: if nothing safe remains, every
  //    later check is describing prose that should not exist.
  if (input.plan.noSafeArgument !== null) codes.add("no_safe_argument");
  if (input.plan.included.length === 0) codes.add("no_safe_argument");

  // 2. Orphaned claims. The projection drops these sections, so reaching here
  //    with a non-empty list means the document was composed from a narrative
  //    that cited removed support — recorded, and refused.
  if (input.orphaned.length > 0) codes.add("orphaned_claim");

  // 3. Plan and facts derived from different inputs.
  if (input.missingRecordIds.length > 0) codes.add("plan_fact_mismatch");

  // 4. A document with no prose. Not "trivially safe" — a letter that argues
  //    nothing still asserts, by being filed, that we had an answer.
  if (!input.blocks.some(blockHasProse)) codes.add("empty_document");

  // 5. Retired delivery keys in the surviving facts (C-11).
  if (retiredKeyFailure(input.includedFacts)) codes.add("retired_delivery_fact");

  // 6. The composed-prose contract: forbidden phrases, family-guarded phrases,
  //    structural claim authorization and the fact-property claim guards, over
  //    thesis, body and fallback of every surviving block.
  const composed = validateComposedDocument({
    blocks: input.blocks,
    approvedFacts: input.includedFacts,
    packageMode: input.packageMode,
    extraHardPhrases: input.extraHardPhrases,
    guardedPhrases: input.guardedPhrases,
  });
  for (const error of composed.errors) codes.add(error.rule as DocumentFailureCode);

  return {
    passed: codes.size === 0,
    // Sorted so the result is byte-identical across runs — a caller diffing two
    // verdicts must not see a change that is only Set iteration order.
    failureCodes: [...codes].sort(),
  };
}
