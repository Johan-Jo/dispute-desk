import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";

/**
 * GET /api/cron/retention-cleanup
 *
 * Called by Vercel Cron weekly. Archives evidence packs older than
 * the shop's retention period. Deletes associated PDFs from storage.
 * Audit events are never deleted (compliance requirement).
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;
  const sb = getServiceClient();

  const { data: shops } = await sb
    .from("shops")
    .select("id, retention_days")
    .not("uninstalled_at", "is", null);

  // Also include active shops — default retention is 365 days
  const { data: activeShops } = await sb
    .from("shops")
    .select("id, retention_days")
    .is("uninstalled_at", null);

  const allShops = [...(shops ?? []), ...(activeShops ?? [])];
  let archived = 0;
  let pdfsDeleted = 0;

  for (const shop of allShops) {
    const retentionDays = shop.retention_days ?? 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const { data: packs } = await sb
      .from("evidence_packs")
      .select("id, pdf_path")
      .eq("shop_id", shop.id)
      .lt("created_at", cutoff.toISOString())
      .neq("status", "archived");

    if (!packs?.length) continue;

    for (const pack of packs) {
      if (pack.pdf_path) {
        await sb.storage.from("evidence-pdfs").remove([pack.pdf_path]);
        pdfsDeleted++;
      }
    }

    const packIds = packs.map((p) => p.id);
    await sb
      .from("evidence_packs")
      .update({ status: "archived", pdf_path: null, updated_at: new Date().toISOString() })
      .in("id", packIds);

    archived += packIds.length;
  }

  // Prune terminal jobs older than 30 days. Job rows are operational telemetry,
  // not audit data — retaining them indefinitely inflates the failed/succeeded
  // counts and blocks the dashboard from showing recent health.
  const jobCutoff = new Date();
  jobCutoff.setDate(jobCutoff.getDate() - 30);
  const { count: jobsDeleted } = await sb
    .from("jobs")
    .delete({ count: "exact" })
    .in("status", ["succeeded", "failed"])
    .lt("created_at", jobCutoff.toISOString());

  return NextResponse.json({
    archived,
    pdfsDeleted,
    shopsProcessed: allShops.length,
    jobsDeleted: jobsDeleted ?? 0,
  });
}
