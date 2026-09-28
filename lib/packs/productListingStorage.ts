/**
 * Storage for product-listing evidence images (not-as-described plan PR 2).
 *
 * Layout: `evidence-packs/{shop_id}/product-listings/{dispute_id}/{file}`.
 * The rows live in `product_listing_snapshots`; this module only removes
 * objects — for retention (paths returned by the purge RPC) and for GDPR
 * shop redaction (the whole shop prefix).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PRODUCT_LISTING_BUCKET = "evidence-packs";

export function productListingPrefix(shopId: string): string {
  return `${shopId}/product-listings`;
}

/** Remove the given object paths, in batches the Storage API accepts. */
export async function removeProductListingObjects(
  sb: SupabaseClient,
  paths: readonly string[],
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { data, error } = await sb.storage.from(PRODUCT_LISTING_BUCKET).remove(batch);
    if (error) throw new Error(`product-listing storage remove failed: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/**
 * Every object under `{shopId}/product-listings/` — one folder per dispute,
 * files inside. The Storage API lists one level at a time.
 */
export async function listShopProductListingObjects(
  sb: SupabaseClient,
  shopId: string,
): Promise<string[]> {
  const bucket = sb.storage.from(PRODUCT_LISTING_BUCKET);
  const root = productListingPrefix(shopId);
  const paths: string[] = [];
  const { data: folders, error } = await bucket.list(root, { limit: 1000 });
  if (error) throw new Error(`product-listing storage list failed: ${error.message}`);
  for (const entry of folders ?? []) {
    // A folder has no id; a file directly under the root has one.
    if (entry.id) {
      paths.push(`${root}/${entry.name}`);
      continue;
    }
    const { data: files, error: e2 } = await bucket.list(`${root}/${entry.name}`, { limit: 1000 });
    if (e2) throw new Error(`product-listing storage list failed: ${e2.message}`);
    for (const f of files ?? []) if (f.id) paths.push(`${root}/${entry.name}/${f.name}`);
  }
  return paths;
}

/** GDPR shop redaction: remove every product-listing image of the shop. */
export async function removeShopProductListings(
  sb: SupabaseClient,
  shopId: string,
): Promise<number> {
  const paths = await listShopProductListingObjects(sb, shopId);
  return paths.length ? removeProductListingObjects(sb, paths) : 0;
}
