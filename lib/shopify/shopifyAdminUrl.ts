/**
 * Build the Shopify Admin URL for a dispute's evidence page.
 *
 * Canonical pattern (what Shopify redirects to from the legacy shop-domain URL):
 *   https://admin.shopify.com/store/{handle}/payments/dispute_evidences/{evidence_numeric_id}
 *
 * The legacy `https://{shop_domain}/admin/payments/...` form still 303s to the
 * canonical URL for authenticated sessions but only when the correct ID is
 * used; passing the dispute_gid's numeric part (instead of the
 * dispute_evidence_gid's) produces a dead page. Always pass the evidence GID.
 *
 * When `disputeEvidenceGid` is absent (e.g. first sync before Shopify emits
 * the evidence record), returns null so callers can hide the CTA rather than
 * linking to a broken page.
 */
export function getShopifyDisputeUrl(
  shopDomain: string,
  disputeEvidenceGid: string | null | undefined,
): string | null {
  const evidenceId = disputeEvidenceGid?.split("/").pop();
  if (!evidenceId) return null;
  const handle = shopDomain
    .replace(/^https?:\/\//, "")
    .replace(/\.myshopify\.com$/, "")
    .replace(/\/.*$/, "");
  if (!handle) return null;
  return `https://admin.shopify.com/store/${handle}/payments/dispute_evidences/${encodeURIComponent(evidenceId)}`;
}
