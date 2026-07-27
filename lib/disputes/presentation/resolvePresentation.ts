/**
 * Composes the three dimension resolvers + external-lifecycle facts
 * into one `DisputePresentation` — the single interpretation shared by
 * dashboard, list, and detail (plan §3).
 *
 * `resolveAttention` output is never allowed to feed back into
 * `resolveLifecycle`.
 */

import {
  ACTION_REQUIRED_ATTENTION,
  type DisputePresentation,
  type OutcomeKind,
} from "./types";
import {
  isTransmissionConfirmed,
  resolveLifecycle,
  type LifecycleInput,
} from "./resolveLifecycle";
import { resolveAttention, type AttentionInput } from "./resolveAttention";
import { resolveStrength } from "./resolveStrength";
import { isActiveNormalizedStatus } from "./isActive";

export interface PresentationInput extends LifecycleInput {
  /** `caseStrength.overall` from the rules engine (or null pre-pack). */
  strengthOverall: string | null;
  /** Attention facts (lifecycle facts are reused from LifecycleInput). */
  attentionReason: string | null;
  needsAttention: boolean;
  integrationReconnectRequired: boolean;
  gorgiasActionableCount: number;
  automationMode: "auto" | "review" | null;
  approvedForSaveAt: string | null;
  concreteContribution: "recommended" | "optional" | null;
  gorgiasEvidenceStale: boolean;
}

const TERMINAL_LIFECYCLES = new Set(["won", "lost", "closed"]);

export function resolvePresentation(
  input: PresentationInput,
): DisputePresentation {
  const lifecycle = resolveLifecycle(input);
  const terminal = TERMINAL_LIFECYCLES.has(lifecycle);
  const transmissionConfirmed = isTransmissionConfirmed(input);

  const attentionInput: AttentionInput = {
    attentionReason: input.attentionReason,
    needsAttention: input.needsAttention,
    integrationReconnectRequired: input.integrationReconnectRequired,
    gorgiasActionableCount: input.gorgiasActionableCount,
    automationMode: input.automationMode,
    packStatus: input.packStatus,
    approvedForSaveAt: input.approvedForSaveAt,
    concreteContribution: input.concreteContribution,
    packFailed: input.packStatus === "failed" || input.packStatus === "save_failed",
    gorgiasEvidenceStale: input.gorgiasEvidenceStale,
    submissionUncertain: input.submissionState === "submission_uncertain",
    terminal,
    transmissionConfirmed,
  };
  const { attention, blockingReason, internalIssue } = resolveAttention(attentionInput);

  const outcome: OutcomeKind =
    lifecycle === "won"
      ? "won"
      : lifecycle === "lost"
        ? "lost"
        : lifecycle === "closed"
          ? "closed"
          : "pending";

  return {
    lifecycle,
    attention,
    blockingReason,
    strength: resolveStrength(input.strengthOverall),
    transmissionConfirmed,
    editable: !terminal && !transmissionConfirmed,
    terminal,
    outcome,
    internalIssue,
    needsMerchantAction: ACTION_REQUIRED_ATTENTION.has(attention),
    isActive: !terminal && isActiveNormalizedStatus(input.normalizedStatus),
  };
}
