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
  const handle = storeHandle(shopDomain);
  if (!handle) return null;
  return `https://admin.shopify.com/store/${handle}/payments/dispute_evidences/${encodeURIComponent(evidenceId)}`;
}

/**
 * `blume-box.myshopify.com` → `blume-box`. Tolerates a scheme and a path.
 *
 * ORDER MATTERS. The original inline version stripped the scheme, then
 * `.myshopify.com$`, then the path — but the `$` anchor cannot match while a
 * path is still attached, so `https://shop.myshopify.com/admin` yielded the
 * handle `shop.myshopify.com` and a URL with the domain embedded twice. The
 * path is removed FIRST, which is why this is one shared helper rather than
 * two copies that drift.
 */
function storeHandle(shopDomain: string | null | undefined): string | null {
  if (!shopDomain) return null;
  const handle = shopDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/, "");
  return handle || null;
}

/**
 * The Shopify Admin URL for the ORDER a dispute was filed against.
 *
 *   https://admin.shopify.com/store/{handle}/orders/{order_numeric_id}
 *
 * WHY THIS EXISTS. The dispute detail header rendered
 * `dispute.id.slice(0, 8).toUpperCase()` — the first eight characters of our
 * internal UUID — as "Dispute #E8E0E4FC". That string appears nowhere in
 * Shopify, nowhere on the order, and is searchable nowhere; it also LOOKS
 * like an order number (same `#` prefix, similar length), so it invites a
 * lookup that cannot succeed. A merchant checking why several orders showed
 * no shipment could not get from the dispute back to the order.
 *
 * Takes the order GID (`gid://shopify/Order/7429154701505`) and returns null
 * when it is absent or malformed, so callers render plain text rather than a
 * dead link.
 */
export function getShopifyOrderUrl(
  shopDomain: string | null | undefined,
  orderGid: string | null | undefined,
): string | null {
  const orderId = orderGid?.split("/").pop();
  // A GID whose last segment is not numeric is not an order id — linking it
  // would produce a 404 that looks like a missing order.
  if (!orderId || !/^\d+$/.test(orderId)) return null;
  const handle = storeHandle(shopDomain);
  if (!handle) return null;
  return `https://admin.shopify.com/store/${handle}/orders/${orderId}`;
}
