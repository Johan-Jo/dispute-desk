import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { computeDisputeMetrics } from "@/lib/disputes/metrics";
import { fetchAllRows } from "@/lib/admin/fetchAllRows";
import { summarizeBilling, classifyBillingState, type EntitlementEvidence } from "@/lib/admin/paidSubscriptions";

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

  // Un-ranged selects truncate silently at 1000 rows (PostgREST) — page the
  // large tables, and count jobs by status instead of fetching every row.
  const jobCount = (status: string) =>
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("status", status);
  const [shopList, disputes, packRows, jq, jr, js, jf, templateRows, mappingRows, entitlements] = await Promise.all([
    fetchAllRows<{ id: string; shop_domain: string; primary_domain: string | null; plan: string | null; uninstalled_at: string | null }>(
      (from, to) => sb.from("shops").select("id, shop_domain, primary_domain, plan, uninstalled_at").order("id").range(from, to),
    ),
    sb.from("disputes").select("id", { count: "exact", head: true }),
    fetchAllRows<Record<string, unknown>>(
      (from, to) => sb.from("evidence_packs").select("id, status, completeness_score, blockers, dispute_type, saved_to_shopify_at").order("id").range(from, to),
    ),
    jobCount("queued"),
    jobCount("running"),
    jobCount("succeeded"),
    jobCount("failed"),
    sb.from("pack_templates").select("id, name, status"),
    sb.from("reason_template_mappings").select("id, template_id, dispute_phase, reason_code"),
    fetchAllRows<EntitlementEvidence>(
      (from, to) => sb.from("plan_entitlements").select("shop_id, plan_key, subscription_state, first_paid_cycle_started_at").order("shop_id").range(from, to),
    ),
  ]);

  const active = shopList.filter((s) => !s.uninstalled_at).length;
  const uninstalled = shopList.filter((s) => s.uninstalled_at).length;

  // Billing by payment evidence, not by the `shops.plan` label.
  const billing = summarizeBilling(shopList, entitlements);
  const entByShop = new Map(entitlements.map((e) => [e.shop_id, e]));
  const plans: Record<string, number> = {};
  for (const s of shopList) {
    if (s.uninstalled_at) continue;
    const st = classifyBillingState(s, entByShop.get(s.id));
    const label = st === "paid" ? (entByShop.get(s.id)?.plan_key ?? s.plan ?? "free") : st;
    plans[label] = (plans[label] ?? 0) + 1;
  }

  const packList = packRows;
  const byStatus: Record<string, number> = {};
  for (const p of packList) {
    const st = (p.status as string) ?? "unknown";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }

  const jobCounts = {
    queued: jq.count ?? 0,
    running: jr.count ?? 0,
    succeeded: js.count ?? 0,
    failed: jf.count ?? 0,
  };

  // Template stats
  const tplList = templateRows.data ?? [];
  const tplByStatus: Record<string, number> = { active: 0, draft: 0, archived: 0 };
  for (const t of tplList) {
    const s = (t.status as string) ?? "active";
    tplByStatus[s] = (tplByStatus[s] ?? 0) + 1;
  }

  // Reason mapping stats
  const mList = (mappingRows.data ?? []) as Record<string, unknown>[];
  const mappingStats = {
    total: mList.length,
    mapped: mList.filter((m) => m.template_id != null).length,
    unmapped: mList.filter((m) => m.template_id == null).length,
  };

  // Cross-shop dispute metrics (no shopId = admin view)
  const disputeMetrics = await computeDisputeMetrics({ periodFrom });

  // ── Platform health metrics ───────────────────────────────────────────

  // Automation success rate: packs that reached ready/saved vs total built
  const builtStatuses = ["ready", "saved_to_shopify", "blocked", "failed"];
  const totalBuilt = packList.filter((p) => builtStatuses.includes(p.status as string)).length;
  const successBuilt = packList.filter((p) => p.status === "ready" || p.status === "saved_to_shopify").length;
  const automationSuccessRate = totalBuilt > 0 ? Math.round((successBuilt / totalBuilt) * 100) : 0;

  // Save-to-Shopify success rate
  const savedCount = packList.filter((p) => p.saved_to_shopify_at != null).length;
  const saveAttempts = packList.filter((p) => ["saved_to_shopify", "ready", "failed"].includes(p.status as string)).length;
  const saveSuccessRate = saveAttempts > 0 ? Math.round((savedCount / saveAttempts) * 100) : 0;

  // Manual intervention rate
  const manualCount = disputeMetrics.needsAttentionCount + (disputeMetrics.overriddenCount ?? 0);
  const totalActive = disputeMetrics.activeDisputes || 1;
  const manualInterventionRate = Math.round((manualCount / totalActive) * 100);

  // Submission uncertainty rate
  const { count: submissionUncertainCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("submission_state", "submission_uncertain")
    .is("closed_at", null);
  const uncertainRate = totalActive > 0
    ? Math.round(((submissionUncertainCount ?? 0) / totalActive) * 100)
    : 0;

  // Top blocked evidence (most common blockers across packs)
  const blockerCounts: Record<string, number> = {};
  for (const p of packList) {
    const bl = p.blockers as string[] | null;
    if (bl && Array.isArray(bl)) {
      for (const b of bl) {
        blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
      }
    }
  }
  const topBlockers = Object.entries(blockerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([blocker, count]) => ({ blocker, count }));

  // Top failing dispute types (packs with status=failed or blocked, grouped by dispute_type)
  const failingTypes: Record<string, number> = {};
  for (const p of packList) {
    if (p.status === "failed" || p.status === "blocked") {
      const dt = (p.dispute_type as string) ?? "unknown";
      failingTypes[dt] = (failingTypes[dt] ?? 0) + 1;
    }
  }
  const topFailingTypes = Object.entries(failingTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([disputeType, count]) => ({ disputeType, count }));

  // Weak reason mappings (unmapped with dispute volume)
  const unmappedReasons = mList
    .filter((m) => m.template_id == null)
    .map((m) => (m.reason_code as string) ?? "unknown");

  // Stale open disputes
  const staleThreshold = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count: staleCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .is("closed_at", null)
    .lt("last_event_at", staleThreshold);

  // ── Ops/exceptions data (for /admin/operations) ───────────────────────

  // Shop domain map
  const shopDomainMap: Record<string, string> = {};
  const shopPrimaryMap: Record<string, string | null> = {};
  for (const s of shopList) {
    shopDomainMap[s.id] = s.shop_domain ?? s.id.slice(0, 8);
    shopPrimaryMap[s.id] = s.primary_domain ?? null;
  }

  // Shops needing intervention
  const problemRows = await fetchAllRows<Record<string, unknown>>(
    (from, to) => sb
      .from("disputes")
      .select("id, shop_id, needs_attention, sync_health, has_admin_override, submission_state, last_event_at, closed_at")
      .is("closed_at", null)
      .order("id")
      .range(from, to),
  );

  const shopProblems: Record<string, { attention: number; syncFail: number; overridden: number; stale: number; uncertain: number }> = {};
  for (const d of problemRows) {
    const sid = d.shop_id as string;
    if (!shopProblems[sid]) shopProblems[sid] = { attention: 0, syncFail: 0, overridden: 0, stale: 0, uncertain: 0 };
    if (d.needs_attention) shopProblems[sid].attention++;
    if (d.sync_health !== "ok") shopProblems[sid].syncFail++;
    if (d.has_admin_override) shopProblems[sid].overridden++;
    if (d.submission_state === "submission_uncertain") shopProblems[sid].uncertain++;
    if (d.last_event_at && (d.last_event_at as string) < staleThreshold) shopProblems[sid].stale++;
  }

  const shopLeaderboard = Object.entries(shopProblems)
    .map(([shopId, counts]) => ({
      shopId,
      domain: shopDomainMap[shopId] ?? shopId.slice(0, 8),
      primaryDomain: shopPrimaryMap[shopId] ?? null,
      ...counts,
      total: counts.attention + counts.syncFail + counts.overridden + counts.stale + counts.uncertain,
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Recent ops events
  const { data: opsEvents } = await sb
    .from("dispute_events")
    .select("id, dispute_id, shop_id, event_type, description, event_at, actor_type, actor_ref, visibility")
    .in("event_type", [
      "sync_failed", "pack_build_failed", "evidence_save_failed",
      "admin_override", "admin_override_cleared", "support_note_added",
      "dispute_resynced", "outcome_detected", "submission_confirmed",
    ])
    .order("event_at", { ascending: false })
    .limit(15);

  const opsDisputeIds = [...new Set((opsEvents ?? []).map((e) => (e as Record<string, unknown>).dispute_id as string))];
  const opsDisputeNames: Record<string, string> = {};
  if (opsDisputeIds.length > 0) {
    const { data: nameRows } = await sb
      .from("disputes")
      .select("id, order_name")
      .in("id", opsDisputeIds);
    for (const r of (nameRows ?? []) as Record<string, unknown>[]) {
      opsDisputeNames[r.id as string] = (r.order_name as string) ?? (r.id as string).slice(0, 8).toUpperCase();
    }
  }

  const recentOpsActivity = (opsEvents ?? []).map((e) => {
    const row = e as Record<string, unknown>;
    const eventType = row.event_type as string;
    const isError = eventType.includes("failed");
    const isAdmin = eventType.startsWith("admin_") || eventType === "support_note_added" || eventType === "dispute_resynced";
    return {
      id: row.id,
      disputeId: row.dispute_id,
      shopId: row.shop_id,
      shopDomain: shopDomainMap[row.shop_id as string] ?? (row.shop_id as string)?.slice(0, 8),
      orderName: opsDisputeNames[row.dispute_id as string] ?? (row.dispute_id as string)?.slice(0, 8).toUpperCase(),
      eventType,
      description: row.description,
      eventAt: row.event_at,
      actorType: row.actor_type,
      actorRef: row.actor_ref,
      severity: isError ? "error" : isAdmin ? "info" : "success",
    };
  });

  return NextResponse.json({
    shops: { total: shopList.length, active, uninstalled },
    disputes: disputes.count ?? 0,
    packs: { total: packList.length, byStatus },
    jobs: jobCounts,
    plans,
    billing,
    templates: { total: tplList.length, ...tplByStatus },
    reasonMappings: mappingStats,
    disputeMetrics,
    // Platform health
    automationSuccessRate,
    saveSuccessRate,
    manualInterventionRate,
    submissionUncertainCount: submissionUncertainCount ?? 0,
    uncertainRate,
    staleCount: staleCount ?? 0,
    topBlockers,
    topFailingTypes,
    unmappedReasons,
    // Ops/exceptions
    shopLeaderboard,
    recentOpsActivity,
  });
}
