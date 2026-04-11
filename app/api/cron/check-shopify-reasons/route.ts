/**
 * GET /api/cron/check-shopify-reasons
 *
 * Manual trigger for the Shopify dispute-reason enum drift check.
 * Not registered in vercel.json because the Hobby plan caps at 2
 * cron slots and both are in use by publish-content and autopilot-
 * generate. The scheduled run piggybacks on the publish-content cron
 * as fire-and-forget (see app/api/cron/publish-content/route.ts).
 *
 * This route stays for:
 *   1. Manual runs via CLI or uptime monitor hitting the URL with the
 *      shared CRON_SECRET
 *   2. Forcing a re-check after fixing a drift
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
