/**
 * GET /api/cron/refresh-open-disputes
 *
 * Nightly delivery-refresh for OPEN disputes. Carrier delivery often
 * lands weeks after an order is created (e.g. a PostNord parcel delivered
 * after the dispute opened). Nothing else re-fetches an existing dispute's
 * order once its pack is built, so a late delivery never reached the case
 * — the merchant saw a stale "weak / not delivered" verdict.
 *
 * For each open, non-terminal dispute that has an order + a built pack:
 *   1. Re-ingest the live Shopify order (native-delivery query →
 *      `shopify_orders`) via `normalizeOrderIngest`.
 *   2. If the order's `delivery_status` moved (especially → "Delivered"),
 *      enqueue a `build_pack` so the pack rebuilds. The rebuild then flows
 *      through the strength engine (INR: confirmed delivery → Moderate),
 *      the improvement banner, and the case-strengthened email.
 *
 * Bounded + idempotent: re-ingest is a no-op when nothing changed, and we
 * only enqueue a build when delivery actually moved. Auth + env toggle via
 * `cronEnvGate`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { normalizeOrderIngest } from "@/lib/shopify/orderIngest";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dispute statuses still worth refreshing — evidence can still change the
 *  outcome. Terminal states (won/lost/accepted/closed) are excluded. */
const OPEN_STATUSES = ["needs_response", "new", "in_progress", "under_review"];

/** Cap per run so a single nightly invocation stays within the function
 *  budget. Oldest-refreshed first (see order-by) so coverage rotates. */
const MAX_PER_RUN = 200;

interface Summary {
  scanned: number;
  reingested: number;
  deliveryChanged: number;
  rebuildsEnqueued: number;
  errors: Array<{ disputeId: string; error: string }>;
}

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const summary: Summary = {
    scanned: 0,
    reingested: 0,
    deliveryChanged: 0,
    rebuildsEnqueued: 0,
    errors: [],
  };

  // Open disputes that have an order to refresh + a pack to rebuild.
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id, shop_id, order_gid, status")
    .in("status", OPEN_STATUSES)
    .not("order_gid", "is", null)
    .order("updated_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return NextResponse.json({ ...summary, error: error.message }, { status: 500 });
  }

  for (const d of disputes ?? []) {
    summary.scanned++;
    const orderGid = d.order_gid as string;
    const shopId = d.shop_id as string;
    try {
      // Pack for this dispute — nothing to rebuild without one.
      const { data: pack } = await sb
        .from("evidence_packs")
        .select("id")
        .eq("dispute_id", d.id)
        .maybeSingle();
      if (!pack?.id) continue;

      // Delivery status BEFORE re-ingest.
      const { data: beforeRow } = await sb
        .from("shopify_orders")
        .select("delivery_status")
        .eq("shop_id", shopId)
        .eq("shopify_order_id", orderGid)
        .maybeSingle();
      const before = (beforeRow?.delivery_status as string | null) ?? null;

      const res = await normalizeOrderIngest(shopId, orderGid, {
        correlationId: `refresh-open-disputes:${d.id}`,
      });
      if (res.status === "applied") summary.reingested++;

      // Delivery status AFTER.
      const { data: afterRow } = await sb
        .from("shopify_orders")
        .select("delivery_status")
        .eq("shop_id", shopId)
        .eq("shopify_order_id", orderGid)
        .maybeSingle();
      const after = (afterRow?.delivery_status as string | null) ?? null;

      if (after !== before) {
        summary.deliveryChanged++;
        await enqueueJob({
          shopId,
          jobType: "build_pack",
          entityId: pack.id,
          priority: 90,
        });
        summary.rebuildsEnqueued++;
        await logAuditEvent({
          shopId,
          disputeId: d.id,
          packId: pack.id,
          actorType: "system",
          eventType: "job_queued",
          eventPayload: {
            trigger: "refresh_open_disputes_delivery_changed",
            before,
            after,
          },
        });
      }
    } catch (e) {
      summary.errors.push({
        disputeId: d.id as string,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json(summary);
}
