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
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import { sendUnknownReasonAlert } from "@/lib/email/sendUnknownReasonAlert";
import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";

const KNOWN_REASONS = new Set<string>(ALL_DISPUTE_REASONS);

function titleCaseReason(reason: string): string {
  return reason
    .split("_")
    .map((word) =>
      word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word,
    )
    .join(" ");
}

/**
 * Ensure a reason_template_mappings row exists for the given (reason, phase)
 * pair. Inserts a placeholder row with template_id = NULL and family = 'Unknown'
 * when the pair is new, returns true in that case so the caller can fire the
 * "new reason detected" email + audit event exactly once. Existing rows are
 * left untouched.
 */
async function ensureReasonMapping(
  sb: ReturnType<typeof getServiceClient>,
  reasonCode: string,
  phase: string,
): Promise<boolean> {
  if (phase !== "inquiry" && phase !== "chargeback") return false;

  const { data: existing } = await sb
    .from("reason_template_mappings")
    .select("id")
    .eq("reason_code", reasonCode)
    .eq("dispute_phase", phase)
    .maybeSingle();

  if (existing) return false;

  const isKnown = KNOWN_REASONS.has(reasonCode);
  const label = isKnown ? titleCaseReason(reasonCode) : titleCaseReason(reasonCode);
  const family = isKnown ? "General" : "Unknown";

  const { error } = await sb.from("reason_template_mappings").insert({
    reason_code: reasonCode,
    dispute_phase: phase,
    template_id: null,
    label,
    family,
    is_active: true,
    notes: isKnown
      ? null
      : `Auto-created from Shopify sync on ${new Date().toISOString()} — please review`,
  });

  if (error) {
    // Race with another sync worker is fine — the row now exists.
    console.warn("[syncDisputes] ensureReasonMapping insert failed:", error.message);
    return false;
  }

  return !isKnown;
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
  /** Set when synced === 0 to help diagnose "no disputes" (no tokens or PII). */
  debug?: { shop_domain: string; first_page_edges: number };
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
  let firstPageEdgesCount: number | null = null;

  while (hasNextPage) {
    const variables: Record<string, unknown> = { first: 50, after };
    const gqlResult = await requestShopifyGraphQL<DisputeListResponse>({
      session: { shopDomain: shop.shop_domain, accessToken },
      query: DISPUTE_LIST_QUERY,
      variables,
      correlationId: opts?.correlationId,
    });

    if (gqlResult.errors?.length) {
      for (const e of gqlResult.errors) {
        result.errors.push(`GraphQL: ${e.message}`);
      }
      if (firstPageEdgesCount === null) {
        result.debug = { shop_domain: shop.shop_domain, first_page_edges: 0 };
      }
      break;
    }

    const edges: { node: DisputeListNode; cursor: string }[] =
      gqlResult.data?.disputes?.edges ?? [];
    const pageInfo =
      gqlResult.data?.disputes?.pageInfo;

    if (firstPageEdgesCount === null) firstPageEdgesCount = edges.length;
    if (edges.length === 0) {
      if (result.synced === 0) {
        result.debug = { shop_domain: shop.shop_domain, first_page_edges: 0 };
      }
      break;
    }

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
          customer_display_name:
            [d.disputeEvidence?.customerFirstName, d.disputeEvidence?.customerLastName]
              .filter(Boolean).join(" ").trim() ||
            d.disputeEvidence?.shippingAddress?.name?.trim() ||
            d.disputeEvidence?.billingAddress?.name?.trim() ||
            null,
          phase: d.type?.toLowerCase() ?? null,
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

        // Auto-heal reason_template_mappings. If Shopify sent a reason
        // that's not in ALL_DISPUTE_REASONS (schema drift), insert a
        // placeholder mapping row, write an audit event, and email the
        // admin — exactly once per new reason because subsequent syncs
        // find the row already exists.
        const reasonCode = d.reasonDetails?.reason ?? null;
        const phaseLower = d.type?.toLowerCase() ?? null;
        if (reasonCode && phaseLower && !KNOWN_REASONS.has(reasonCode)) {
          const isNewUnknownReason = await ensureReasonMapping(
            sb,
            reasonCode,
            phaseLower,
          );
          if (isNewUnknownReason) {
            await sb.from("audit_events").insert({
              shop_id: shopId,
              dispute_id: upserted?.id ?? null,
              actor_type: "system",
              event_type: "unknown_dispute_reason",
              event_payload: {
                reason_code: reasonCode,
                phase: phaseLower,
                shop_domain: shop.shop_domain,
                first_seen_dispute_gid: d.id,
                detected_at: new Date().toISOString(),
              },
            });
            // Fire-and-forget — non-blocking per the helper's contract.
            void sendUnknownReasonAlert({
              reasonCode,
              phase: phaseLower,
              shopDomain: shop.shop_domain,
              firstSeenDisputeGid: d.id,
            });
          }
        }

        // Notify merchant of new dispute (fire-and-forget; respects the
        // newDispute notification preference set in TeamNotificationsStep).
        if (!existing && upserted) {
          void sendNewDisputeAlert({
            shopId,
            disputeId: upserted.id,
            reason: d.reasonDetails?.reason ?? null,
            phase: d.type?.toLowerCase() ?? null,
            amount: d.amount ? parseFloat(d.amount.amount) : null,
            currencyCode: d.amount?.currencyCode ?? null,
            dueAt: d.evidenceDueBy ?? null,
            orderName: d.order?.name ?? null,
          });
        }

        // For new disputes: evaluate rules, then trigger automation or set needs_review
        if (!existing && triggerAutomation && upserted) {
          try {
            const phaseForRules =
              phaseLower === "inquiry" || phaseLower === "chargeback"
                ? phaseLower
                : null;
            const evalResult = await evaluateRules({
              id: upserted.id,
              shop_id: shopId,
              reason: d.reasonDetails?.reason ?? null,
              status: d.status?.toLowerCase() ?? null,
              amount: d.amount ? parseFloat(d.amount.amount) : null,
              phase: phaseForRules,
            });

            if (evalResult.action.mode === "review") {
              await sb
                .from("disputes")
                .update({ needs_review: true, updated_at: new Date().toISOString() })
                .eq("id", upserted.id);
            } else if (evalResult.action.mode === "auto_pack") {
              await runAutomationPipeline({
                id: upserted.id,
                shop_id: shopId,
                reason: d.reasonDetails?.reason ?? null,
                phase: phaseForRules,
                pack_template_id: evalResult.packTemplateId ?? evalResult.action.pack_template_id ?? null,
              });
            }
            // manual: no needs_review, no pipeline
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

  if (result.synced === 0 && result.debug === undefined) {
    result.debug = {
      shop_domain: shop.shop_domain,
      first_page_edges: firstPageEdgesCount ?? 0,
    };
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
