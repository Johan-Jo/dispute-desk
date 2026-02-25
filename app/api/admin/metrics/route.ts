import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const sb = getServiceClient();

  const [shops, disputes, packs, jobs] = await Promise.all([
    sb.from("shops").select("id, plan, uninstalled_at"),
    sb.from("disputes").select("id", { count: "exact", head: true }),
    sb.from("evidence_packs").select("id, status"),
    sb.from("jobs").select("id, status").in("status", ["queued", "running", "failed"]),
  ]);

  const shopList = shops.data ?? [];
  const active = shopList.filter((s) => !s.uninstalled_at).length;
  const uninstalled = shopList.filter((s) => s.uninstalled_at).length;

  const plans: Record<string, number> = {};
  for (const s of shopList) {
    plans[s.plan ?? "free"] = (plans[s.plan ?? "free"] ?? 0) + 1;
  }

  const packList = packs.data ?? [];
  const byStatus: Record<string, number> = {};
  for (const p of packList) {
    byStatus[p.status ?? "unknown"] = (byStatus[p.status ?? "unknown"] ?? 0) + 1;
  }

  const jobList = jobs.data ?? [];
  const jobCounts = { queued: 0, running: 0, failed: 0 };
  for (const j of jobList) {
    if (j.status in jobCounts) jobCounts[j.status as keyof typeof jobCounts]++;
  }

  return NextResponse.json({
    shops: { total: shopList.length, active, uninstalled },
    disputes: disputes.count ?? 0,
    packs: { total: packList.length, byStatus },
    jobs: jobCounts,
    plans,
  });
}
