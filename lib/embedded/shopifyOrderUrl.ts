/** Build Shopify Admin order URL for embedded dashboard / disputes list links. */
export function shopifyOrderAdminUrl(
  shopDomain: string | null | undefined,
  orderGid: string | null | undefined
): string | null {
  if (!shopDomain || !orderGid) return null;
  const numericId = orderGid.split("/").pop();
  if (!numericId) return null;
  return `https://${shopDomain}/admin/orders/${numericId}`;
}
