import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "./plans";
import { getBalance } from "./consumePack";

export interface QuotaResult {
  allowed: boolean;
  plan: PlanId;
  used: number;
  limit: number | null;
  remaining: number;
  reason?: string;
}

/**
 * Check if a shop can consume a pack credit (finalize/export/submit).
 * Uses the credit-ledger balance rather than counting evidence_packs rows.
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

  const remaining = await getBalance(shopId);

  const { data: usageData } = await sb
    .from("pack_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  const used = (usageData as unknown as number) ?? 0;

  const limit = plan.packsLifetime ?? plan.packsPerMonth;

  if (remaining < 1) {
    return {
      allowed: false,
      plan: planId,
      used,
      limit,
      remaining: 0,
      reason: "Pack limit reached. Upgrade your plan or purchase a top-up.",
    };
  }

  return {
    allowed: true,
    plan: planId,
    used,
    limit,
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
