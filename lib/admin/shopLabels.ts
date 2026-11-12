import type { getServiceClient } from "@/lib/supabase/server";

export interface ShopLabel {
  shop_domain: string;
  primary_domain: string | null;
}

/**
 * Domain labels for a set of shop ids, so admin list routes can hand pages
 * what `AdminMerchant` needs (storefront domain + myshopify alias) without a
 * per-row query. Chunked: `.in()` with hundreds of uuids overruns URL limits.
 */
export async function loadShopLabels(
  sb: ReturnType<typeof getServiceClient>,
  shopIds: Array<string | null | undefined>,
): Promise<Map<string, ShopLabel>> {
  const ids = [...new Set(shopIds.filter((x): x is string => !!x))];
  const out = new Map<string, ShopLabel>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb
      .from("shops")
      .select("id, shop_domain, primary_domain")
      .in("id", ids.slice(i, i + 100));
    for (const r of (data ?? []) as Array<{ id: string; shop_domain: string; primary_domain: string | null }>) {
      out.set(r.id, { shop_domain: r.shop_domain, primary_domain: r.primary_domain ?? null });
    }
  }
  return out;
}
