import { getServiceClient } from "@/lib/supabase/server";
import { getPlan, type PlanId } from "./plans";

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
 *
 * `used` and `remaining` both come from `pack_balance`, which counts only
 * live grants and the usage charged to them. On a paid plan the live grant
 * is this cycle's allowance, so the counter resets at renewal and an unused
 * remainder is not carried into the next month.
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

  const { data: balance } = await sb
    .from("pack_balance")
    .select("remaining_packs, total_used")
    .eq("shop_id", shopId)
    .maybeSingle();

  const remaining = (balance?.remaining_packs as number | undefined) ?? 0;
  const used = (balance?.total_used as number | undefined) ?? 0;

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
