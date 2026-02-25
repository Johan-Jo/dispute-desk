import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";

export interface RuleMatch {
  reason?: string[];
  status?: string[];
  amount_range?: { min?: number; max?: number };
}

export interface RuleAction {
  mode: "auto_pack" | "review";
  require_fields?: string[];
}

export interface Rule {
  id: string;
  shop_id: string;
  enabled: boolean;
  match: RuleMatch;
  action: RuleAction;
  priority: number;
  name?: string;
  created_at: string;
  updated_at: string;
}

export interface RuleEvalResult {
  matchedRule: Rule | null;
  action: RuleAction;
}

interface DisputeContext {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | null;
}

function matchesRule(dispute: DisputeContext, match: RuleMatch): boolean {
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

const DEFAULT_ACTION: RuleAction = { mode: "review" };

/**
 * Evaluate shop rules against a dispute. First match wins (ordered by priority).
 * Default action (no match) = review.
 */
export async function evaluateRules(
  dispute: DisputeContext
): Promise<RuleEvalResult> {
  const sb = getServiceClient();

  const { data: rules } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", dispute.shop_id)
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (!rules?.length) {
    return { matchedRule: null, action: DEFAULT_ACTION };
  }

  for (const rule of rules as Rule[]) {
    if (matchesRule(dispute, rule.match)) {
      await logAuditEvent({
        shopId: dispute.shop_id,
        disputeId: dispute.id,
        actorType: "system",
        eventType: "rule_applied",
        eventPayload: {
          rule_id: rule.id,
          match_conditions: rule.match,
          resulting_action: rule.action,
        },
      });

      return { matchedRule: rule, action: rule.action };
    }
  }

  return { matchedRule: null, action: DEFAULT_ACTION };
}
