import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/billing/plans";
import { fetchAllRows } from "@/lib/admin/fetchAllRows";
import {
  classifyBillingState,
  summarizeBilling,
  type EntitlementEvidence,
} from "@/lib/admin/paidSubscriptions";

export const runtime = "nodejs";

export async function GET() {
  const sb = getServiceClient();
  const monthStart = new Date(new Date().setDate(1)).toISOString();

  // PostgREST truncates un-ranged selects at 1000 rows — page everything.
  const [shopList, entitlements, packList] = await Promise.all([
    fetchAllRows<{
      id: string;
      shop_domain: string;
      primary_domain: string | null;
      plan: string | null;
      uninstalled_at: string | null;
    }>((from, to) =>
      sb.from("shops").select("id, shop_domain, primary_domain, plan, uninstalled_at").order("id").range(from, to),
    ),
    fetchAllRows<EntitlementEvidence & { trial_ends_at: string | null }>((from, to) =>
      sb
        .from("plan_entitlements")
        .select("shop_id, plan_key, subscription_state, first_paid_cycle_started_at, trial_ends_at")
        .order("shop_id")
        .range(from, to),
    ),
    fetchAllRows<{ shop_id: string }>((from, to) =>
      sb.from("evidence_packs").select("id, shop_id").gte("created_at", monthStart).order("id").range(from, to),
    ),
  ]);

  const entByShop = new Map(entitlements.map((e) => [e.shop_id, e]));
  const summary = summarizeBilling(shopList, entitlements);

  // Distribution is by payment state (paid shops split by their plan).
  const distribution: Record<string, number> = {};
  for (const s of shopList) {
    if (s.uninstalled_at) continue;
    const ent = entByShop.get(s.id);
    const st = classifyBillingState(s, ent);
    const key = st === "paid" ? (ent?.plan_key ?? s.plan ?? "free") : st;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  const packsByShop: Record<string, number> = {};
  for (const p of packList) {
    packsByShop[p.shop_id] = (packsByShop[p.shop_id] ?? 0) + 1;
  }

  const perShop = shopList
    .filter((s) => !s.uninstalled_at)
    .map((s) => {
      const ent = entByShop.get(s.id);
      const plan = ent?.plan_key ?? s.plan ?? "free";
      const used = packsByShop[s.id] ?? 0;
      const limit = PLANS[plan as keyof typeof PLANS]?.packsPerMonth ?? 5;
      return {
        shop_id: s.id,
        domain: s.shop_domain,
        primary_domain: s.primary_domain,
        plan,
        billing_state: classifyBillingState(s, ent),
        trial_ends_at: ent?.trial_ends_at ?? null,
        used,
        limit,
      };
    })
    .sort((a, b) => b.used - a.used)
    .slice(0, 50);

  return NextResponse.json({
    mrr: summary.mrr,
    labelMrr: summary.labelMrr,
    paidShops: summary.paid,
    trialingShops: summary.trialing,
    graceShops: summary.grace,
    unconfirmedShops: summary.unconfirmed,
    distribution,
    perShop,
  });
}
