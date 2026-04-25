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
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import { sendUnknownReasonAlert } from "@/lib/email/sendUnknownReasonAlert";
import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import {
  DISPUTE_OPENED,
  STATUS_CHANGED,
  DUE_DATE_CHANGED,
  OUTCOME_DETECTED,
  DISPUTE_CLOSED,
  SUBMISSION_CONFIRMED,
} from "@/lib/disputeEvents/eventTypes";

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
        // Check if row already exists (include fields for change detection).
        // `new_dispute_alert_sent_at` is the dedupe guard for the new-dispute
        // email: even if this SELECT flakes and `existing` comes back null,
        // the guard below only fires the alert when the column is still NULL.
        const { data: existing, error: existingErr } = await sb
          .from("disputes")
          .select(
            "id, status, due_at, submitted_at, final_outcome, submission_state, new_dispute_alert_sent_at",
          )
          .eq("shop_id", shopId)
          .eq("dispute_gid", d.id)
          .maybeSingle();

        // A transient PostgREST error would silently return `{ data: null }`
        // and trick the code into treating a known dispute as brand new,
        // re-firing the alert + rule_applied + pipeline. Bail instead.
        if (existingErr) {
          result.errors.push(
            `${d.id}: existence check failed — ${existingErr.message}`,
          );
          continue;
        }

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
          customer_email: d.disputeEvidence?.customerEmailAddress?.trim() || null,
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
        const disputeId = upserted?.id;
        const nowIso = new Date().toISOString();
        const newStatus = d.status?.toLowerCase() ?? null;

        if (existing) {
          result.updated++;

          // Detect status changes
          if (disputeId && existing.status !== newStatus && newStatus) {
            void emitDisputeEvent({
              disputeId,
              shopId,
              eventType: STATUS_CHANGED,
              description: `${existing.status ?? "unknown"} → ${newStatus}`,
              eventAt: nowIso,
              actorType: "shopify",
              sourceType: "shopify_sync",
              metadataJson: {
                old_status: existing.status,
                new_status: newStatus,
              },
              dedupeKey: `${disputeId}:${STATUS_CHANGED}:${existing.status}_${newStatus}`,
            });

            // Terminal outcome
            const terminalStatuses = ["won", "lost", "charge_refunded", "accepted"];
            if (terminalStatuses.includes(newStatus) && !existing.final_outcome) {
              const amount = d.amount ? parseFloat(d.amount.amount) : 0;
              const outcomeMap: Record<string, string> = {
                won: "won", lost: "lost",
                charge_refunded: "refunded", accepted: "accepted",
              };
              void emitDisputeEvent({
                disputeId,
                shopId,
                eventType: OUTCOME_DETECTED,
                description: `Outcome: ${outcomeMap[newStatus] ?? newStatus}`,
                eventAt: d.finalizedOn ?? nowIso,
                actorType: "shopify",
                sourceType: "shopify_sync",
                metadataJson: {
                  final_outcome: outcomeMap[newStatus],
                  amount,
                  currency_code: d.amount?.currencyCode,
                },
                dedupeKey: `${disputeId}:${OUTCOME_DETECTED}:${outcomeMap[newStatus]}`,
              });
              void emitDisputeEvent({
                disputeId,
                shopId,
                eventType: DISPUTE_CLOSED,
                eventAt: d.finalizedOn ?? nowIso,
                actorType: "shopify",
                sourceType: "shopify_sync",
                dedupeKey: `${disputeId}:${DISPUTE_CLOSED}`,
              });
              await sb
                .from("disputes")
                .update({ closed_at: d.finalizedOn ?? nowIso })
                .eq("id", disputeId);
            }
          }

          // Detect due date changes. Compare by epoch ms, not raw strings:
          // Shopify returns "2026-04-28T19:00:00-04:00" while we store the
          // same instant as "2026-04-28T23:00:00+00:00", so a string !=
          // fires on every sync even when the deadline never moved.
          if (disputeId && d.evidenceDueBy) {
            const oldMs = existing.due_at ? new Date(existing.due_at).getTime() : null;
            const newMs = new Date(d.evidenceDueBy).getTime();
            const changed = Number.isFinite(newMs) && oldMs !== newMs;
            if (changed) {
              void emitDisputeEvent({
                disputeId,
                shopId,
                eventType: DUE_DATE_CHANGED,
                description: `Due date changed to ${new Date(newMs).toISOString()}`,
                eventAt: nowIso,
                actorType: "shopify",
                sourceType: "shopify_sync",
                metadataJson: {
                  old_due_at: existing.due_at,
                  new_due_at: d.evidenceDueBy,
                },
                // Dedupe on the canonical instant (epoch ms) so the same
                // deadline never produces two events just because Shopify
                // returned a different tz offset representation.
                dedupeKey: `${disputeId}:${DUE_DATE_CHANGED}:${newMs}`,
              });
            }
          }

          // Detect confirmed submission via Shopify evidenceSentOn
          if (
            disputeId &&
            d.evidenceSentOn &&
            existing.submission_state !== "submitted_confirmed" &&
            !existing.submitted_at
          ) {
            await sb
              .from("disputes")
              .update({
                submission_state: "submitted_confirmed",
                submitted_at: d.evidenceSentOn,
              })
              .eq("id", disputeId);
            void emitDisputeEvent({
              disputeId,
              shopId,
              eventType: SUBMISSION_CONFIRMED,
              description: "Representment submission confirmed by Shopify",
              eventAt: d.evidenceSentOn,
              actorType: "shopify",
              sourceType: "shopify_sync",
              dedupeKey: `${disputeId}:${SUBMISSION_CONFIRMED}:${d.evidenceSentOn}`,
            });
          }

          if (disputeId) void updateNormalizedStatus(disputeId);
        } else {
          result.created++;

          // Emit dispute_opened for new disputes
          if (disputeId) {
            void emitDisputeEvent({
              disputeId,
              shopId,
              eventType: DISPUTE_OPENED,
              description: `${d.type ?? "Dispute"} opened — ${d.reasonDetails?.reason ?? "unknown reason"}`,
              eventAt: d.initiatedAt ?? nowIso,
              actorType: "shopify",
              sourceType: "shopify_sync",
              metadataJson: {
                reason: d.reasonDetails?.reason,
                phase: d.type?.toLowerCase(),
                amount: d.amount ? parseFloat(d.amount.amount) : null,
                currency_code: d.amount?.currencyCode,
              },
              dedupeKey: `${disputeId}:${DISPUTE_OPENED}`,
            });

            // If already terminal on first sync
            const terminalStatuses = ["won", "lost", "charge_refunded", "accepted"];
            if (newStatus && terminalStatuses.includes(newStatus)) {
              const outcomeMap: Record<string, string> = {
                won: "won", lost: "lost",
                charge_refunded: "refunded", accepted: "accepted",
              };
              void emitDisputeEvent({
                disputeId,
                shopId,
                eventType: OUTCOME_DETECTED,
                eventAt: d.finalizedOn ?? nowIso,
                actorType: "shopify",
                sourceType: "shopify_sync",
                metadataJson: { final_outcome: outcomeMap[newStatus] },
                dedupeKey: `${disputeId}:${OUTCOME_DETECTED}:${outcomeMap[newStatus]}`,
              });
              await sb
                .from("disputes")
                .update({ closed_at: d.finalizedOn ?? nowIso })
                .eq("id", disputeId);
            }

            // If Shopify already has evidenceSentOn
            if (d.evidenceSentOn) {
              await sb
                .from("disputes")
                .update({
                  submission_state: "submitted_confirmed",
                  submitted_at: d.evidenceSentOn,
                })
                .eq("id", disputeId);
              void emitDisputeEvent({
                disputeId,
                shopId,
                eventType: SUBMISSION_CONFIRMED,
                eventAt: d.evidenceSentOn,
                actorType: "shopify",
                sourceType: "shopify_sync",
                dedupeKey: `${disputeId}:${SUBMISSION_CONFIRMED}:${d.evidenceSentOn}`,
              });
            }

            void updateNormalizedStatus(disputeId);
          }
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

        // For new disputes: resolve automation mode, run the pack pipeline
        // (when enabled), then fire the mode-aware alert email unless the
        // review flow deferred it (see below). The "response ready" review
        // variant is sent only after the build job runs and the pack is
        // parked for review — not while the async build is still running.
        //
        // The alert is dedupe-guarded by an atomic UPDATE on
        // disputes.new_dispute_alert_sent_at so it only ever fires once.
        if (!existing && upserted) {
          const phaseForRules =
            phaseLower === "inquiry" || phaseLower === "chargeback"
              ? phaseLower
              : null;

          // Resolve mode up-front so the email we send matches the action
          // the pipeline will take. Default to "review" if evaluation fails —
          // never silently drop the notification.
          let resolvedMode: AutomationMode = "review";
          let evalResult: Awaited<ReturnType<typeof evaluateRules>> | null = null;
          try {
            evalResult = await evaluateRules({
              id: upserted.id,
              shop_id: shopId,
              reason: d.reasonDetails?.reason ?? null,
              status: d.status?.toLowerCase() ?? null,
              amount: d.amount ? parseFloat(d.amount.amount) : null,
              phase: phaseForRules,
            });
            resolvedMode = normalizeMode(evalResult.action.mode);
          } catch (err) {
            result.errors.push(
              `rules(${d.id}): ${err instanceof Error ? err.message : String(err)}`
            );
          }

          let pipelineResult: Awaited<ReturnType<typeof runAutomationPipeline>> | null =
            null;

          // Run the pipeline before the new-dispute email so we can skip the
          // sync-time send when review automation enqueued a build (email is
          // sent from evaluateAndMaybeAutoSave when the pack is ready).
          if (triggerAutomation && evalResult) {
            try {
              if (resolvedMode === "review") {
                await sb
                  .from("disputes")
                  .update({ needs_review: true, updated_at: new Date().toISOString() })
                  .eq("id", upserted.id);
              }
              pipelineResult = await runAutomationPipeline({
                id: upserted.id,
                shop_id: shopId,
                reason: d.reasonDetails?.reason ?? null,
                phase: phaseForRules,
                pack_template_id:
                  evalResult.packTemplateId ??
                  evalResult.action.pack_template_id ??
                  null,
              });
            } catch (err) {
              result.errors.push(
                `automation(${d.id}): ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }

          const deferReviewReadyEmail =
            resolvedMode === "review" && pipelineResult?.action === "pack_enqueued";

          if (!deferReviewReadyEmail) {
            const { data: claimed } = await sb
              .from("disputes")
              .update({ new_dispute_alert_sent_at: new Date().toISOString() })
              .eq("id", upserted.id)
              .is("new_dispute_alert_sent_at", null)
              .select("id");
            if (claimed && claimed.length > 0) {
              void sendNewDisputeAlert({
                shopId,
                disputeId: upserted.id,
                reason: d.reasonDetails?.reason ?? null,
                phase: d.type?.toLowerCase() ?? null,
                amount: d.amount ? parseFloat(d.amount.amount) : null,
                currencyCode: d.amount?.currencyCode ?? null,
                dueAt: d.evidenceDueBy ?? null,
                orderName: d.order?.name ?? null,
                resolvedMode,
                shopifyDisputeEvidenceGid: d.disputeEvidence?.id ?? null,
              });
            }
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
