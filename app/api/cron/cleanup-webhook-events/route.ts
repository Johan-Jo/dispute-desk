import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";

/**
 * GET /api/cron/cleanup-webhook-events
 *
 * Daily Vercel Cron task. Deletes webhook_events rows older than 7 days.
 * The table is operational telemetry (delivery/processing health), not audit
 * data — keeping rows forever inflates the /admin/webhooks query plan and
 * masks recent error trends.
 *
 * Effect-level audit history lives in audit_events (immutable) and is not
 * touched by this job.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const { count, error } = await sb
    .from("webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", cutoff.toISOString());

  if (error) {
    return NextResponse.json(
      { error: "cleanup_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    deleted: count ?? 0,
    cutoff: cutoff.toISOString(),
  });
}
