/**
 * Learning-action lifecycle (plan §15.8, §23 step 15).
 *
 * A reviewed finding becomes a change someone owns, with a frozen baseline and
 * a way to undo it. This module owns the STATE MACHINE and the preconditions;
 * the database owns the invariants that survive a bug here (see
 * `20260831140000_learning_actions.sql`).
 *
 * ── This never deploys anything ──
 *
 * Plan §15.8: the tool "must not directly mutate production rules, templates or
 * strength weights". `deploymentRef` records WHICH release performed the change;
 * making the change stays a separate, authorised act. That separation is the
 * point — an approval workflow that can also ship the change is a workflow that
 * will eventually ship one nobody approved.
 *
 * ── Nothing can be approved today ──
 *
 * Zero findings have been reviewed, so `canApprove` refuses everything. The
 * contract ships ahead of the data deliberately: it is easier to fix a rule
 * before anyone depends on it than to tighten one afterwards.
 */

import type { ActionClass } from "./taxonomy";

export const LEARNING_ACTION_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "DEPLOYED",
  "MEASURING",
  "KEEP",
  "REVISE",
  "ROLL_BACK",
  "CLOSED_INDETERMINATE",
] as const;
export type LearningActionStatus = (typeof LEARNING_ACTION_STATUSES)[number];

export const SCOPE_TYPES = [
  "MERCHANT",
  "NICHE",
  "PROVIDER",
  "REASON_NETWORK",
  "PLATFORM",
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Action classes a learning action may carry, plus calibration (plan §11). */
export type LearningActionClass = ActionClass | "STRENGTH_CALIBRATION";

/**
 * Legal transitions.
 *
 * `ROLL_BACK` is reachable from every post-deployment state on purpose: the
 * moment you need it is the moment something is wrong, and a state machine that
 * makes you pass through MEASURING first to undo a bad change is a state machine
 * that will be bypassed.
 */
const TRANSITIONS: Record<LearningActionStatus, readonly LearningActionStatus[]> = {
  DRAFT: ["READY_FOR_REVIEW", "CLOSED_INDETERMINATE"],
  READY_FOR_REVIEW: ["APPROVED", "DRAFT", "CLOSED_INDETERMINATE"],
  APPROVED: ["DEPLOYED", "DRAFT", "CLOSED_INDETERMINATE"],
  DEPLOYED: ["MEASURING", "ROLL_BACK"],
  MEASURING: ["KEEP", "REVISE", "ROLL_BACK", "CLOSED_INDETERMINATE"],
  KEEP: ["REVISE", "ROLL_BACK"],
  REVISE: ["DRAFT", "ROLL_BACK", "CLOSED_INDETERMINATE"],
  ROLL_BACK: ["CLOSED_INDETERMINATE"],
  CLOSED_INDETERMINATE: [],
};

export interface LearningActionState {
  status: LearningActionStatus;
  scopeType: ScopeType;
  ownerUserId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  deploymentRef: string | null;
  effectiveFrom: string | null;
  rollbackRef: string | null;
  baselineCohortDefinition: unknown | null;
  baselineMetrics: unknown | null;
  /** Analyses backing this action, with their review dispositions. */
  evidence: ReadonlyArray<{
    analysisId: string;
    reviewDisposition: "PENDING_REVIEW" | "CONFIRMED" | "EDITED" | "REJECTED" | "INDETERMINATE";
  }>;
}

export interface TransitionCheck {
  allowed: boolean;
  reasons: string[];
}

export function canTransition(
  from: LearningActionStatus,
  to: LearningActionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Dispositions that can support an action. A rejection is reviewed, not support. */
const SUPPORTING = new Set(["CONFIRMED", "EDITED"]);

/**
 * Preconditions for a transition, evaluated together so a caller sees every
 * blocker at once rather than fixing them one error at a time.
 */
export function checkTransition(
  state: LearningActionState,
  to: LearningActionStatus,
): TransitionCheck {
  const reasons: string[] = [];

  if (!canTransition(state.status, to)) {
    reasons.push(`${state.status} → ${to} is not a legal transition.`);
    return { allowed: false, reasons };
  }

  if (to === "READY_FOR_REVIEW") {
    if (!state.ownerUserId) reasons.push("An action needs an accountable owner.");
    if (state.evidence.length === 0) {
      reasons.push("An action needs at least one supporting finding.");
    }
  }

  if (to === "APPROVED") {
    const unsupported = state.evidence.filter(
      (e) => !SUPPORTING.has(e.reviewDisposition),
    );
    if (state.evidence.length === 0) {
      reasons.push("An action cannot be approved with no supporting findings.");
    }
    if (unsupported.length > 0) {
      // The single rule this whole module exists to protect (plan §17).
      reasons.push(
        `${unsupported.length} supporting finding(s) are not confirmed by a reviewer.`,
      );
    }
    // One case is an anecdote (plan §15.8).
    if (state.scopeType === "PLATFORM" && state.evidence.length < 2) {
      reasons.push(
        "A platform-wide action needs more than one supporting finding.",
      );
    }
    if (!state.baselineCohortDefinition || !state.baselineMetrics) {
      // Freezing after the change ships means measuring against a moving target.
      reasons.push("A baseline must be frozen before approval.");
    }
  }

  if (to === "DEPLOYED") {
    if (!state.approvedBy || !state.approvedAt) {
      reasons.push("Only an approved action can be deployed.");
    }
    if (!state.deploymentRef) {
      reasons.push(
        "A deployment must reference the release, config or task that performed it.",
      );
    }
    if (!state.effectiveFrom) {
      reasons.push("A deployment must record when it took effect.");
    }
    if (!state.rollbackRef) {
      reasons.push("A deployment must record how it can be reversed.");
    }
  }

  if (to === "MEASURING" && (!state.baselineCohortDefinition || !state.baselineMetrics)) {
    reasons.push("Measuring requires a frozen baseline to compare against.");
  }

  if (to === "ROLL_BACK" && !state.rollbackRef) {
    reasons.push("A rollback must say how the change is reversed.");
  }

  return { allowed: reasons.length === 0, reasons };
}

/* ───────────────────────────── Evaluation verdicts ────────────────────────── */

export type SampleQuality = "SUFFICIENT" | "DIRECTIONAL" | "INSUFFICIENT";
export type EvaluationResult =
  | "PROMISING"
  | "NO_CLEAR_CHANGE"
  | "ADVERSE_GUARDRAIL"
  | "INDETERMINATE"
  | "INSUFFICIENT_SAMPLE";

/**
 * The verdict a measurement supports.
 *
 * Deliberately conservative in both directions. An insufficient sample yields
 * `INSUFFICIENT_SAMPLE` no matter how good the numbers look — plan §18 forbids
 * a percentage claim below the thresholds, and "promising" off four cases is
 * that claim in a different word. A guardrail regression outranks any
 * improvement, because a change that helps one metric while breaking an
 * integrity measure is not a change worth keeping.
 */
export function evaluationVerdict(args: {
  sampleQuality: SampleQuality;
  guardrailRegression: boolean;
  baselineWinRate: number | null;
  postChangeWinRate: number | null;
}): EvaluationResult {
  if (args.guardrailRegression) return "ADVERSE_GUARDRAIL";
  if (args.sampleQuality === "INSUFFICIENT") return "INSUFFICIENT_SAMPLE";
  if (args.baselineWinRate === null || args.postChangeWinRate === null) {
    return "INDETERMINATE";
  }
  // A directional sample can say "no clear change" but never "promising":
  // promising is a claim, and a claim needs a sufficient sample behind it.
  if (args.sampleQuality === "DIRECTIONAL") return "NO_CLEAR_CHANGE";
  return args.postChangeWinRate > args.baselineWinRate ? "PROMISING" : "NO_CLEAR_CHANGE";
}
