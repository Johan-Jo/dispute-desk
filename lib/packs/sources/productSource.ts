/**
 * Product-listing evidence source (not-as-described plan PR 3).
 *
 * Runs ONLY when `PRODUCT_LISTING_EVIDENCE_ENABLED` is on AND the case is
 * argued as `product_not_as_described` (`ctx.caseFamily`, from the same
 * resolver the letter build uses). Otherwise it returns nothing and makes no
 * call — the flag-OFF build is byte-identical.
 *
 * On a `failed` outcome it enqueues exactly one retry per pack, ever:
 * dedupe key `collect-product:<pack_id>:retry1` is permanent across job
 * statuses, so that key existing IS the cap (plan §3 PR 3, Retry).
 */
import { getServiceClient } from "@/lib/supabase/server";
import { isProductListingEvidenceEnabled } from "@/lib/featureFlags";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { collectProductListings, type CollectResult } from "../productListing/collectProductListings";
import type { BuildContext, EvidenceSection } from "../types";

export const PRODUCT_LISTING_FAMILY = "product_not_as_described";
export const COLLECT_PRODUCT_JOB = "collect_product_evidence";

export function productRetryDedupeKey(packId: string): string {
  return `collect-product:${packId}:retry1`;
}

/** The pack section for a collect result — shared by the source and the
 *  retry job so both write the same shape. */
export function productListingSection(result: CollectResult): EvidenceSection | null {
  if (result.outcomes.length === 0) return null;
  return {
    type: "other",
    labelToken: { key: "packs.section.productListings", params: { count: result.listings.length } },
    source: "shopify_product",
    // Only a collected listing satisfies the checklist field.
    fieldsProvided: result.listings.length > 0 ? ["product_description"] : [],
    data: {
      listings: result.listings,
      outcomes: result.outcomes,
    },
  };
}

export async function collectProductEvidence(ctx: BuildContext): Promise<EvidenceSection[]> {
  if (!isProductListingEvidenceEnabled()) return [];
  if (ctx.caseFamily !== PRODUCT_LISTING_FAMILY) return [];
  if (!ctx.orderGid) return [];

  const sb = getServiceClient();
  const result = await collectProductListings(
    {
      shopId: ctx.shopId,
      disputeId: ctx.disputeId,
      orderGid: ctx.orderGid,
      shopDomain: ctx.shopDomain,
      accessToken: ctx.accessToken,
      correlationId: ctx.correlationId,
    },
    { sb },
  );

  if (result.anyFailed) {
    try {
      await enqueueJob(
        {
          shopId: ctx.shopId,
          jobType: COLLECT_PRODUCT_JOB,
          entityId: ctx.packId,
          dedupeKey: productRetryDedupeKey(ctx.packId),
        },
        { onDuplicate: "return" },
      );
    } catch (err) {
      console.warn(
        "[productSource] retry enqueue failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const section = productListingSection(result);
  return section ? [section] : [];
}
