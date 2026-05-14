/**
 * Resolve a Shopify shop_domain (e.g. "foo.myshopify.com") to the
 * DisputeDesk shop_id (UUID). Used by the LSE-4 storefront ingest
 * endpoint so the merchant never has to paste a UUID into any
 * extension — every Shopify surface (theme, pixel, checkout UI)
 * exposes the shop_domain for free at runtime.
 *
 * Returns null when the domain isn't recognized. The ingest endpoint
 * treats that as a silent drop (fail-open).
 */

import { getServiceClient } from "@/lib/supabase/server";

// Tiny in-memory cache: shop_domain → shop_id with TTL. Storefront
// pageviews are high-volume; even a 60-second cache eliminates most
// repeated lookups for the same shop. Service-role queries against
// the indexed shop_domain column are fast, but this saves DB load.
interface CacheEntry {
  shopId: string;
  cachedAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function clearShopDomainCache(): void {
  cache.clear();
}

export async function resolveShopIdFromDomain(
  shopDomain: string,
): Promise<string | null> {
  const normalized = shopDomain.trim().toLowerCase();
  if (!normalized || !normalized.endsWith(".myshopify.com")) {
    return null;
  }

  const now = Date.now();
  const cached = cache.get(normalized);
  if (cached && now - cached.cachedAt < TTL_MS) {
    return cached.shopId;
  }

  const sb = getServiceClient();
  const { data } = await sb
    .from("shops")
    .select("id")
    .eq("shop_domain", normalized)
    .maybeSingle();

  if (!data) {
    return null;
  }
  cache.set(normalized, { shopId: data.id as string, cachedAt: now });
  return data.id as string;
}
