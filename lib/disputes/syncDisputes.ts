/**
 * Dispute sync service — webhook-primary, hourly reconciliation safety net.
 *
 * Since 2026-05-20, the disputes/create and disputes/update webhooks are the
 * primary path for state propagation (<2s p50). This service runs hourly to
 * catch up on anything the webhook missed (delivery failures, schema-
 * validation errors).
 *
 * Per-dispute processing is delegated to the shared engine:
 *   - `normalizeGraphQLDispute()` → DisputeSnapshot
 *   - `applyDisputeSnapshot()`    → upsert + dispute_events + monotonic guards
 *   - `dispatchDisputeEffects()`  → pipeline + emails under Layer B dedup
 *
 * Shop-level bookkeeping (audit row, recordReconcileOutcome, unknown-reason
 * auto-heal) remains here because it's not per-dispute.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_LIST_QUERY,
  type DisputeListNode,
  type DisputeListResponse,
} from "@/lib/shopify/queries/disputes";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import { sendUnknownReasonAlert } from "@/lib/email/sendUnknownReasonAlert";
import { recordReconcileOutcome } from "./reconcileSchedule";
import { normalizeGraphQLDispute } from "./disputeSnapshot";
import { applyDisputeSnapshot } from "./applyDisputeSnapshot";
import { dispatchDisputeEffects } from "./disputeEffectsDispatcher";

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
    .select("id, shop_domain, last_reconciled_at")
    .eq("id", shopId)
    .single();
  if (!shop) throw new Error(`Shop not found: ${shopId}`);

  // First-ever sync of this shop = a backfill of its existing dispute backlog.
  // Read this ONCE up front: recordReconcileOutcome() stamps last_reconciled_at
  // at the end of THIS run, so every applyDisputeSnapshot call below must see
  // the value as it was BEFORE the run started. When true, applyDisputeSnapshot
  // flags every newly-discovered dispute as a historical import (open OR
  // resolved), and the dispatcher suppresses the per-dispute "ready for review"
  // / outcome emails. This is what stops installing an established shop from
  // flooding the merchant with one alert per historical dispute.
  const isBackfillImport = shop.last_reconciled_at == null;

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
        // Per-dispute redaction snapshot for the disputes.raw_snapshot column
        // (the shared engine doesn't touch this field; we still store it for
        // forensic + admin tooling).
        const redactedSnapshot = redactPII(d);

        // Normalize the GraphQL node and run the shared diff engine.
        const snapshot = normalizeGraphQLDispute(d);
        if (!snapshot) {
          result.errors.push(
            `${d.id}: graphql snapshot failed schema validation`,
          );
          continue;
        }
        // Customer display data (denormalized columns on disputes) only flows
        // through the cron path; the webhook payload doesn't carry it. Pass
        // these as side-channel patches AFTER applyDisputeSnapshot returns.
        const customerDisplayName =
          [d.disputeEvidence?.customerFirstName, d.disputeEvidence?.customerLastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          d.disputeEvidence?.shippingAddress?.name?.trim() ||
          d.disputeEvidence?.billingAddress?.name?.trim() ||
          null;
        const customerEmail =
          d.disputeEvidence?.customerEmailAddress?.trim() || null;

        const applyResult = await applyDisputeSnapshot({
          shopId,
          source: "cron",
          snapshot,
          backfillImport: isBackfillImport,
        });

        if (applyResult.outcome === "error") {
          for (const w of applyResult.guardWarnings) {
            result.errors.push(`${d.id}: ${w}`);
          }
          after = edge.cursor;
          continue;
        }
        if (
          applyResult.outcome === "skipped_unknown_shop" ||
          applyResult.outcome === "skipped_stale" ||
          applyResult.outcome === "skipped_monotonic_guard"
        ) {
          for (const w of applyResult.guardWarnings) {
            result.errors.push(`${d.id}: ${w}`);
          }
          after = edge.cursor;
          continue;
        }

        result.synced++;
        if (applyResult.created) result.created++;
        else result.updated++;

        // Patch denormalized display columns + raw_snapshot (cron-only).
        if (applyResult.localDisputeId) {
          await sb
            .from("disputes")
            .update({
              customer_display_name: customerDisplayName,
              customer_email: customerEmail,
              raw_snapshot: redactedSnapshot,
            })
            .eq("id", applyResult.localDisputeId);
        }

        // Existing legacy probes for the reason auto-heal + first-win
        // branches need the shopify-shaped node — keep them addressable by
        // re-using `d` directly below.
        const existing: { id: string } | null = applyResult.created
          ? null
          : applyResult.localDisputeId
          ? { id: applyResult.localDisputeId }
          : null;
        const existingErr: { message: string } | null = null;

        // Dispatch the downstream effects under Layer B effect dedup. When
        // triggerAutomation=false (legacy test callers, cron worker probes),
        // skip the DISPUTE_OPENED pipeline branch — the dispute_events ledger
        // entry is already written by applyDisputeSnapshot above.
        if (existing === null || existing !== null) {
          // Always pass through; the dispatcher itself routes per event.
          await dispatchDisputeEffects({
            shopId,
            result: applyResult,
            source: "cron",
            skipAutomation: !triggerAutomation,
            correlationId: opts?.correlationId,
          });
        }

        // Track first chargeback win — sets shops.first_win_at once.
        const statusLower = d.status?.toLowerCase() ?? null;
        if (statusLower === "won") {
          await sb
            .from("shops")
            .update({ first_win_at: new Date().toISOString() })
            .eq("id", shopId)
            .is("first_win_at", null);
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
              dispute_id: applyResult.localDisputeId,
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
        void existing;
        void existingErr;
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

  // Adaptive cadence: tighten on drift, loosen on clean runs.
  await recordReconcileOutcome({
    shopId,
    driftDetected: result.created > 0 || result.updated > 0,
    hadErrors: result.errors.length > 0,
  });

  return result;
}
