import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { recommendPlan } from "@/lib/billing/recommendPlan";
import {
  gatherRecommendationInputs,
  upsertPlanRecommendation,
} from "@/lib/billing/persistRecommendation";

export const runtime = "nodejs";
// Bounded by the Free-shop pool; each shop is two small queries + an
// upsert. The cron only runs monthly.
export const maxDuration = 300;

/**
 * GET /api/cron/plan-recommendations
 *
 * Monthly recompute of the persisted plan recommendation for every Free
 * shop with a completed historical import. Keeps the dashboard
 * plan-recommendation banner current for merchants who never reopen the
 * Risk Intelligence page (the page-view path also upserts, but only when
 * the merchant actually visits).
 *
 * Paid shops are skipped — we don't nag a subscriber about a plan on
 * their own data. Dismissal state is preserved across recomputes by the
 * upsert (it never writes the dismissal columns); a recommendation that
 * escalates to a different tier naturally re-surfaces the banner.
 *
 * Schedule: 05:00 UTC on the 1st of each month (see vercel.json) — ahead
 * of the 09:00 monthly digest so the recommendation is fresh if the digest
 * ever links to it.
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const now = new Date();

  // Free shops only. `plan` is null for never-subscribed installs, which
  // coalesce to Free (see app/api/billing/checkQuota.ts), so match both.
  const { data: shops, error } = await sb
    .from("shops")
    .select("id, shop_domain, plan, historical_import_status")
    .eq("historical_import_status", "complete")
    .or("plan.is.null,plan.eq.free");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!shops?.length) {
    return NextResponse.json({ updated: 0, skipped: 0, total: 0 });
  }

  let updated = 0;
  let skipped = 0;
  const failures: Array<{ shop: string; reason: string }> = [];

  for (const shop of shops) {
    try {
      const inputs = await gatherRecommendationInputs(sb, shop.id, now);
      if (!inputs) {
        skipped++;
        continue;
      }
      const rec = recommendPlan(inputs);
      await upsertPlanRecommendation(sb, shop.id, rec, now);
      updated++;
    } catch (err) {
      failures.push({
        shop: shop.shop_domain,
        reason: err instanceof Error ? err.message : "unknown",
      });
      skipped++;
    }
  }

  return NextResponse.json({
    updated,
    skipped,
    total: shops.length,
    failures: failures.slice(0, 20),
  });
}
