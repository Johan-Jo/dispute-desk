/**
 * Build the Shopify Admin URL for a dispute's evidence page.
 * Pattern: https://{shop_domain}/admin/payments/dispute_evidences/{evidence_id}
 *
 * Uses dispute_evidence_gid (ShopifyPaymentsDisputeEvidence), NOT dispute_gid.
 */
export function getShopifyDisputeUrl(
  shopDomain: string,
  _disputeGid: string,
  disputeEvidenceGid?: string | null,
): string {
  const domain = shopDomain.endsWith(".myshopify.com")
    ? shopDomain
    : `${shopDomain}.myshopify.com`;
  const evidenceId = disputeEvidenceGid?.split("/").pop() ?? _disputeGid.split("/").pop() ?? "";
  return `https://${domain}/admin/payments/dispute_evidences/${encodeURIComponent(evidenceId)}`;
}
