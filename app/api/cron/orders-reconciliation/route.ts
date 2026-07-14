/**
 * GET /api/cron/orders-reconciliation
 *
 * Daily reconciliation cron (PR-B). Sweeps yesterday's orders for each
 * active shop and enqueues a `reconcile_missing_order` job for any
 * order Shopify created in the trailing 26h window that doesn't exist
 * in `shopify_orders`. Catches:
 *
 *   - Webhook delivery losses (Shopify retried, we 500'd, the retries
 *     also failed).
 *   - Pre-PR-A historical gaps (orders created BEFORE the orders-create
 *     webhook was wired up).
 *
 * 26h window absorbs cron-run skew (the cron is scheduled daily; a
 * shifted run-time would otherwise miss a sliver). The reconcile job
 * is idempotent at the persist layer thanks to the risk_payload_hash
 * gate, so re-enqueuing the same order across cron runs is safe.
 *
 * Bounds:
 *   - Max 100 enqueues per shop per run (`MAX_ENQUEUES_PER_SHOP`)
 *   - Circuit breaker: shops with `reconciliation_failure_streak >= 5`
 *     are skipped + one audit_events row emitted. Streak resets to 0
 *     on next success.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { ensureFreshSession } from "@/lib/shopify/sessions/refreshOfflineToken";
import { cronEnvGate } from "@/lib/cron/envGate";

const MAX_ENQUEUES_PER_SHOP = 100;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const WINDOW_HOURS = 26;

const RECENT_ORDER_IDS_QUERY = /* GraphQL */ `
  query ShopRecentOrderIds($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();

  const { data: shops, error } = await sb
    .from("shops")
    .select("id, shop_domain, reconciliation_failure_streak")
    .is("uninstalled_at", null)
    .eq("historical_import_status", "complete");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  const queryString = `created_at:>=${sinceIso}`;

  const result = {
    shopsConsidered: (shops ?? []).length,
    shopsSkippedCircuitBreaker: 0,
    shopsProcessed: 0,
    enqueued: 0,
    errors: [] as Array<{ shopId: string; error: string }>,
  };

  for (const shop of shops ?? []) {
    if (
      (shop.reconciliation_failure_streak ?? 0) >= CIRCUIT_BREAKER_THRESHOLD
    ) {
      result.shopsSkippedCircuitBreaker++;
      continue;
    }

    try {
      const enq = await reconcileShop({
        shopId: shop.id,
        shopDomain: shop.shop_domain,
        queryString,
      });
      result.enqueued += enq;
      result.shopsProcessed++;
      if ((shop.reconciliation_failure_streak ?? 0) > 0) {
        await sb
          .from("shops")
          .update({ reconciliation_failure_streak: 0 })
          .eq("id", shop.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const newStreak = (shop.reconciliation_failure_streak ?? 0) + 1;
      await sb
        .from("shops")
        .update({ reconciliation_failure_streak: newStreak })
        .eq("id", shop.id);

      // Emit a single audit_events row when the breaker trips so the
      // ops team can investigate the broken shop.
      if (newStreak === CIRCUIT_BREAKER_THRESHOLD) {
        await sb.from("audit_events").insert({
          shop_id: shop.id,
          actor_type: "system",
          event_type: "orders_reconciliation_circuit_breaker_tripped",
          event_payload: {
            shop_domain: shop.shop_domain,
            failure_streak: newStreak,
            last_error: msg,
          },
        });
      }

      result.errors.push({ shopId: shop.id, error: msg });
    }
  }

  return NextResponse.json(result);
}

async function reconcileShop(params: {
  shopId: string;
  shopDomain: string;
  queryString: string;
}): Promise<number> {
  const rawSession = await loadSession(params.shopId, "offline");
  if (!rawSession) {
    throw new Error(`no offline session for ${params.shopId}`);
  }
  // Expiring-token refresh (docs/plans/expiring-offline-tokens.plan.md) —
  // this cron calls Shopify directly rather than through
  // getShopBackgroundSession/makeAuthedRequest, so it needs the same
  // proactive-refresh treatment applied explicitly.
  const session = await ensureFreshSession(rawSession);

  const resp = await requestShopifyGraphQL<{
    orders: { edges: Array<{ node: { id: string } }> };
  }>({
    session: {
      shopDomain: session.shopDomain,
      accessToken: session.accessToken,
    },
    query: RECENT_ORDER_IDS_QUERY,
    variables: {
      query: params.queryString,
      first: 250,
    },
    correlationId: `orders-reconciliation-${params.shopId}`,
    locale: "en",
  });

  if (resp.errors && resp.errors.length > 0) {
    throw new Error(resp.errors.map((e) => e.message).join("; "));
  }

  const incomingGids = (resp.data?.orders.edges ?? []).map((e) => e.node.id);
  if (incomingGids.length === 0) return 0;

  const sb = getServiceClient();
  const { data: existing, error: existErr } = await sb
    .from("shopify_orders")
    .select("shopify_order_id")
    .eq("shop_id", params.shopId)
    .in("shopify_order_id", incomingGids);
  if (existErr) {
    throw new Error(`shopify_orders existence lookup failed: ${existErr.message}`);
  }
  const existingSet = new Set((existing ?? []).map((r) => r.shopify_order_id));

  const missing = incomingGids.filter((gid) => !existingSet.has(gid));
  if (missing.length === 0) return 0;

  const toEnqueue = missing.slice(0, MAX_ENQUEUES_PER_SHOP);

  let enqueued = 0;
  for (const gid of toEnqueue) {
    // Skip if a reconcile job for the same order is already in flight.
    const { data: pending } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", params.shopId)
      .eq("job_type", "reconcile_missing_order")
      .eq("entity_id", gid)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (pending) continue;

    await enqueueJob({
      shopId: params.shopId,
      jobType: "reconcile_missing_order",
      entityId: gid,
      priority: 70,
    });
    enqueued++;
  }

  return enqueued;
}
