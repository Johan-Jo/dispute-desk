/**
 * Product-listing evidence collection (not-as-described plan PR 3).
 *
 * For each line item of the disputed order: fetch the product's CURRENT
 * listing from Shopify, store up to three images in `evidence-packs`, and
 * write an immutable snapshot row (`product_listing_snapshots`). Returns one
 * outcome per line item and the listings the pack cites.
 *
 * Never throws: every failure becomes an outcome, so the pack still builds
 * (plan §2 principle 3). The listing is captioned "as published in the store,
 * retrieved {date}" downstream — never as what the customer saw (C2).
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestShopifyGraphQL, type GraphQLResponse } from "@/lib/shopify/graphql";
import {
  PRODUCT_EVIDENCE_QUERY,
  type ProductEvidenceLineItem,
  type ProductEvidenceResult,
} from "@/lib/shopify/queries/productEvidence";
import { PRODUCT_LISTING_BUCKET, productListingPrefix } from "@/lib/packs/productListingStorage";

export type ListingOutcome =
  | "present"
  | "absent"
  | "inaccessible"
  | "failed"
  | "custom_item"
  | "deleted";

/** One cited listing, as it rides in the evidence item's payload. The full
 *  content lives in the snapshot row; this carries the reference (id + hash)
 *  and the short copy the letter and PDF quote. */
export interface ListingInstance {
  snapshotId: string;
  lineItemGid: string;
  contentHash: string;
  productGid: string | null;
  title: string | null;
  variantTitle: string | null;
  variantOptions: Array<{ name: string; value: string }>;
  /** First ≤ 600 characters of the plain-text description. */
  excerpt: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  imagePaths: string[];
  /** The line item's original total — orders listings, highest first, so
   *  the evidence model's representative is deterministic. */
  lineTotal: number | null;
}

export interface CollectResult {
  outcomes: Array<{ lineItemGid: string | null; outcome: ListingOutcome }>;
  listings: ListingInstance[];
  /** True when any line item ended `failed` — the only retriable outcome. */
  anyFailed: boolean;
}

export const LISTING_LIMITS = {
  imagesPerLineItem: 3,
  imageMaxBytes: 1_000_000,
  excerptChars: 600,
  pages: 2,
  timeoutMs: 8_000,
} as const;

export interface CollectDeps {
  sb: SupabaseClient;
  query?: typeof requestShopifyGraphQL;
  fetchImage?: (url: string) => Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  now?: () => Date;
}

export interface CollectArgs {
  shopId: string;
  disputeId: string;
  orderGid: string;
  shopDomain: string;
  accessToken: string;
  correlationId?: string;
}

const sha256 = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function defaultFetchImage(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(LISTING_LIMITS.timeoutMs) });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > LISTING_LIMITS.imageMaxBytes) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > LISTING_LIMITS.imageMaxBytes) return null;
  return { bytes, contentType: res.headers.get("content-type") };
}

/** Classify a GraphQL error envelope: missing scope vs anything else. */
function isAccessDenied(errors: unknown): boolean {
  const s = JSON.stringify(errors ?? "");
  return /ACCESS_DENIED|access denied|read_products/i.test(s);
}

function outcomeFor(li: ProductEvidenceLineItem): ListingOutcome {
  if (!li.product && !li.variant) return "custom_item";
  if (!li.product) return "deleted";
  const hasText = !!(li.product.title || li.product.description);
  return hasText ? "present" : "absent";
}

function imageUrls(li: ProductEvidenceLineItem): string[] {
  const urls: string[] = [];
  if (li.variant?.image?.url) urls.push(li.variant.image.url);
  for (const m of li.product?.media?.nodes ?? []) {
    if (m.image?.url && !urls.includes(m.image.url)) urls.push(m.image.url);
  }
  return urls.slice(0, LISTING_LIMITS.imagesPerLineItem);
}

export async function collectProductListings(
  args: CollectArgs,
  deps: CollectDeps,
): Promise<CollectResult> {
  const query = deps.query ?? requestShopifyGraphQL;
  const fetchImage = deps.fetchImage ?? defaultFetchImage;
  const now = deps.now ?? (() => new Date());

  // 1. The query — at most two pages (100 line items).
  const items: ProductEvidenceLineItem[] = [];
  let after: string | null = null;
  try {
    for (let page = 0; page < LISTING_LIMITS.pages; page++) {
      const res: GraphQLResponse<ProductEvidenceResult> = await query<ProductEvidenceResult>({
        session: { shopDomain: args.shopDomain, accessToken: args.accessToken },
        query: PRODUCT_EVIDENCE_QUERY,
        variables: { id: args.orderGid, after },
        correlationId: args.correlationId,
        timeoutMs: LISTING_LIMITS.timeoutMs,
        maxRetries: 0,
      });
      if (res.errors && res.errors.length > 0) {
        const outcome: ListingOutcome = isAccessDenied(res.errors) ? "inaccessible" : "failed";
        return { outcomes: [{ lineItemGid: null, outcome }], listings: [], anyFailed: outcome === "failed" };
      }
      const li: NonNullable<ProductEvidenceResult["order"]>["lineItems"] | undefined = res.data?.order?.lineItems;
      if (!li) break;
      items.push(...li.nodes);
      if (!li.pageInfo.hasNextPage) break;
      after = li.pageInfo.endCursor;
    }
  } catch {
    return { outcomes: [{ lineItemGid: null, outcome: "failed" }], listings: [], anyFailed: true };
  }

  const outcomes: CollectResult["outcomes"] = [];
  const listings: ListingInstance[] = [];
  let anyFailed = false;

  for (const li of items) {
    const outcome = outcomeFor(li);
    if (outcome !== "present" || !li.product) {
      outcomes.push({ lineItemGid: li.id, outcome });
      continue;
    }
    try {
      // 2. Images → storage, content-addressed (re-running writes the same path).
      const imagePaths: string[] = [];
      const imageHashes: string[] = [];
      for (const url of imageUrls(li)) {
        const img = await fetchImage(url).catch(() => null);
        if (!img) continue;
        const hash = sha256(img.bytes);
        const type = (img.contentType ?? "").split(";")[0].trim().toLowerCase();
        const path = `${productListingPrefix(args.shopId)}/${args.disputeId}/${hash}.${EXT[type] ?? "img"}`;
        const { error } = await deps.sb.storage
          .from(PRODUCT_LISTING_BUCKET)
          .upload(path, img.bytes, { contentType: type || "application/octet-stream", upsert: true });
        if (error) continue;
        imagePaths.push(path);
        imageHashes.push(hash);
      }

      // 3. The snapshot row — identical content is skipped by the unique key.
      const variantOptions = (li.variant?.selectedOptions ?? []).map((o) => ({ name: o.name, value: o.value }));
      const descriptionText = li.product.description ?? null;
      const contentHash = sha256(
        JSON.stringify({
          title: li.product.title ?? null,
          variantOptions,
          descriptionText,
          descriptionHtml: li.product.descriptionHtml ?? null,
          sourceUrl: li.product.onlineStoreUrl ?? null,
          images: [...imageHashes].sort(),
        }),
      );
      const fetchedAt = now().toISOString();
      const row = {
        shop_id: args.shopId,
        dispute_id: args.disputeId,
        order_gid: args.orderGid,
        line_item_gid: li.id,
        product_gid: li.product.id,
        variant_gid: li.variant?.id ?? null,
        fetched_at: fetchedAt,
        product_updated_at: li.product.updatedAt ?? null,
        source_url: li.product.onlineStoreUrl ?? null,
        title: li.product.title ?? null,
        variant_options: variantOptions,
        description_text: descriptionText,
        description_html: li.product.descriptionHtml ?? null,
        image_paths: imagePaths,
        content_hash: contentHash,
      };
      let snapshotId: string | null = null;
      let snapshotFetchedAt = fetchedAt;
      const ins = await deps.sb.from("product_listing_snapshots").insert(row).select("id").single();
      if (ins.data?.id) {
        snapshotId = ins.data.id as string;
      } else if (ins.error?.code === "23505") {
        const existing = await deps.sb
          .from("product_listing_snapshots")
          .select("id, fetched_at")
          .eq("dispute_id", args.disputeId)
          .eq("line_item_gid", li.id)
          .eq("content_hash", contentHash)
          .single();
        snapshotId = (existing.data?.id as string | undefined) ?? null;
        snapshotFetchedAt = (existing.data?.fetched_at as string | undefined) ?? fetchedAt;
      }
      if (!snapshotId) throw new Error(ins.error?.message ?? "snapshot insert returned no id");

      const total = Number(li.originalTotalSet?.shopMoney.amount);
      listings.push({
        snapshotId,
        lineItemGid: li.id,
        contentHash,
        productGid: li.product.id,
        title: li.product.title ?? null,
        variantTitle: li.variant?.title ?? null,
        variantOptions,
        excerpt: descriptionText ? descriptionText.slice(0, LISTING_LIMITS.excerptChars) : null,
        sourceUrl: li.product.onlineStoreUrl ?? null,
        fetchedAt: snapshotFetchedAt,
        imagePaths,
        lineTotal: Number.isFinite(total) ? total : null,
      });
      outcomes.push({ lineItemGid: li.id, outcome: "present" });
    } catch {
      anyFailed = true;
      outcomes.push({ lineItemGid: li.id, outcome: "failed" });
    }
  }

  // Highest-value line item first: the evidence model's representative.
  listings.sort((a, b) => (b.lineTotal ?? -1) - (a.lineTotal ?? -1) || a.lineItemGid.localeCompare(b.lineItemGid));
  return { outcomes, listings, anyFailed };
}
