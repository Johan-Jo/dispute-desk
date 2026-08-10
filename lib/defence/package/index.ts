/**
 * The package as a projection of `CaseArgumentPlan` — public surface (CP-B).
 *
 * Agent C's call sites import from here. Everything exported is pure: no I/O,
 * no clock, no Supabase client. The caller loads rows and passes them in, so a
 * selector decision can be reproduced from its inputs alone.
 */

export type {
  OrphanedClaim,
  PackageProjection,
  PlanFactSelection,
  ProjectPackageInput,
  RebuiltNarrative,
} from "./projectFromPlan";
export {
  SUPPORT_EXCLUDED_REASON,
  projectPackageFromPlan,
  rebuildNarrativeFromPlan,
  selectPlanFacts,
} from "./projectFromPlan";

export type {
  DocumentFailureCode,
  ValidatePackageDocumentInput,
} from "./documentValidation";
export { validatePackageDocument } from "./documentValidation";

export { hasFulfillmentClaimAuthority } from "./fulfillmentClaimAuthority";

// `FileablePackageCandidate` and `CurrentPipelineInputs` live in the shared
// contract as of revision 1 — import them from `@/lib/pipeline/contracts`.
// `SelectableCandidate` is CP-B's extension of the former, carrying the fields
// only the C-11 content verdict needs.
export type {
  SelectableCandidate,
  SelectFileablePackageInput,
} from "./selectFileablePackage";
export {
  deadlineExecutionConditions,
  isDeadlineOnly,
  selectFileablePackage,
} from "./selectFileablePackage";

export type {
  CanonicalSelector,
  DeadlineFallbackReason,
  FileableSelectionContext,
  JudgedCandidate,
} from "./loadFileableSelection";
export {
  createCanonicalSelector,
  fallbackReasonForSelection,
  loadFileableSelection,
  toSelectableCandidate,
} from "./loadFileableSelection";

export type {
  BuildSelectionContextArgs,
  SelectionContextPackRow,
} from "./caseSelectionContext";
export {
  buildFileableSelectionContext,
  derivePlanIdentityForPack,
} from "./caseSelectionContext";
