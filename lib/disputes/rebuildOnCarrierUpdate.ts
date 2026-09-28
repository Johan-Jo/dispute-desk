/**
 * Rebuild the case for every open dispute on an order whose shipment just
 * changed — the real-time path behind the fulfillment webhooks
 * (`fulfillment_events/create`, `fulfillments/update`).
 *
 * Before this, a carrier update reached a case only through the nightly
 * `refresh-open-disputes` cron (02:30 UTC), and only when the order's
 * best-of `delivery_status` moved — so on a two-parcel order whose other
 * parcel was already further along, a delivery never triggered a rebuild at
 * all (blume-box #360980, 2026-09-24). A fulfillment event is itself the
 * change, so the webhook rebuilds on every event for a disputed order; the
 * rebuild is cheap when nothing material moved (the defence package's input
 * hash matches and the letter is not regenerated).
 *
 * The cron stays as the safety net for missed deliveries.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { normalizeOrderIngest } from "@/lib/shopify/orderIngest";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { logAuditEvent } from "@/lib/audit/logEvent";

/** Dispute statuses still worth refreshing — evidence can still change the
 *  outcome. Terminal states (won/lost/accepted/closed) are excluded. */
export const OPEN_DISPUTE_STATUSES = ["needs_response", "new", "in_progress", "under_review"];

/** Same priority the nightly refresh uses for its rebuilds. */
const REBUILD_PRIORITY = 90;

export interface OpenDisputeRef {
  id: string;
  packId: string;
}

/** Open disputes on this order that have a pack to rebuild. */
export async function openDisputesForOrder(
  shopId: string,
  orderGid: string,
): Promise<OpenDisputeRef[]> {
  const sb = getServiceClient();
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id")
    .eq("shop_id", shopId)
    .eq("order_gid", orderGid)
    .in("status", OPEN_DISPUTE_STATUSES);
  if (error) throw new Error(`open disputes lookup failed: ${error.message}`);
  const out: OpenDisputeRef[] = [];
  for (const d of disputes ?? []) {
    const { data: pack } = await sb
      .from("evidence_packs")
      .select("id")
      .eq("dispute_id", d.id)
      .maybeSingle();
    if (pack?.id) out.push({ id: d.id as string, packId: pack.id as string });
  }
  return out;
}

export interface CarrierUpdateResult {
  reingested: boolean;
  rebuildsEnqueued: number;
  alreadyQueued: number;
}

/**
 * Re-read the order from Shopify, then queue a pack rebuild for each open
 * dispute — unless one is already waiting (a burst of carrier events must
 * not stack rebuilds).
 */
export async function rebuildOpenDisputesOnCarrierUpdate(params: {
  shopId: string;
  orderGid: string;
  disputes: readonly OpenDisputeRef[];
  trigger: string;
  correlationId: string;
  eventStatus?: string | null;
}): Promise<CarrierUpdateResult> {
  const { shopId, orderGid, disputes, trigger, correlationId } = params;
  const sb = getServiceClient();
  const result: CarrierUpdateResult = { reingested: false, rebuildsEnqueued: 0, alreadyQueued: 0 };
  if (disputes.length === 0) return result;

  // Keep shopify_orders current (delivery_status, delivered_at_tracking) —
  // the strength engine reads it. Non-fatal: the rebuild re-reads the live
  // fulfillments itself.
  try {
    const res = await normalizeOrderIngest(shopId, orderGid, { correlationId });
    result.reingested = res.status === "applied";
  } catch (err) {
    console.warn(
      `[rebuildOnCarrierUpdate] re-ingest failed for ${orderGid}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  for (const d of disputes) {
    const { data: queued } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shopId)
      .eq("job_type", "build_pack")
      .eq("entity_id", d.packId)
      .eq("status", "queued")
      .limit(1);
    if (queued && queued.length > 0) {
      result.alreadyQueued++;
      continue;
    }
    await enqueueJob({
      shopId,
      jobType: "build_pack",
      entityId: d.packId,
      priority: REBUILD_PRIORITY,
    });
    result.rebuildsEnqueued++;
    await logAuditEvent({
      shopId,
      disputeId: d.id,
      packId: d.packId,
      actorType: "system",
      eventType: "job_queued",
      eventPayload: { trigger, event_status: params.eventStatus ?? null },
    });
  }
  return result;
}
