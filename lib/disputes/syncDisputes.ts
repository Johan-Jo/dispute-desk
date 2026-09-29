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
import { loadSession } from "@/lib/shopify/sessionStorage";
import { ensureFreshSession } from "@/lib/shopify/sessions/refreshOfflineToken";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import { sendUnknownReasonAlert } from "@/lib/email/sendUnknownReasonAlert";
import { recordReconcileOutcome } from "./reconcileSchedule";
import { normalizeGraphQLDispute } from "./disputeSnapshot";
import { applyDisputeSnapshot } from "./applyDisputeSnapshot";
import { dispatchDisputeEffects } from "./disputeEffectsDispatcher";
import {
  evidenceSnapshotsEnabled,
  recordEvidenceSnapshots,
  type SnapshotCandidate,
} from "./evidenceSnapshots";
import { readEvidenceRecord } from "@/lib/shopify/evidenceRecord";

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
  /** Closed disputes skipped because Shopify's node is unchanged (see
   *  `isUnchangedClosedDispute`). Not counted in `synced`. */
  skippedUnchanged?: number;
  /** Disputes the diff engine actually changed (new, or outcome "applied":
   *  a status, due-date, submission, cycle or escalation transition). */
  changed?: number;
  /** Set when synced === 0 to help diagnose "no disputes" (no tokens or PII). */
  debug?: { shop_domain: string; first_page_edges: number };
}

/**
 * Redact PII from the raw dispute snapshot before storage.
 * Strips email, cardholder name, keeps last-4 of card if present.
 */
const CLOSED_STATUSES = new Set(["won", "lost", "charge_refunded", "accepted"]);
const FULL_RESYNC_MS = 24 * 60 * 60 * 1000;

/** JSON with sorted keys: jsonb does not keep key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export interface StoredDisputeRow {
  status: string | null;
  raw_snapshot: unknown;
  last_synced_at: string | null;
}

/**
 * A closed dispute whose Shopify node is byte-identical (key order aside) to
 * the one this sync stored last time has nothing to apply. Re-applying it
 * cost ~0.4 s of DB round trips per dispute, every hour, for every dispute
 * a shop ever had (614 on 6a8848-dd) — that pushed the sync job to the
 * worker's 300 s limit. Open disputes are never skipped, and every closed
 * dispute is still fully re-applied once a day.
 */
export function isUnchangedClosedDispute(
  stored: StoredDisputeRow | undefined,
  redactedNode: Record<string, unknown>,
  nowMs: number,
): boolean {
  if (!stored) return false;
  const nodeStatus = String(redactedNode.status ?? "").toLowerCase();
  if (!CLOSED_STATUSES.has(nodeStatus)) return false;
  if (!CLOSED_STATUSES.has(String(stored.status ?? "").toLowerCase())) return false;
  if (!stored.last_synced_at || nowMs - new Date(stored.last_synced_at).getTime() >= FULL_RESYNC_MS) return false;
  if (stored.raw_snapshot == null) return false;
  return stableStringify(stored.raw_snapshot) === stableStringify(redactedNode);
}

/**
 * Real changes only. `updated` counts every re-applied dispute, so any shop
 * with an open dispute always read as drifting and the reconcile cadence
 * never left its 1 h floor. Webhooks carry live changes; the sync is the
 * safety net, so a quiet shop may drift toward the 6 h ceiling.
 */
export function syncDriftDetected(result: Pick<SyncResult, "created" | "changed">): boolean {
  return result.created > 0 || (result.changed ?? 0) > 0;
}

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

/**
 * Sync all disputes for a shop from Shopify.
 */
export async function syncDisputes(
  shopId: string,
  opts?: {
    triggerAutomation?: boolean;
    correlationId?: string;
    /** Scheduled job only: skip closed disputes Shopify has not changed.
     *  A merchant's manual sync always re-applies everything. */
    skipUnchangedClosed?: boolean;
  }
): Promise<SyncResult> {
  const sb = getServiceClient();
  const triggerAutomation = opts?.triggerAutomation ?? true;
  const skipUnchangedClosed = opts?.skipUnchangedClosed ?? false;

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

  // Load through loadSession + ensureFreshSession rather than reading
  // shop_sessions directly. Expiring offline tokens live ONE HOUR; this
  // function used to grab whatever ciphertext was stored and use it
  // regardless of `expires_at`. On a shop with no other Shopify traffic
  // to trigger a refresh, that meant every sync after the first hour
  // authenticated with a dead token — ~50% of runs failing for 20 hours
  // on 6a8848-dd (2026-08-30) while still reporting "succeeded", because
  // the GraphQL error lands in `result.errors` instead of throwing.
  const stored = await loadSession(shopId, "offline");
  if (!stored) throw new Error(`No offline session for shop ${shopId}`);
  const session = await ensureFreshSession(stored);
  const accessToken = session.accessToken;

  const result: SyncResult = { synced: 0, created: 0, updated: 0, errors: [] };
  let hasNextPage = true;
  let after: string | null = null;
  let firstPageEdgesCount: number | null = null;
  const snapshotCandidates: SnapshotCandidate[] = [];

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

    // One read per page of the rows this sync stored last time, so unchanged
    // closed disputes can be skipped without a per-dispute round trip.
    const storedByGid = new Map<string, StoredDisputeRow>();
    if (skipUnchangedClosed) {
      const gids = edges.map((e) => e.node.id);
      const { data: storedRows } = await sb
        .from("disputes")
        .select("dispute_gid, status, raw_snapshot, last_synced_at")
        .eq("shop_id", shopId)
        .in("dispute_gid", gids);
      for (const r of (storedRows ?? []) as Array<StoredDisputeRow & { dispute_gid: string }>) {
        storedByGid.set(r.dispute_gid, r);
      }
    }
    const pageNowMs = Date.now();

    for (const edge of edges) {
      const d = edge.node;
      try {
        if (skipUnchangedClosed && isUnchangedClosedDispute(storedByGid.get(d.id), redactPII(d), pageNowMs)) {
          result.skippedUnchanged = (result.skippedUnchanged ?? 0) + 1;
          after = edge.cursor;
          continue;
        }
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
        if (applyResult.created || applyResult.outcome === "applied") {
          result.changed = (result.changed ?? 0) + 1;
        }
        if (applyResult.localDisputeId) {
          snapshotCandidates.push({
            disputeId: applyResult.localDisputeId,
            status: d.status?.toLowerCase() ?? null,
          });
        }
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

  // Observe-only evidence snapshots (retained-evidence plan §1). After the
  // page loop, so every reopen in this run is already reconciled. Failures
  // are reported in the audit, never counted as sync errors (they must not
  // tighten the reconcile cadence).
  let evidenceSnapshotStats: { read: number; inserted: number; confirmed: number; errors: number } | null = null;
  if (evidenceSnapshotsEnabled() && snapshotCandidates.length > 0) {
    try {
      const snap = await recordEvidenceSnapshots(sb, shopId, snapshotCandidates, {
        read: (disputeEvidenceGid) =>
          readEvidenceRecord({
            shopDomain: shop.shop_domain,
            accessToken,
            disputeEvidenceGid,
            correlationId: opts?.correlationId,
          }),
      });
      evidenceSnapshotStats = { read: snap.read, inserted: snap.inserted, confirmed: snap.confirmed, errors: snap.errors.length };
      if (snap.errors.length) console.warn("[syncDisputes] evidence snapshots", snap.errors.slice(0, 5));
    } catch (err) {
      console.warn("[syncDisputes] evidence snapshots failed", err instanceof Error ? err.message : String(err));
    }
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
      skipped_unchanged: result.skippedUnchanged ?? 0,
      changed: result.changed ?? 0,
      evidence_snapshots: evidenceSnapshotStats,
      correlation_id: opts?.correlationId,
    },
  });

  // Adaptive cadence: tighten on drift, loosen on clean runs.
  await recordReconcileOutcome({
    shopId,
    driftDetected: syncDriftDetected(result),
    hadErrors: result.errors.length > 0,
  });

  return result;
}
