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

export type {
  CurrentFreshnessInputs,
  FileablePackageCandidate,
  SelectFileablePackageInput,
} from "./selectFileablePackage";
export {
  deadlineExecutionConditions,
  isDeadlineOnly,
  selectFileablePackage,
} from "./selectFileablePackage";
