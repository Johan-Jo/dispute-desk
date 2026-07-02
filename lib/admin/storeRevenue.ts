/**
 * Merchant store revenue (GMV) over the trailing N days, summed from
 * `shopify_orders.order_total`. This is the MERCHANT's own sales
 * revenue — distinct from `shops.plan` subscription revenue (what the
 * shop pays us). Used by the admin shop-detail "Monthly Revenue" card
 * and the Risk Profile.
 *
 * Fixed trailing window (default 30 days), NOT tied to the Risk
 * Profile period selector — it's a "how big is this store right now"
 * signal. Paginates because an established shop can exceed 1000 orders
 * in a month.
 */

import { getServiceClient } from "@/lib/supabase/server";

export interface StoreRevenue {
  /** Sum of order_total over the window. */
  total: number;
  /** Dominant order currency in the window (falls back to USD). */
  currency: string;
  /** Number of orders summed. */
  orderCount: number;
  /** Trailing window length in days. */
  windowDays: number;
}

/** UTC date `YYYY-MM-DD` `days` before `endDateIso` (inclusive window). */
function windowStartIso(endDateIso: string, days: number): string {
  const d = new Date(`${endDateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export async function computeStoreRevenue(
  shopId: string,
  opts: { endDateIso?: string; windowDays?: number } = {},
): Promise<StoreRevenue> {
  const windowDays = opts.windowDays ?? 30;
  const endDateIso =
    opts.endDateIso ?? new Date().toISOString().slice(0, 10);
  const fromIso = windowStartIso(endDateIso, windowDays);

  const sb = getServiceClient();
  let total = 0;
  let orderCount = 0;
  const currencyCounts: Record<string, number> = {};

  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data: rows } = await sb
      .from("shopify_orders")
      .select("order_total, currency, processed_at")
      .eq("shop_id", shopId)
      .gte("processed_at", `${fromIso}T00:00:00Z`)
      .lte("processed_at", `${endDateIso}T23:59:59.999Z`)
      .order("processed_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (!rows?.length) break;
    for (const r of rows as Array<{ order_total: number | null; currency: string | null }>) {
      total += Number(r.order_total) || 0;
      orderCount += 1;
      const c = r.currency ?? "USD";
      currencyCounts[c] = (currencyCounts[c] ?? 0) + 1;
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const currency =
    Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  return { total, currency, orderCount, windowDays };
}
