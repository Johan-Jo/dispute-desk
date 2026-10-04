import { NextRequest, NextResponse } from "next/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { ingestMetaLeads } from "@/lib/marketing/metaLeads/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/meta-leads-poll
 *
 * Every minute: pull new Meta Instant Form leads from the Graph API, store them in
 * `meta_leads`, alert the team, and (when META_LEADS_WELCOME_ENABLED=1) send the welcome email.
 * Idempotent — see lib/marketing/metaLeads/ingest.ts. A no-op until META_PAGE_ID and
 * META_PAGE_ACCESS_TOKEN are set.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  try {
    return NextResponse.json(await ingestMetaLeads());
  } catch (err) {
    console.error("[meta-leads-poll] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "poll failed" }, { status: 500 });
  }
}
