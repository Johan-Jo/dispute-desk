/**
 * Build the Shopify Admin URL for a specific dispute (chargeback).
 * Pattern: https://{shop_domain}/admin/settings/payments/shopify-payments/chargebacks/{id}
 */
export function getShopifyDisputeUrl(shopDomain: string, disputeGid: string): string {
  const domain = shopDomain.endsWith(".myshopify.com")
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
  const disputeId = disputeGid.split("/").pop() ?? "";
  return `https://${domain}/admin/settings/payments/shopify-payments/chargebacks/${encodeURIComponent(disputeId)}`;
}
