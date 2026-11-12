import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface AdminNotificationItem {
  key: "needs_attention" | "sync_issues" | "uncertain_submissions" | "failed_jobs";
  label: string;
  count: number;
  href: string;
}

/**
 * GET /api/admin/notifications — what the top-bar bell shows.
 *
 * Exact head-count queries over the same signals the Operations queue uses, so
 * the bell and that page cannot disagree. Open disputes only (`closed_at is
 * null`). No rows are fetched, so the 1000-row cap is irrelevant here.
 */
export async function GET() {
  const sb = getServiceClient();
  const openDisputes = () =>
    sb.from("disputes").select("id", { count: "exact", head: true }).is("closed_at", null);

  const [attention, sync, uncertain, failedJobs] = await Promise.all([
    openDisputes().eq("needs_attention", true),
    openDisputes().neq("sync_health", "ok"),
    openDisputes().eq("submission_state", "submission_uncertain"),
    sb.from("jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const failed = [attention, sync, uncertain, failedJobs].find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  const all: AdminNotificationItem[] = [
    { key: "needs_attention", label: "Disputes need attention", count: attention.count ?? 0, href: "/admin/operations" },
    { key: "sync_issues", label: "Disputes with sync issues", count: sync.count ?? 0, href: "/admin/operations" },
    { key: "uncertain_submissions", label: "Uncertain submissions", count: uncertain.count ?? 0, href: "/admin/operations" },
    { key: "failed_jobs", label: "Failed jobs", count: failedJobs.count ?? 0, href: "/admin/jobs" },
  ];
  const items = all.filter((i) => i.count > 0);
  return NextResponse.json({ total: items.reduce((n, i) => n + i.count, 0), items });
}
