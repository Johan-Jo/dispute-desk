import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";

export const runtime = "nodejs";

/** Rows kept. Page views are behavioural telemetry, not an audit record. */
const RETENTION_DAYS = 90;

/**
 * Delete ceiling per run. At current volume (tens of rows a day platform-wide)
 * one batch clears everything many times over; the cap exists so the job stays
 * bounded if the table ever grows with the customer base, rather than issuing
 * one unbounded DELETE against the biggest table in the database.
 */
const BATCH_LIMIT = 5000;

/**
 * GET /api/cron/cleanup-page-views
 *
 * Daily Vercel Cron task. Deletes `shop_page_views` rows older than 90 days.
 *
 * Page views record what merchants (and we, under View-as-merchant) looked at
 * in the embedded app. Unlike `audit_events` — which is immutable and kept
 * indefinitely because it is the compliance record of ACTIONS — these are
 * navigation records with a retention policy, which is precisely why they live
 * in their own table rather than as an event type on the audit log.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Select-then-delete rather than a bare filtered DELETE: PostgREST has no
  // LIMIT on delete, and the point of the cap is to keep one run bounded.
  const { data: doomed, error: selectError } = await sb
    .from("shop_page_views")
    .select("id")
    .lt("viewed_at", cutoff.toISOString())
    .limit(BATCH_LIMIT);

  if (selectError) {
    return NextResponse.json(
      { error: "cleanup_failed", message: selectError.message },
      { status: 500 },
    );
  }

  if (!doomed || doomed.length === 0) {
    return NextResponse.json({
      deleted: 0,
      cutoff: cutoff.toISOString(),
      more: false,
    });
  }

  const { error: deleteError } = await sb
    .from("shop_page_views")
    .delete()
    .in(
      "id",
      doomed.map((r) => r.id),
    );

  if (deleteError) {
    return NextResponse.json(
      { error: "cleanup_failed", message: deleteError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    deleted: doomed.length,
    cutoff: cutoff.toISOString(),
    // True when the batch cap was hit — the next daily run picks up the rest.
    more: doomed.length === BATCH_LIMIT,
  });
}
