/**
 * GET /api/cron/reconcile-billing-cycles
 *
 * Hourly cron — verifies Shopify subscription truth, catches missed
 * `app_subscriptions/update` webhooks, grants any missing
 * `monthly_included` credits for the current cycle, and transitions
 * lapsed shops to `expired`. Authoritative source per Phase 2 of
 * `docs/prd/billing-lifecycle-and-merchant-comms.md`.
 *
 * The job is intentionally called "reconciliation," not "renewal":
 * happy-path renewal is one of several outcomes (see
 * `ReconcileShopOutcome` in `lib/billing/reconcileBillingCycle.ts`).
 *
 * Auth: the shared `CRON_SECRET` query param / Authorization header
 * (same pattern as `check-shopify-reasons`).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  reconcileBillingCycleForShop,
  selectShopsToReconcile,
  type ReconcileShopOutcome,
} from "@/lib/billing/reconcileBillingCycle";

export const runtime = "nodejs";
// Vercel cron functions inherit the default 60s budget. The
// reconciler currently has one paying shop in production; even at
// a few dozen the hourly budget is comfortable. Bump explicitly if
// shop count crosses ~500.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!cronSecret || secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const shopIds = await selectShopsToReconcile();

  const results: Array<{ shopId: string; outcome: ReconcileShopOutcome }> = [];
  let creditsGranted = 0;
  let stateTransitions = 0;
  let errors = 0;

  for (const shopId of shopIds) {
    try {
      const outcome = await reconcileBillingCycleForShop({ shopId });
      results.push({ shopId, outcome });
      if (!outcome.ok) {
        errors++;
        continue;
      }
      if (outcome.action === "credits_granted") creditsGranted++;
      if (outcome.action === "state_transition") stateTransitions++;
    } catch (err) {
      errors++;
      results.push({
        shopId,
        outcome: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  return NextResponse.json(
    {
      ok: errors === 0,
      shopsConsidered: shopIds.length,
      creditsGranted,
      stateTransitions,
      errors,
      durationMs,
      results,
    },
    { status: errors === 0 ? 200 : 500 },
  );
}
