import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { pickAutomationAction } from "./pickAutomationAction";
import type { Rule, RuleEvalResult } from "./types";

export type {
  Rule,
  RuleMatch,
  RuleAction,
  RuleEvalResult,
} from "./types";

interface DisputeContext {
  id: string;
  shop_id: string;
  reason: string | null;
  status: string | null;
  amount: number | null;
}

const DEFAULT_ACTION: RuleEvalResult["action"] = {
  mode: "manual",
  pack_template_id: null,
};

/**
 * Evaluate shop rules against a dispute using tiered precedence:
 * amount safeguards → per-reason rules → catch-all.
 * Default when no rule matches: manual (no auto-build, no review flag from rules).
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
    return {
      matchedRule: null,
      action: DEFAULT_ACTION,
      packTemplateId: null,
    };
  }

  const result = pickAutomationAction(rules as Rule[], dispute);

  if (result.matchedRule) {
    await logAuditEvent({
      shopId: dispute.shop_id,
      disputeId: dispute.id,
      actorType: "system",
      eventType: "rule_applied",
      eventPayload: {
        rule_id: result.matchedRule.id,
        match_conditions: result.matchedRule.match,
        resulting_action: result.action,
        pack_template_id: result.packTemplateId,
      },
    });
  }

  return result;
}
