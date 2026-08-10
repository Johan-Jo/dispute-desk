/**
 * The canonical automation decision — public surface.
 *
 * Every entry point imports from here. Nothing outside this directory may
 * re-derive an action, a strength ladder or a readiness gate; the CI invariant
 * in `__tests__/legacyLadders.test.ts` fails the build when one reappears.
 *
 * BRANCH BOUNDARY. Nothing in this directory may import argument-plan or review
 * internals (`lib/argument/**`, `lib/defence/narrative*`, plan snapshots).
 * Automation decides what to do; the argument decides what to say. Enforced by
 * `__tests__/branchBoundary.test.ts`.
 */

export {
  AUTOMATION_DECISION_VERSION,
  AUTOMATION_POLICY_VERSION,
  DEFAULT_COMPLETENESS_THRESHOLD,
  automationPolicyFromSettings,
  type AutomationPolicy,
} from "./policy";

export { canonicalJson, hashDecisionInputs } from "./inputHash";

export {
  currentDecisionInputHash,
  decisionBlocks,
  decisionIsHeld,
  deriveCaseAutomationDecision,
  gateDecisionFromFacts,
  type AutomationGateFacts,
  type CaseAutomationDecisionInput,
  type RawGateFacts,
} from "./deriveCaseAutomationDecision";

export {
  isDeadlineWindowOpen,
  resolveDeadlineWindow,
  type DeadlineWindow,
  type DeadlineWindowState,
} from "./deadlineWindow";

export {
  notFileableReasonFor,
  selectForDeadline,
  selectForNormalExecution,
  type DeadlineExecutionOutcome,
  type FileableSelectorPort,
} from "./executionAdapters";

export {
  PROJECTED_ASSESSMENT_FRESHNESS,
  assessmentFromPackRow,
  buildCaseAutomationDecisionInput,
  decideForPack,
  gateFactsFromPackRow,
  packJsonOf,
  type BuildDecisionArgs,
  type DecisionPackRow,
} from "./loadCaseAutomationDecision";

