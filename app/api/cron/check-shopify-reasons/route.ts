/**
 * GET /api/cron/check-shopify-reasons
 *
 * Called by Vercel Cron daily at 10:00 UTC. Checks for Shopify
 * dispute-reason enum drift. Also available for manual runs via
 * CLI or uptime monitor hitting the URL with the shared CRON_SECRET.
 *
 * Email only fires when the diff is new or changed since the last
 * audit_events row — a clean state or an already-alerted drift
 * returns a response but sends nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkShopifyReasonEnumDrift } from "@/lib/shopify/checkReasonEnumDrift";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!cronSecret || secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkShopifyReasonEnumDrift();

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
