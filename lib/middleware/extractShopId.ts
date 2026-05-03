/**
 * Shop-identity resolution helper (Phase 2.1).
 *
 * Centralizes the most common shop-id lookup pattern across `app/api/**`:
 *
 *   ?shop_id=…  ▸  x-shop-id header
 *
 * Returns the first non-empty value or `null`. NEVER throws. NEVER
 * normalizes the value (callers may compare against UUIDs, numeric IDs,
 * or shop domains — that's their concern).
 *
 * Routes with non-standard resolution orders (body-first, cookie-first,
 * etc.) should keep their inline lookup; this helper only covers the
 * canonical query-then-header pattern. Phase 2.1 explicitly does NOT
 * change resolution behavior — it extracts what's already there.
 *
 * Examples (callers, before → after):
 *
 *   const shopId = sp.get("shop_id") ?? req.headers.get("x-shop-id");
 *   // ↓
 *   const shopId = extractShopId(req);
 *
 *   const shopId = req.nextUrl.searchParams.get("shop_id")
 *     ?? req.headers.get("x-shop-id");
 *   // ↓
 *   const shopId = extractShopId(req);
 */

import type { NextRequest } from "next/server";

const SHOP_ID_QUERY_PARAM = "shop_id";
const SHOP_ID_HEADER = "x-shop-id";

/**
 * Resolve the merchant's shop ID from the request.
 *
 * Resolution order (must match the existing inline patterns the helper
 * replaces — do not reorder):
 *   1. `?shop_id=…` query parameter
 *   2. `x-shop-id` request header
 *
 * Returns `null` when neither is present. Empty strings count as
 * absent — `?shop_id=` (empty value) falls through to the header.
 */
export function extractShopId(req: NextRequest): string | null {
  const fromQuery = req.nextUrl.searchParams.get(SHOP_ID_QUERY_PARAM);
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const fromHeader = req.headers.get(SHOP_ID_HEADER);
  if (fromHeader && fromHeader.length > 0) return fromHeader;
  return null;
}

/**
 * Variant for routes that accept the shop ID in the JSON body too —
 * resolution order is body-first, then the standard query → header
 * fallback. Use for POST routes whose body schema includes `shop_id`.
 */
export function extractShopIdFromBody(
  req: NextRequest,
  body: { shop_id?: string | null | undefined } | null | undefined,
): string | null {
  const fromBody = body?.shop_id;
  if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;
  return extractShopId(req);
}
