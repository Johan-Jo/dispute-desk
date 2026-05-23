import { isDemoMode } from "@/lib/demo/isDemoMode";

/** Build Shopify Admin order URL for embedded dashboard / disputes list links. */
export function shopifyOrderAdminUrl(
  shopDomain: string | null | undefined,
  orderGid: string | null | undefined
): string | null {
  // Demo mode: demo orders don't exist on the real Shopify store, so any
  // top-frame navigation to admin.shopify.com would 404 / "no permission".
  // Return null so callers fall back to plain-text order numbers.
  // `isDemoMode()` is SSR-safe (returns false when window is undefined).
  if (isDemoMode()) return null;
  if (!shopDomain || !orderGid) return null;
  const numericId = orderGid.split("/").pop();
  if (!numericId) return null;
  return `https://${shopDomain}/admin/orders/${numericId}`;
}
