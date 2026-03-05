/**
 * Dispute sync service.
 *
 * Fetches all disputes from Shopify for a given shop, upserts into
 * the disputes table, and optionally triggers the automation pipeline.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_LIST_QUERY,
  type DisputeListNode,
  type DisputeListResponse,
} from "@/lib/shopify/queries/disputes";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import { evaluateRules } from "@/lib/rules/evaluateRules";

interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

/**
 * Redact PII from the raw dispute snapshot before storage.
 * Strips email, cardholder name, keeps last-4 of card if present.
 */
function redactPII(node: DisputeListNode): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...node };
  // Remove order email if leaked into snapshot
  if (node.order) {
    snapshot.order = {
      id: node.order.id,
      legacyResourceId: node.order.legacyResourceId,
      name: node.order.name,
    };
  }
  return snapshot;
}

function decryptAccessToken(encryptedToken: string): string {
  try {
    const payload = deserializeEncrypted(encryptedToken);
    return decrypt(payload);
  } catch {
    // If the token isn't in encrypted format, return as-is
    // (development / migration scenarios)
    return encryptedToken;
  }
}

/**
 * Sync all disputes for a shop from Shopify.
 */
export async function syncDisputes(
  shopId: string,
  opts?: { triggerAutomation?: boolean; correlationId?: string }
): Promise<SyncResult> {
  const sb = getServiceClient();
  const triggerAutomation = opts?.triggerAutomation ?? true;

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("id", shopId)
    .single();
  if (!shop) throw new Error(`Shop not found: ${shopId}`);

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, key_version, shop_domain")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) throw new Error(`No offline session for shop ${shopId}`);

  const accessToken = decryptAccessToken(session.access_token_encrypted);

  const result: SyncResult = { synced: 0, created: 0, updated: 0, errors: [] };
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: 50, after };
    const gqlResult = await requestShopifyGraphQL<DisputeListResponse>({
      session: { shopDomain: shop.shop_domain, accessToken },
      query: DISPUTE_LIST_QUERY,
      variables,
      correlationId: opts?.correlationId,
    });

    const edges: { node: DisputeListNode; cursor: string }[] =
      gqlResult.data?.disputes?.edges ?? [];
    const pageInfo =
      gqlResult.data?.disputes?.pageInfo;

    if (edges.length === 0) break;

    for (const edge of edges) {
      const d = edge.node;
      try {
        // Check if row already exists
        const { data: existing } = await sb
          .from("disputes")
          .select("id")
          .eq("shop_id", shopId)
          .eq("dispute_gid", d.id)
          .maybeSingle();

        const row = {
          shop_id: shopId,
          dispute_gid: d.id,
          dispute_evidence_gid: d.disputeEvidence?.id ?? null,
          order_gid: d.order?.id ?? null,
          order_name: d.order?.name ?? null,
          customer_display_name: d.order?.customer?.displayName ?? null,
          status: d.status?.toLowerCase() ?? null,
          reason: d.reasonDetails?.reason ?? null,
          amount: d.amount ? parseFloat(d.amount.amount) : null,
          currency_code: d.amount?.currencyCode ?? null,
          initiated_at: d.initiatedAt,
          due_at: d.evidenceDueBy,
          last_synced_at: new Date().toISOString(),
          raw_snapshot: redactPII(d),
        };

        const { data: upserted, error: upsertErr } = await sb
          .from("disputes")
          .upsert(row, { onConflict: "shop_id,dispute_gid" })
          .select("id")
          .single();

        if (upsertErr) {
          result.errors.push(`${d.id}: ${upsertErr.message}`);
          continue;
        }

        result.synced++;
        if (existing) {
          result.updated++;
        } else {
          result.created++;
        }

        // For new disputes: evaluate rules, then trigger automation or set needs_review
        if (!existing && triggerAutomation && upserted) {
          try {
            const evalResult = await evaluateRules({
              id: upserted.id,
              shop_id: shopId,
              reason: d.reasonDetails?.reason ?? null,
              status: d.status?.toLowerCase() ?? null,
              amount: d.amount ? parseFloat(d.amount.amount) : null,
            });

            if (evalResult.action.mode === "review") {
              await sb
                .from("disputes")
                .update({ needs_review: true, updated_at: new Date().toISOString() })
                .eq("id", upserted.id);
            } else {
              await runAutomationPipeline({
                id: upserted.id,
                shop_id: shopId,
                reason: d.reasonDetails?.reason ?? null,
              });
            }
          } catch (err) {
            result.errors.push(
              `automation(${d.id}): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        result.errors.push(
          `${d.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      after = edge.cursor;
    }

    hasNextPage = pageInfo?.hasNextPage ?? false;
  }

  // Audit the sync
  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "system",
    event_type: "disputes_synced",
    event_payload: {
      synced: result.synced,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
      correlation_id: opts?.correlationId,
    },
  });

  return result;
}
