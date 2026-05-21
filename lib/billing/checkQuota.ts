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

  // Scope "used" to the current billing cycle on paid plans so the UI's
  // "N of <packsPerMonth> packs used" counter resets each renewal.
  // Free / Sandbox uses a lifetime allowance, so it stays unscoped.
  // (Previously this read `data` from a `head:true` count query, which
  // is always null — so the counter was permanently stuck at 0.)
  let cycleStart: string | null = null;
  if (plan.packsLifetime == null) {
    const { data: entitlement } = await sb
      .from("plan_entitlements")
      .select("billing_cycle_started_at")
      .eq("shop_id", shopId)
      .maybeSingle();
    cycleStart = (entitlement as { billing_cycle_started_at: string | null } | null)
      ?.billing_cycle_started_at ?? null;
  }

  let usageQuery = sb
    .from("pack_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);
  if (cycleStart) usageQuery = usageQuery.gte("created_at", cycleStart);
  const { count: usageCount } = await usageQuery;

  const used = usageCount ?? 0;

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
