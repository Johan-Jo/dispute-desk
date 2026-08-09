/**
 * Canonical pipeline — shared contracts (CP-0 contract commit).
 *
 * These are the ONLY shapes Agents A, B and C may depend on across epic
 * boundaries. Private helpers inside an epic are free; a competing version of
 * anything exported here is not.
 *
 * Changing an exported shape requires a coordinator contract revision: the
 * coordinator amends `epic/canonical-pipeline-lite`, sends one decision to all
 * three agents, and each agent rebases before continuing. A contract revision
 * is not a review event.
 *
 * Plan of record: `docs/plans/canonical-pipeline-lite.plan.md` §5.
 * Kickoff note:   `docs/plans/canonical-pipeline-kickoff.md`.
 */

export type {
  InputHash,
  SnapshotFreshness,
  StalenessReason,
  FreshnessVerdict,
} from "./freshness";
export { evaluateFreshness } from "./freshness";

export type {
  CaseAssessmentSnapshot,
  CompletenessSnapshot,
  GateDecision,
  MerchantAssessmentProjection,
  MerchantReviewItem,
} from "./assessment";

export type {
  CaseArgumentPlanSnapshot,
  DocumentValidationResult,
  ExcludedFact,
  ExclusionReason,
  IncludedFact,
  NoSafeArgumentReason,
} from "./argumentPlan";

export type {
  AutomationAction,
  AutomationReasonCode,
  CaseAutomationDecisionSnapshot,
  DeadlineExecutionConditions,
} from "./automationDecision";
export { mayExecuteAtDeadline } from "./automationDecision";

export type {
  CurrentPipelineInputs,
  FileablePackageCandidate,
  FileableSelection,
  NotFileableReason,
  SelectedPackage,
  SelectionTrigger,
} from "./fileableSelection";
export { isFileable } from "./fileableSelection";
