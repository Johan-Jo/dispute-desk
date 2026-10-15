/**
 * Admin alert: a merchant just hit the no-orders lock screen
 * (docs/plans/no-orders-install-gate.plan.md).
 *
 * Called from the `/app/*` layout whenever `resolveOrdersGate` returns
 * "locked". Throttled to ONE email per shop per 24h by claiming
 * `shops.orders_gate_notified_at` with a conditional UPDATE — only the request
 * whose UPDATE matches a row sends, so reloads and concurrent instances can't
 * produce duplicates.
 *
 * Never throws: an alert failure must never affect what the merchant sees.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "./shopDetails";
import { sendAdminOrdersGateBlockNotification } from "@/lib/email/sendAdminNotification";

export const ORDERS_GATE_NOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface ClaimedShopRow {
  shop_domain: string;
  shop_name: string | null;
  created_at: string | null;
  installed_at: string | null;
  orders_gate_notified_at: string | null;
}

export async function notifyOrdersGateBlock(options: {
  shopInternalId: string;
  /** The `/app/*` path the merchant tried to open, when known. */
  path?: string | null;
}): Promise<void> {
  const { shopInternalId } = options;
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - ORDERS_GATE_NOTIFY_INTERVAL_MS).toISOString();

    // Read the previous stamp first so the email can say when we last alerted.
    const sb = getServiceClient();
    const { data: before } = await sb
      .from("shops")
      .select("orders_gate_notified_at")
      .eq("id", shopInternalId)
      .maybeSingle();

    const { data: claimed, error } = await sb
      .from("shops")
      .update({ orders_gate_notified_at: now.toISOString() })
      .eq("id", shopInternalId)
      .or(`orders_gate_notified_at.is.null,orders_gate_notified_at.lt.${cutoff}`)
      .select("shop_domain, shop_name, created_at, installed_at, orders_gate_notified_at")
      .maybeSingle<ClaimedShopRow>();

    // No row matched: already alerted within the window (or unknown shop).
    if (error || !claimed) return;

    const details = await fetchShopDetails(shopInternalId).catch(() => null);
    const handle = claimed.shop_domain.replace(/\.myshopify\.com$/i, "");

    await sendAdminOrdersGateBlockNotification({
      shopDomain: claimed.shop_domain,
      shopName: details?.name || claimed.shop_name || undefined,
      email: details?.email || undefined,
      phone: details?.phone || undefined,
      primaryDomain: details?.primaryDomain || undefined,
      country: details?.address?.country || undefined,
      currencyCode: details?.currencyCode ?? undefined,
      installedAt: claimed.installed_at ?? claimed.created_at ?? undefined,
      previouslyNotifiedAt:
        (before as { orders_gate_notified_at?: string | null } | null)
          ?.orders_gate_notified_at ?? undefined,
      path: options.path ?? undefined,
      shopInternalId,
      shopifyAdminUrl: `https://admin.shopify.com/store/${handle}`,
    });
  } catch (err) {
    console.warn(
      "[email:admin-orders-gate-block] failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
