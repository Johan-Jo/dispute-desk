import { NextRequest, NextResponse } from "next/server";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { requestShopifyGraphQL, type GraphQLResponse } from "@/lib/shopify/graphql";
import { SHOPIFY_API_VERSION } from "@/lib/shopify/client";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * TEMPORARY read-only diagnostic — reconcile cay-collective's disputes against
 * Shopify (source of truth) to prove/disprove "100% Klarna, zero card disputes".
 *
 * Gated on CRON_SECRET (Authorization: Bearer / ?secret=). cay-only (hardcoded
 * shop id) — no arbitrary-shop access. Does NOT mutate anything.
 *
 * REMOVE after the one-shot reconciliation is captured.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAY_SHOP_ID = "c497df8d-632d-49da-b385-eb523f57f341"; // cay-collective.myshopify.com

const DISPUTE_LIST_QUERY = `
  query DisputeList($first: Int!, $after: String) {
    disputes(first: $first, after: $after) {
      edges {
        node {
          id
          type
          status
          reasonDetails { reason }
          amount { amount currencyCode }
          initiatedAt
          order { id legacyResourceId name }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface DisputeNode {
  id: string;
  type: string | null;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  order: { id: string; legacyResourceId: string; name: string } | null;
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let querySecret = "";
  try {
    querySecret = new URL(req.url).searchParams.get("secret") ?? "";
  } catch {
    /* ignore */
  }
  return bearer === expected || querySecret === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getShopBackgroundSession(CAY_SHOP_ID);
  const shopDomain = session.shopDomain;
  const token = session.accessToken;

  // 1) Full GraphQL dispute list (authoritative count + type/reason).
  type DisputeListData = {
    disputes: {
      edges: { node: DisputeNode; cursor: string }[];
      pageInfo: { hasNextPage: boolean };
    };
  };

  const all: DisputeNode[] = [];
  let after: string | null = null;
  let page = 0;
  for (;;) {
    const resp: GraphQLResponse<DisputeListData> = await requestShopifyGraphQL<DisputeListData>({
      session: { shopDomain, accessToken: token },
      query: DISPUTE_LIST_QUERY,
      variables: { first: 100, after },
    });
    if (resp.errors?.length) {
      return NextResponse.json(
        { error: "graphql_error", details: resp.errors.map((e) => e.message) },
        { status: 502 },
      );
    }
    const conn = resp.data?.disputes;
    if (!conn) break;
    for (const e of conn.edges) all.push(e.node);
    page++;
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.edges[conn.edges.length - 1]?.cursor ?? null;
    if (page > 50) break; // safety
  }

  const byType: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const d of all) {
    byType[d.type ?? "(null)"] = (byType[d.type ?? "(null)"] ?? 0) + 1;
    const r = d.reasonDetails?.reason ?? "(null)";
    byReason[r] = (byReason[r] ?? 0) + 1;
  }

  // 2) REST per-dispute → network_reason_code + full REST payload keys.
  //    Build a per-dispute record we can cross-tab against the order's payment method.
  interface DisputeRecord {
    orderGid: string | null;
    orderName: string | null;
    type: string | null;
    reason: string | null;
    networkReasonCode: string | null;
    restKeys: string[];
  }
  const records: DisputeRecord[] = [];
  let restErrors = 0;
  let restKeySample: string[] = [];
  for (const d of all) {
    const legacyId = d.id.split("/").pop();
    let nrc: string | null = null;
    let restKeys: string[] = [];
    try {
      const res = await fetch(
        `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/disputes/${legacyId}.json`,
        { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
      );
      if (res.ok) {
        const j = (await res.json()) as { dispute?: Record<string, unknown> };
        nrc = (j.dispute?.network_reason_code as string | null) ?? null;
        restKeys = j.dispute ? Object.keys(j.dispute) : [];
        if (restKeySample.length === 0) restKeySample = restKeys;
      } else {
        restErrors++;
      }
    } catch {
      restErrors++;
    }
    records.push({
      orderGid: d.order?.id ?? null,
      orderName: d.order?.name ?? null,
      type: d.type,
      reason: d.reasonDetails?.reason ?? null,
      networkReasonCode: nrc,
      restKeys,
    });
  }

  // 3) Join each dispute to its order's payment method (our synced order data).
  const sb = getServiceClient();
  const orderGids = records.map((r) => r.orderGid).filter((g): g is string => !!g);
  const { data: orderRows } = await sb
    .from("shopify_orders")
    .select("shopify_order_id, payment_method, payment_gateway")
    .eq("shop_id", CAY_SHOP_ID)
    .in("shopify_order_id", orderGids);
  const methodByGid = new Map(
    (orderRows ?? []).map((o) => [o.shopify_order_id, o.payment_method as string | null]),
  );

  // 4) THE KEY CROSS-TAB: for disputes WITHOUT a network reason code, what payment
  //    method funded the order? Hypothesis under test: they are all Klarna pay-later.
  const withCode = records.filter((r) => r.networkReasonCode);
  const withoutCode = records.filter((r) => !r.networkReasonCode);

  const bucketMethods = (recs: DisputeRecord[]) => {
    const m: Record<string, number> = {};
    for (const r of recs) {
      const method = (r.orderGid && methodByGid.get(r.orderGid)) || "(order-not-synced)";
      m[method] = (m[method] ?? 0) + 1;
    }
    return m;
  };

  // Full cross-tab: payment_method × has-network-code.
  const crossTab: Record<string, { withCode: number; withoutCode: number }> = {};
  for (const r of records) {
    const method = (r.orderGid && methodByGid.get(r.orderGid)) || "(order-not-synced)";
    crossTab[method] ??= { withCode: 0, withoutCode: 0 };
    if (r.networkReasonCode) crossTab[method].withCode++;
    else crossTab[method].withoutCode++;
  }

  // Network-reason-code distribution.
  const codeDistribution: Record<string, number> = {};
  for (const r of withCode) {
    const c = r.networkReasonCode as string;
    codeDistribution[c] = (codeDistribution[c] ?? 0) + 1;
  }

  const { count: dbCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", CAY_SHOP_ID);

  // Answer the hypothesis explicitly.
  const withoutCodeMethods = bucketMethods(withoutCode);
  const nonKlarnaWithoutCode = withoutCode.filter((r) => {
    const method = (r.orderGid && methodByGid.get(r.orderGid)) || "";
    return !method.startsWith("klarna");
  });
  const allWithoutCodeAreKlarna = withoutCode.length > 0 && nonKlarnaWithoutCode.length === 0;

  return NextResponse.json({
    shopDomain,
    shopifyDisputeCount: all.length,
    ourDbDisputeCount: dbCount ?? 0,
    reconciled: all.length === (dbCount ?? 0),
    byType,
    byReason,
    restLookupErrors: restErrors,
    restPayloadKeys: restKeySample,
    counts: {
      withNetworkCode: withCode.length,
      withoutNetworkCode: withoutCode.length,
    },
    codeDistribution,
    crossTab_paymentMethod_x_hasNetworkCode: crossTab,
    withoutCode_paymentMethods: withoutCodeMethods,
    withCode_paymentMethods: bucketMethods(withCode),
    hypothesis_allWithoutCodeAreKlarna: allWithoutCodeAreKlarna,
    nonKlarnaWithoutCode: nonKlarnaWithoutCode.map((r) => ({
      order: r.orderName,
      method: (r.orderGid && methodByGid.get(r.orderGid)) || "(order-not-synced)",
      reason: r.reason,
      type: r.type,
    })),
    withoutCodeDetail: withoutCode.map((r) => ({
      order: r.orderName,
      method: (r.orderGid && methodByGid.get(r.orderGid)) || "(order-not-synced)",
      reason: r.reason,
      type: r.type,
    })),
  });
}
