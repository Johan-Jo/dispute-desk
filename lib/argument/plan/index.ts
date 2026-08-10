/**
 * `CaseArgumentPlan` — public surface (CP-B).
 *
 * Consumers import from here. The snapshot SHAPE lives in
 * `lib/pipeline/contracts/argumentPlan.ts` and is coordinator-owned; this
 * package owns the derivation that produces it.
 */

export type { PlanCandidate } from "./candidates";
export { planCandidatesFromModel } from "./candidates";

export type { DeriveArgumentPlanInput } from "./deriveArgumentPlan";
export {
  PLAN_VERSION,
  deriveCaseArgumentPlan,
  excludedRecordIds,
  includedRecordIds,
  planHasSafeArgument,
} from "./deriveArgumentPlan";

export type { PlanInputHashParts } from "./planInputHash";
export { computePlanInputHash } from "./planInputHash";

export type { DerivePlanForCaseInput, PlanForCase } from "./planForCase";
export { PLAN_POLICY_VERSION, derivePlanForCase } from "./planForCase";

export { EXCLUSION_REASON_TOKENS, exclusionReasonToken } from "./exclusionTokens";
