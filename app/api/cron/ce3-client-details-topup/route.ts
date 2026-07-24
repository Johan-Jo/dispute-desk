import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import {
  topUpClientDetailsForShop,
  type ClientDetailsTopUpResult,
} from "@/lib/fraudIntel/backfillClientDetails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/ce3-client-details-topup
 *
 * Weekly (Vercel Cron). Tops up `Order.client_details` (browser_ip +
 * user_agent) on recent orders for every shop, so new orders carry the
 * CE3.0 device element even though the live GraphQL ingest can't fetch it
 * (client_details is REST-only). Decorates existing risk-signal rows only.
 *
 * Full-history backfills use the one-shot operator script
 * scripts/backfill-order-client-details.mjs; this cron is the recurring
 * fortnight top-up (14-day window overlaps a weekly cadence so a missed
 * run self-heals).
 *
 * See docs/plans/tech-debt/ce3-fraud-compelling-evidence.plan.md for why
 * this is a cron and not an inline ingest REST call.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const { data: shops, error } = await sb.from("shops").select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: ClientDetailsTopUpResult[] = [];
  const totals = { scanned: 0, updated: 0, empty: 0, skipped: 0, noRow: 0, errors: 0 };

  // Sequential across shops to respect Shopify's per-shop rate bucket and
  // keep total load modest; each shop already paginates with backoff.
  for (const shop of shops ?? []) {
    const r = await topUpClientDetailsForShop(shop.id);
    results.push(r);
    totals.scanned += r.scanned;
    totals.updated += r.updated;
    totals.empty += r.empty;
    totals.skipped += r.skipped;
    totals.noRow += r.noRow;
    if (r.error) totals.errors++;
  }

  return NextResponse.json({
    ok: true,
    shops: results.length,
    totals,
    // Per-shop detail only for shops that errored, to keep the payload small.
    errored: results.filter((r) => r.error).map((r) => ({
      shopId: r.shopId,
      shopDomain: r.shopDomain,
      error: r.error,
    })),
  });
}
