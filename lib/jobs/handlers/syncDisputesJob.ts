/**
 * Job handler: sync_disputes
 *
 * Fetches all disputes from Shopify for a shop, upserts into the
 * disputes table, and triggers the automation pipeline for new disputes.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { runAutomationPipeline } from "@/lib/automation/pipeline";

import type { ClaimedJob } from "../claimJobs";

const DISPUTES_QUERY = `
  query DisputeList($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      disputes(first: $first, after: $after) {
        edges {
          node {
            id
            status
            reasonDetails { reason }
            amount { amount currencyCode }
            initiatedAt
            evidenceDueBy
            evidenceSentAt
            order { id }
            evidence { id }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  }
`;

interface DisputeNode {
  id: string;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  evidenceSentAt: string | null;
  order: { id: string } | null;
  evidence: { id: string } | null;
}

interface SyncGraphQLResult {
  shopifyPaymentsAccount: {
    disputes: {
      edges: { node: DisputeNode; cursor: string }[];
      pageInfo: { hasNextPage: boolean };
    };
  };
}

export async function handleSyncDisputes(job: ClaimedJob): Promise<void> {
  const sb = getServiceClient();

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("id", job.shopId)
    .single();
  if (!shop) throw new Error(`Shop not found: ${job.shopId}`);

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, key_version, shop_domain")
    .eq("shop_id", shop.id)
    .eq("session_type", "offline")
    .single();
  if (!session) throw new Error(`No offline session for shop ${shop.id}`);

  // NOTE: In production, decrypt the access token here.
  // For V1 skeleton, we pass a placeholder. The actual decrypt
  // is wired in lib/shopify/sessions.ts.
  const accessToken = session.access_token_encrypted;

  let hasNextPage = true;
  let after: string | null = null;
  const newDisputeIds: string[] = [];

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: 50, after };
    const result = await requestShopifyGraphQL<SyncGraphQLResult>({
      session: { shopDomain: shop.shop_domain, accessToken },
      query: DISPUTES_QUERY,
      variables,
      correlationId: `sync-${job.id}`,
    });

    const edges: { node: DisputeNode; cursor: string }[] =
      result.data?.shopifyPaymentsAccount?.disputes?.edges ?? [];
    const pageInfo = result.data?.shopifyPaymentsAccount?.disputes?.pageInfo;
    if (edges.length === 0) break;

    for (const edge of edges) {
      const d: DisputeNode = edge.node;
      const { data: upserted } = await sb
        .from("disputes")
        .upsert(
          {
            shop_id: shop.id,
            dispute_gid: d.id,
            dispute_evidence_gid: d.evidence?.id ?? null,
            order_gid: d.order?.id ?? null,
            status: d.status?.toLowerCase() ?? null,
            reason: d.reasonDetails?.reason ?? null,
            amount: d.amount ? parseFloat(d.amount.amount) : null,
            currency_code: d.amount?.currencyCode ?? null,
            initiated_at: d.initiatedAt,
            due_at: d.evidenceDueBy,
            last_synced_at: new Date().toISOString(),
            raw_snapshot: d,
          },
          { onConflict: "shop_id,dispute_gid" }
        )
        .select("id")
        .single();

      if (upserted) newDisputeIds.push(upserted.id);
      after = edge.cursor;
    }

    hasNextPage = pageInfo?.hasNextPage ?? false;
  }

  await sb.from("audit_events").insert({
    shop_id: shop.id,
    actor_type: "system",
    event_type: "disputes_synced",
    event_payload: {
      dispute_count: newDisputeIds.length,
      job_id: job.id,
    },
  });

  // Trigger automation pipeline for each newly synced dispute
  for (const disputeId of newDisputeIds) {
    const { data: dispute } = await sb
      .from("disputes")
      .select("id, shop_id, reason")
      .eq("id", disputeId)
      .single();
    if (dispute) {
      await runAutomationPipeline(dispute).catch(() => {
        // Non-fatal: log but don't fail the sync job
      });
    }
  }
}
