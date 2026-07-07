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

  // 2) REST per-dispute → network_reason_code (card discriminator).
  //    Card (Visa/MC) disputes carry a network_reason_code; Klarna disputes do not.
  let withNetworkCode = 0;
  let restErrors = 0;
  const networkCodeSamples: Array<Record<string, unknown>> = [];
  for (const d of all) {
    const legacyId = d.id.split("/").pop();
    try {
      const res = await fetch(
        `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/disputes/${legacyId}.json`,
        { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        restErrors++;
        continue;
      }
      const j = (await res.json()) as { dispute?: { network_reason_code?: string | null } };
      const nrc = j.dispute?.network_reason_code ?? null;
      if (nrc) {
        withNetworkCode++;
        if (networkCodeSamples.length < 15) {
          networkCodeSamples.push({
            id: legacyId,
            order: d.order?.name,
            network_reason_code: nrc,
            type: d.type,
            reason: d.reasonDetails?.reason,
          });
        }
      }
    } catch {
      restErrors++;
    }
  }

  // 3) Reconcile against our DB.
  const sb = getServiceClient();
  const { count: dbCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", CAY_SHOP_ID);

  const { data: dbGids } = await sb
    .from("disputes")
    .select("dispute_gid")
    .eq("shop_id", CAY_SHOP_ID);
  const known = new Set((dbGids ?? []).map((r) => r.dispute_gid));
  const unsynced = all
    .filter((d) => !known.has(d.id))
    .slice(0, 25)
    .map((d) => ({
      id: d.id,
      type: d.type,
      reason: d.reasonDetails?.reason,
      order: d.order?.name,
      initiatedAt: d.initiatedAt,
    }));

  return NextResponse.json({
    shopDomain,
    shopifyDisputeCount: all.length,
    pagesWalked: page,
    byType,
    byReason,
    disputesWithNetworkReasonCode: withNetworkCode,
    networkCodeSamples,
    restLookupErrors: restErrors,
    ourDbDisputeCount: dbCount ?? 0,
    reconciled: all.length === (dbCount ?? 0),
    delta: all.length - (dbCount ?? 0),
    unsyncedSample: unsynced,
    interpretation:
      withNetworkCode === 0
        ? "No dispute carries a network_reason_code → none went through the card rails (consistent with 100% Klarna)."
        : `${withNetworkCode} dispute(s) carry a network_reason_code → these are card-rail disputes; NOT 100% Klarna.`,
  });
}
