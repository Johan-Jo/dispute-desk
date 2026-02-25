import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "./plans";

export interface QuotaResult {
  allowed: boolean;
  plan: PlanId;
  used: number;
  limit: number | null;
  remaining: number | null;
  reason?: string;
}

/**
 * Check if a shop can create a new evidence pack this month.
 */
export async function checkPackQuota(shopId: string): Promise<QuotaResult> {
  const sb = getServiceClient();

  const { data: shop } = await sb
    .from("shops")
    .select("plan")
    .eq("id", shopId)
    .single();

  const planId = (shop?.plan ?? "free") as PlanId;
  const plan = getPlan(planId);

  if (plan.packsPerMonth === null) {
    return { allowed: true, plan: planId, used: 0, limit: null, remaining: null };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count } = await sb
    .from("evidence_packs")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("created_at", monthStart);

  const used = count ?? 0;
  const remaining = Math.max(0, plan.packsPerMonth - used);

  if (used >= plan.packsPerMonth) {
    return {
      allowed: false,
      plan: planId,
      used,
      limit: plan.packsPerMonth,
      remaining: 0,
      reason: `Monthly pack limit reached (${used}/${plan.packsPerMonth}). Upgrade to increase your limit.`,
    };
  }

  return {
    allowed: true,
    plan: planId,
    used,
    limit: plan.packsPerMonth,
    remaining,
  };
}

/**
 * Check if a shop's plan allows a specific feature.
 */
export function checkFeatureAccess(
  planId: string,
  feature: "autoPack" | "rules"
): { allowed: boolean; reason?: string } {
  const plan = getPlan(planId);

  if (!plan[feature]) {
    return {
      allowed: false,
      reason: `${feature === "autoPack" ? "Auto-pack" : "Rules"} is available on Starter and above.`,
    };
  }

  return { allowed: true };
}
