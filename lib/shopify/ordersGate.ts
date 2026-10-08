/**
 * The no-orders gate for the embedded app (docs/plans/no-orders-install-gate.plan.md).
 *
 * `resolveOrdersGate` is called from the `/app/*` layout on every load. It is
 * deliberately cheap for the overwhelmingly common case: a verified shop is one
 * indexed column read (`shops.orders_verified_at`), no Shopify call.
 *
 * FAIL OPEN, always. Any doubt — DB error, Shopify error, missing session —
 * returns "open". A real merchant must never be locked out because our own
 * check broke; the cost of a false "open" is one more empty store browsing.
 *
 * This is a UI gate only. Webhooks, billing and the shop row are untouched, so
 * the first order/dispute that arrives is still processed and unlocks the shop.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { shopHasAnyOrders } from "./hasAnyOrders";

export type OrdersGate = "open" | "locked";

/**
 * Per-instance memo of "locked" verdicts so a merchant refreshing the lock
 * screen doesn't hit Shopify on every load. Short on purpose: when the store
 * gets its first order the unlock should be near-immediate.
 */
const LOCKED_TTL_MS = 5 * 60 * 1000;
const lockedAt = new Map<string, number>();

/** Test hook. */
export function _resetOrdersGateCache(): void {
  lockedAt.clear();
}

/** Stamp the shop as verified. Never throws. */
export async function stampOrdersVerified(shopInternalId: string): Promise<void> {
  try {
    await getServiceClient()
      .from("shops")
      .update({ orders_verified_at: new Date().toISOString() })
      .eq("id", shopInternalId)
      .is("orders_verified_at", null);
  } catch (err) {
    console.warn(
      "[ordersGate] stamp failed:",
      err instanceof Error ? err.message : err,
    );
  }
  lockedAt.delete(shopInternalId);
}

export async function resolveOrdersGate(shopInternalId: string): Promise<OrdersGate> {
  try {
    const { data, error } = await getServiceClient()
      .from("shops")
      .select("orders_verified_at")
      .eq("id", shopInternalId)
      .maybeSingle();
    // Unknown shop row or a read error: not ours to lock.
    if (error || !data) return "open";
    if (data.orders_verified_at) return "open";
  } catch {
    return "open";
  }

  const cachedAt = lockedAt.get(shopInternalId);
  if (cachedAt !== undefined && Date.now() - cachedAt < LOCKED_TTL_MS) {
    return "locked";
  }

  const hasOrders = await shopHasAnyOrders(shopInternalId);
  if (hasOrders === true) {
    await stampOrdersVerified(shopInternalId);
    return "open";
  }
  if (hasOrders === false) {
    lockedAt.set(shopInternalId, Date.now());
    return "locked";
  }
  return "open";
}
