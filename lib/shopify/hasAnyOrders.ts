/**
 * "Does this store have any activity DisputeDesk could work on?"
 *
 * Backs the no-orders install gate (docs/plans/no-orders-install-gate.plan.md).
 * A store with no orders has no disputes, so there is nothing for the app to
 * do — and empty installs were sitting in the embedded UI just browsing.
 *
 * Tri-state on purpose:
 *   - `true`  — at least one order, or at least one dispute, exists.
 *   - `false` — we asked Shopify and it positively answered "no orders", and we
 *               hold no dispute for the shop either.
 *   - `null`  — we could not tell (no session, token not propagated yet,
 *               GraphQL error). Callers MUST treat this as "let them in":
 *               never lock a merchant out because OUR check failed.
 *
 * Why disputes also count: without the `read_all_orders` scope Shopify only
 * exposes the last 60 days of orders. A dormant but real store whose orders
 * are all older, with a dispute on one of them, would otherwise look empty.
 *
 * Why an `orders(first: 1)` connection and not `ordersCount`: `ordersCount`
 * was measured returning wrong counts in 2026-01 (see
 * lib/shopify/queries/ordersForSnapshot.ts). We only need existence, and the
 * connection answers that without a count.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "./makeAuthedRequest";

const ANY_ORDER_QUERY = `
  query AnyOrder {
    orders(first: 1) {
      edges { node { id } }
    }
  }
`;

interface AnyOrderData {
  orders: { edges: Array<{ node: { id: string } }> } | null;
}

export async function shopHasAnyOrders(
  shopInternalId: string,
): Promise<boolean | null> {
  // A dispute row is proof of activity and costs no Shopify call.
  try {
    const { count, error } = await getServiceClient()
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopInternalId);
    if (!error && (count ?? 0) > 0) return true;
  } catch (err) {
    console.warn(
      "[ordersGate] dispute lookup failed:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const result = await makeAuthedRequest<AnyOrderData>({
      shopId: shopInternalId,
      query: ANY_ORDER_QUERY,
    });
    // An errors-only / null-data response is "unknown", not "no orders".
    const edges = result.data?.orders?.edges;
    if (!edges) {
      console.warn("[ordersGate] orders probe returned no data", {
        shopInternalId,
        errors: result.errors?.map((e) => e.message),
      });
      return null;
    }
    return edges.length > 0;
  } catch (err) {
    console.warn(
      "[ordersGate] orders probe failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
