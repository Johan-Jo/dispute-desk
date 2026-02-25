import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/billing/plans";

export const runtime = "nodejs";

export async function GET() {
  const sb = getServiceClient();

  const [shops, recentPacks] = await Promise.all([
    sb.from("shops").select("id, shop_domain, plan, uninstalled_at"),
    sb.from("evidence_packs").select("shop_id, created_at").gte(
      "created_at",
      new Date(new Date().setDate(1)).toISOString()
    ),
  ]);

  const shopList = shops.data ?? [];
  const packList = recentPacks.data ?? [];

  const distribution: Record<string, number> = {};
  let mrr = 0;

  for (const s of shopList) {
    if (s.uninstalled_at) continue;
    const plan = s.plan ?? "free";
    distribution[plan] = (distribution[plan] ?? 0) + 1;
    mrr += PLANS[plan as keyof typeof PLANS]?.price ?? 0;
  }

  const packsByShop: Record<string, number> = {};
  for (const p of packList) {
    packsByShop[p.shop_id] = (packsByShop[p.shop_id] ?? 0) + 1;
  }

  const perShop = shopList
    .filter((s) => !s.uninstalled_at)
    .map((s) => {
      const plan = s.plan ?? "free";
      const used = packsByShop[s.id] ?? 0;
      const limit = PLANS[plan as keyof typeof PLANS]?.packsPerMonth ?? 5;
      return { shop_id: s.id, domain: s.shop_domain, plan, used, limit };
    })
    .sort((a, b) => b.used - a.used)
    .slice(0, 50);

  return NextResponse.json({ mrr, distribution, perShop });
}
