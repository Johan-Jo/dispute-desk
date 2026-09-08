export * from "./types";
export {
  resolveLifecycle,
  isTransmissionConfirmed,
  type LifecycleInput,
} from "./resolveLifecycle";
export {
  resolveAttention,
  type AttentionInput,
  type AttentionResult,
} from "./resolveAttention";
export { resolveStrength } from "./resolveStrength";
export {
  resolvePresentation,
  type PresentationInput,
} from "./resolvePresentation";
export { dashboardBucket } from "./buckets";
export {
  ACTIVE_NORMALIZED_STATUSES,
  isActiveNormalizedStatus,
} from "./isActive";
export {
  LIFECYCLE_CHIP,
  STRENGTH_CHIP,
  ATTENTION_CHIP,
  ATTENTION_ROW_EMPHASIS,
  OUTCOME_CHIP,
  type ChipTokens,
  type RowEmphasisTokens,
} from "./uiTokens";
export {
  lifecycleLabelKey,
  attentionLabelKey,
  strengthLabelKey,
  listPrimaryState,
} from "./labels";
export { effectiveReviewDecision } from "./reviewDecision";
export {
  FIELD_ACTIONS,
  DEFAULT_FIELD_ACTION,
  MERCHANT_ACTIONABLE_FIELDS,
  SYSTEM_DERIVED_FIELDS,
  canMerchantUpload,
  deriveConcreteContribution,
  type ChecklistRowFacts,
  type FieldAction,
} from "./concreteContribution";

export {
  canClaimPrepared,
  resolveArtifact,
  type ArtifactFreshness,
  type ArtifactIdentity,
  type ArtifactObservation,
  type ArtifactUnknownReason,
  type ArtifactValidation,
  type ObservedPackageRow,
  type ResolveArtifactInput,
} from "./resolveArtifact";

export {
  isInFlight,
  resolveBuildAttempt,
  suppressesAutomaticRecoveryPromise,
  type BuildAttempt,
  type BuildAttemptIdentity,
  type BuildAttemptState,
  type BuildAttemptUnknownReason,
  type ObservedActiveJob,
  type ObservedAttemptRow,
  type ResolveBuildAttemptInput,
} from "./resolveBuildAttempt";

export {
  mayPromiseAutomaticWork,
  mayRenderIntegrationGuidance,
  mayRenderLiveIntegrationCard,
  resolveAutomationPromise,
  resolveDeadlineFacts,
  delayNoteKey,
  resolveDelayCause,
  resolveIntegrationAvailability,
  type AutomationPromise,
  type DeadlineFacts,
  type DelayCause,
  type IntegrationAvailability,
  type ResolveAutomationInput,
  type ResolveDelayInput,
  type ResolveIntegrationInput,
} from "./resolveAvailability";

export {
  gatherArtifactFacts,
  type ArtifactFacts,
  type GatherArtifactOptions,
} from "./gatherArtifacts";

export {
  assertProjection,
  findingKey,
  type CaseProjection,
  type Finding,
  type FindingKind,
} from "./claimAssertions";
