import type {
  DisputePhaseMatch,
  Rule,
  RuleAction,
  RuleEvalResult,
  RuleMatch,
} from "./types";

export interface DisputeEvalContext {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | null;
  /** Lifecycle phase of the dispute, if known. Rules with a `match.phase` filter use this. */
  phase?: DisputePhaseMatch | null;
}

function isAmountRule(match: RuleMatch): boolean {
  const r = match.amount_range;
  return r != null && (r.min != null || r.max != null);
}

function isReasonRule(match: RuleMatch): boolean {
  return Array.isArray(match.reason) && match.reason.length > 0;
}

/** Catch-all: no reason filter, no amount filter, no status filter. */
function isCatchAllRule(match: RuleMatch): boolean {
  if (isAmountRule(match)) return false;
  if (isReasonRule(match)) return false;
  if (match.status?.length) return false;
  return true;
}

function normalizeAction(action: Rule["action"]): RuleAction {
  const a = action as RuleAction;
  const mode = a.mode ?? "manual";
  if (mode === "auto_pack" || mode === "review" || mode === "manual") {
    return {
      mode,
      pack_template_id: a.pack_template_id ?? null,
      require_fields: a.require_fields,
    };
  }
  return { mode: "manual", pack_template_id: null };
}

function finish(rule: Rule): RuleEvalResult {
  const action = normalizeAction(rule.action);
  return {
    matchedRule: rule,
    action,
    packTemplateId: action.pack_template_id ?? null,
  };
}

/** Same priority: phase-specific beats phase-blind, review beats auto-build, then manual. */
function sortRulesByPriorityThenMode(a: Rule, b: Rule): number {
  const d = a.priority - b.priority;
  if (d !== 0) return d;
  const phaseRank = (r: Rule) => (r.match.phase?.length ? 0 : 1);
  const pd = phaseRank(a) - phaseRank(b);
  if (pd !== 0) return pd;
  const rank = (m: string) =>
    m === "review" ? 0 : m === "auto_pack" ? 1 : 2;
  const am = normalizeAction(a.action).mode;
  const bm = normalizeAction(b.action).mode;
  return rank(am) - rank(bm);
}

/**
 * Pure evaluation: tier 0 = amount safeguards, tier 1 = per-reason, tier 2 = catch-all.
 * Default when nothing matches: manual (no auto-build, no review queue).
 */
export function pickAutomationAction(
  rules: Rule[],
  dispute: DisputeEvalContext
): RuleEvalResult {
  const enabled = rules.filter((r) => r.enabled);
  const matches = enabled.filter((r) => matchesRule(dispute, r.match));

  if (matches.length === 0) {
    return {
      matchedRule: null,
      action: { mode: "manual", pack_template_id: null },
      packTemplateId: null,
    };
  }

  const tier0 = matches.filter((r) => isAmountRule(r.match));
  if (tier0.length) {
    const sorted = [...tier0].sort(sortRulesByPriorityThenMode);
    return finish(sorted[0]);
  }

  if (dispute.reason) {
    const tier1 = matches.filter(
      (r) =>
        isReasonRule(r.match) && r.match.reason!.includes(dispute.reason!)
    );
    if (tier1.length) {
      const sorted = [...tier1].sort(sortRulesByPriorityThenMode);
      return finish(sorted[0]);
    }
  }

  const tier2 = matches.filter((r) => isCatchAllRule(r.match));
  if (tier2.length) {
    const sorted = [...tier2].sort(sortRulesByPriorityThenMode);
    return finish(sorted[0]);
  }

  return {
    matchedRule: null,
    action: { mode: "manual", pack_template_id: null },
    packTemplateId: null,
  };
}

function matchesRule(dispute: DisputeEvalContext, match: RuleMatch): boolean {
  if (match.phase?.length) {
    if (!dispute.phase || !match.phase.includes(dispute.phase)) return false;
  }

  if (match.reason?.length) {
    if (!dispute.reason || !match.reason.includes(dispute.reason)) return false;
  }

  if (match.status?.length) {
    if (!dispute.status || !match.status.includes(dispute.status)) return false;
  }

  if (match.amount_range) {
    if (dispute.amount == null) return false;
    const { min, max } = match.amount_range;
    if (min != null && dispute.amount < min) return false;
    if (max != null && dispute.amount > max) return false;
  }

  return true;
}
