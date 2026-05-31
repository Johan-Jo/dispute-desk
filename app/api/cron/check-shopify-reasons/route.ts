/**
 * GET /api/cron/check-shopify-reasons
 *
 * Called by Vercel Cron daily at 10:00 UTC. Runs two independent
 * Shopify drift checks back-to-back:
 *
 *   1. `checkShopifyReasonEnumDrift` — compares the live
 *      ShopifyPaymentsDisputeReason enum against ALL_DISPUTE_REASONS.
 *   2. `checkShopifyQueryFieldDrift` — dry-runs every production
 *      GraphQL query and inspects `errors[]` for `undefinedField`
 *      responses (catches `Order.cartToken`-style schema removals).
 *
 * Each check writes its own audit-event type and emails on state
 * change only — clean runs and already-alerted drifts are silent.
 *
 * Also available for manual runs via CLI or uptime monitor hitting
 * the URL with the shared CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkShopifyReasonEnumDrift } from "@/lib/shopify/checkReasonEnumDrift";
import { checkShopifyQueryFieldDrift } from "@/lib/shopify/checkQueryFieldDrift";
import { cronEnvGate } from "@/lib/cron/envGate";

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  // Run independently — a failure in one must not mask the other.
  const enumResult = await checkShopifyReasonEnumDrift();
  const fieldResult = await checkShopifyQueryFieldDrift();

  const combined = { enum: enumResult, queryField: fieldResult };
  const anyFailed = !enumResult.ok || !fieldResult.ok;

  return NextResponse.json(combined, { status: anyFailed ? 500 : 200 });
}
