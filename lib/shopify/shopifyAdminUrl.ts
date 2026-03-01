/**
 * Build the Shopify Admin URL for a specific dispute.
 * Uses store handle (from shop_domain) and numeric dispute id from GID.
 */
export function getShopifyDisputeUrl(shopDomain: string, disputeGid: string): string {
  const handle = shopDomain.replace(/\.myshopify\.com$/i, "").trim() || shopDomain;
  const disputeId = disputeGid.split("/").pop() ?? "";
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/payments/disputes/${encodeURIComponent(disputeId)}`;
}
