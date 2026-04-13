import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { computeDisputeMetrics } from "@/lib/disputes/metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();

  // Period for dispute metrics
  const period = req.nextUrl.searchParams.get("period") ?? "30d";
  const periodMs =
    period === "24h" ? 86400000
    : period === "7d" ? 604800000
    : period === "30d" ? 2592000000
    : 0;
  const periodFrom = periodMs > 0
    ? new Date(Date.now() - periodMs).toISOString()
    : undefined;

  const [shops, disputes, packs, jobs, templateRows, mappingRows] = await Promise.all([
    sb.from("shops").select("id, plan, uninstalled_at"),
    sb.from("disputes").select("id", { count: "exact", head: true }),
    sb.from("evidence_packs").select("id, status"),
    sb.from("jobs").select("id, status").in("status", ["queued", "running", "failed"]),
    sb.from("pack_templates").select("id, status"),
    sb.from("reason_template_mappings").select("id, template_id, dispute_phase"),
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

  // Template stats
  const tplList = templateRows.data ?? [];
  const tplByStatus: Record<string, number> = { active: 0, draft: 0, archived: 0 };
  for (const t of tplList) {
    const s = (t.status as string) ?? "active";
    tplByStatus[s] = (tplByStatus[s] ?? 0) + 1;
  }

  // Reason mapping stats
  const mList = mappingRows.data ?? [];
  const mappingStats = {
    total: mList.length,
    mapped: mList.filter((m) => m.template_id != null).length,
    unmapped: mList.filter((m) => m.template_id == null).length,
  };

  // Cross-shop dispute metrics (no shopId = admin view)
  const disputeMetrics = await computeDisputeMetrics({ periodFrom });

  return NextResponse.json({
    shops: { total: shopList.length, active, uninstalled },
    disputes: disputes.count ?? 0,
    packs: { total: packList.length, byStatus },
    jobs: jobCounts,
    plans,
    templates: { total: tplList.length, ...tplByStatus },
    reasonMappings: mappingStats,
    disputeMetrics,
  });
}
