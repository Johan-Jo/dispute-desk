/**
 * `collect_product_evidence` — the ONE retry of a failed product-listing
 * collection (not-as-described plan PR 3). `entity_id` = pack id.
 *
 * Re-runs only the product query + snapshot insert; it never calls the
 * source's enqueue path, so it cannot schedule another retry. On success, if
 * no final/submitted defence package exists and no save is pending, it
 * enqueues a normal pack rebuild, which picks the snapshot up. A rebuild of
 * an existing pack consumes no pack credit (`consumePack` is idempotent per
 * dispute). A second failure is final.
 */
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob, type ClaimedJob, type JobResult } from "../claimJobs";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { collectProductListings } from "@/lib/packs/productListing/collectProductListings";
import { isProductListingEvidenceEnabled } from "@/lib/featureFlags";

export async function handleCollectProductEvidence(job: ClaimedJob): Promise<JobResult> {
  if (!isProductListingEvidenceEnabled()) return { ok: true };
  const packId = job.entityId;
  if (!packId) return { ok: false, retriable: false, reason: "missing entity_id" };
  const sb = getServiceClient();

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id")
    .eq("id", packId)
    .maybeSingle();
  if (!pack) return { ok: false, retriable: false, reason: "pack not found" };
  const { data: dispute } = await sb
    .from("disputes")
    .select("id, order_gid, closed_at")
    .eq("id", pack.dispute_id)
    .maybeSingle();
  if (!dispute?.order_gid || dispute.closed_at) return { ok: true };

  const session = await getShopBackgroundSession(pack.shop_id as string);
  const result = await collectProductListings(
    {
      shopId: pack.shop_id as string,
      disputeId: dispute.id as string,
      orderGid: dispute.order_gid as string,
      shopDomain: session.shopDomain,
      accessToken: session.accessToken,
      correlationId: `collect-product-${job.id}`,
    },
    { sb },
  );
  if (result.anyFailed) {
    return { ok: false, retriable: false, reason: "product listing collection failed again (retry exhausted)" };
  }

  const [{ data: filed }, { data: saving }] = await Promise.all([
    sb
      .from("defence_packages")
      .select("id")
      .eq("dispute_id", dispute.id)
      .in("status", ["final", "submitted"])
      .limit(1),
    sb
      .from("jobs")
      .select("id")
      .eq("job_type", "save_to_shopify")
      .eq("entity_id", packId)
      .in("status", ["queued", "running"])
      .limit(1),
  ]);
  if ((filed ?? []).length > 0 || (saving ?? []).length > 0) return { ok: true };

  await enqueueJob({ shopId: pack.shop_id as string, jobType: "build_pack", entityId: packId });
  return { ok: true };
}
