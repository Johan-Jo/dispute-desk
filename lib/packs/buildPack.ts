/**
 * Evidence pack build orchestrator.
 *
 * 1. Loads dispute + shop session data
 * 2. Runs each source collector in parallel
 * 3. Inserts evidence_items rows + audit events
 * 4. Computes completeness score
 * 5. Assembles pack_json and updates the pack row
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  evaluateCompleteness,
  evaluateCompletenessV2,
  type TemplateChecklistItem,
} from "@/lib/automation/completeness";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  ORDER_DETAIL_QUERY,
  type OrderDetailResponse,
  type OrderDetailNode,
} from "@/lib/shopify/queries/orders";
import { collectOrderEvidence } from "./sources/orderSource";
import { collectFulfillmentEvidence } from "./sources/fulfillmentSource";
import { collectPolicyEvidence } from "./sources/policySource";
import { collectManualEvidence } from "./sources/manualSource";
import { collectCustomerCommEvidence } from "./sources/customerCommSource";
import { collectPaymentEvidence } from "./sources/paymentSource";
import type { EvidenceSection, BuildContext } from "./types";
import type { OrderContext } from "@/lib/automation/completeness";

function decryptAccessToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch (err) {
    console.error(
      "[buildPack] Failed to decrypt access token:",
      err instanceof Error ? err.message : String(err),
    );
    // Fall back to raw string — will likely 401 at Shopify
    return encrypted;
  }
}

/**
 * Machine-readable failure codes. Used by the merchant UI to map to
 * safe copy. The internal `failure_reason` (full error text) is kept
 * server-side and never rendered to merchants.
 */
export type PackFailureCode =
  | "order_fetch_failed";

export interface BuildResult {
  packId: string;
  status: "ready" | "failed";
  completenessScore: number;
  blockers: string[];
  sectionsCollected: number;
  itemsCreated: number;
  failureCode: PackFailureCode | null;
}

export async function buildPack(
  packId: string,
  opts?: { correlationId?: string }
): Promise<BuildResult> {
  const sb = getServiceClient();

  // Load pack → dispute → shop + session
  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, pack_template_id")
    .eq("id", packId)
    .single();
  if (packErr || !pack) throw new Error(`Pack not found: ${packId}`);

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, reason, order_gid, dispute_gid")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute) throw new Error(`Dispute not found: ${pack.dispute_id}`);

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("id", pack.shop_id)
    .single();
  if (!shop) throw new Error(`Shop not found: ${pack.shop_id}`);

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", pack.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) throw new Error(`No offline session for shop ${pack.shop_id}`);

  // Fetch the order once and share it across all three
  // order-dependent collectors (orderSource, fulfillmentSource,
  // customerCommSource). Before this, each collector was issuing the
  // same ORDER_DETAIL_QUERY independently — three round-trips per
  // pack build. Cache happens at the shared-context level.
  //
  // If this fetch fails, capture the structured error so the build
  // record self-explains: collectors silently returning [] on null
  // ctx.order is the most common cause of "score 0% / 1 item / pack
  // blocked" pack states. Without this, the actual error lives only
  // in console.warn and is lost when Vercel runtime logs roll over.
  let order: OrderDetailNode | null = null;
  let orderFetchError: { message: string; durationMs: number; gid: string } | null = null;
  if (dispute.order_gid) {
    const fetchStart = Date.now();
    try {
      const res = await requestShopifyGraphQL<OrderDetailResponse>({
        session: {
          shopDomain: shop.shop_domain,
          accessToken: decryptAccessToken(session.access_token_encrypted),
        },
        query: ORDER_DETAIL_QUERY,
        variables: { id: dispute.order_gid },
        correlationId: opts?.correlationId,
      });
      order = (res.data?.node as OrderDetailNode | undefined) ?? null;
      if (!order) {
        orderFetchError = {
          message: res.errors?.length
            ? `Shopify returned errors: ${res.errors.map((e) => e.message).join("; ")}`
            : "Shopify returned null for order node — order may be deleted or inaccessible",
          durationMs: Date.now() - fetchStart,
          gid: dispute.order_gid,
        };
      }
    } catch (err) {
      orderFetchError = {
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - fetchStart,
        gid: dispute.order_gid,
      };
    }

    if (orderFetchError) {
      console.warn(
        `[buildPack] order fetch failed for pack ${packId} (${orderFetchError.durationMs}ms):`,
        orderFetchError.message,
      );
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: dispute.id,
        packId,
        actorType: "system",
        eventType: "order_fetch_failed",
        eventPayload: orderFetchError,
      });
    }
  }

  const ctx: BuildContext = {
    packId,
    disputeId: dispute.id,
    shopId: pack.shop_id,
    disputeReason: dispute.reason,
    orderGid: dispute.order_gid,
    shopDomain: shop.shop_domain,
    accessToken: decryptAccessToken(session.access_token_encrypted),
    correlationId: opts?.correlationId,
    order,
  };

  // Run all collectors concurrently
  const results = await Promise.allSettled([
    collectOrderEvidence(ctx),
    collectFulfillmentEvidence(ctx),
    collectPolicyEvidence(ctx),
    collectCustomerCommEvidence(ctx),
    collectManualEvidence(ctx),
    collectPaymentEvidence(ctx),
  ]);

  const allSections: EvidenceSection[] = [];
  const collectorErrors: string[] = [];

  // Surface the upstream order-fetch failure as a collector error so it
  // shows up on the pack record alongside any individual collector throws.
  if (orderFetchError) {
    collectorErrors.push(
      `order_fetch: ${orderFetchError.message} (${orderFetchError.durationMs}ms, gid=${orderFetchError.gid})`,
    );
  }

  for (const r of results) {
    if (r.status === "fulfilled") {
      allSections.push(...r.value);
    } else {
      collectorErrors.push(
        r.reason instanceof Error ? r.reason.message : String(r.reason)
      );
    }
  }

  // Insert evidence_items for each section
  let itemsCreated = 0;
  for (const section of allSections) {
    const { error: itemErr } = await sb.from("evidence_items").insert({
      pack_id: packId,
      type: section.type,
      label: section.label,
      source: section.source,
      payload: section.data,
    });

    if (!itemErr) {
      itemsCreated++;
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: dispute.id,
        packId,
        actorType: "system",
        eventType: "item_added",
        eventPayload: {
          type: section.type,
          label: section.label,
          source: section.source,
        },
      });
    }
  }

  // Compute completeness
  const collectedFields = new Set<string>();
  for (const s of allSections) {
    for (const f of s.fieldsProvided) collectedFields.add(f);
  }

  // When a matching automation rule installed a template on this
  // pack, load its items so the engine scores against admin-defined
  // requirements instead of the hardcoded REASON_TEMPLATES fallback.
  // Items whose collector_key is NULL are merchant-supplied and
  // counted as satisfied by any manual upload (supporting_documents).
  let templateItems: TemplateChecklistItem[] | null = null;
  const templateId = (pack as { pack_template_id?: string | null })
    .pack_template_id;
  if (templateId) {
    const { data: sections } = await sb
      .from("pack_template_sections")
      .select(
        "id, sort, pack_template_items(key, label_default, required, collector_key, sort)",
      )
      .eq("template_id", templateId)
      .order("sort", { ascending: true });
    const items: TemplateChecklistItem[] = [];
    for (const sec of sections ?? []) {
      const raw = (
        sec as {
          pack_template_items?: Array<{
            key: string;
            label_default: string;
            required: boolean;
            collector_key: string | null;
            sort: number;
          }>;
        }
      ).pack_template_items ?? [];
      const sorted = [...raw].sort((a, b) => a.sort - b.sort);
      for (const it of sorted) {
        items.push({
          key: it.key,
          label: it.label_default,
          required: it.required,
          collector_key: it.collector_key,
        });
      }
    }
    if (items.length > 0) templateItems = items;
  }

  // Derive order context for conditional requirement evaluation
  const isFulfilled =
    order?.displayFulfillmentStatus !== "UNFULFILLED" &&
    (order?.fulfillments?.length ?? 0) > 0;
  const hasCardPayment =
    order?.transactions?.some(
      (t) => t.paymentDetails?.__typename === "CardPaymentDetails",
    ) ?? false;
  // AVS/CVV is only "available" if a card transaction actually returned codes.
  // External gateways (Stripe via Shopify, Adyen, etc.) often return null
  // even for card payments — this must NOT block or penalize the pack.
  const avsCvvAvailable =
    order?.transactions?.some((t) => {
      if (t.paymentDetails?.__typename !== "CardPaymentDetails") return false;
      const d = t.paymentDetails as import("@/lib/shopify/queries/orders").CardPaymentDetails;
      return (
        (d.avsResultCode != null && d.avsResultCode !== "") ||
        (d.cvvResultCode != null && d.cvvResultCode !== "")
      );
    }) ?? false;
  const orderContext: OrderContext = { isFulfilled, hasCardPayment, avsCvvAvailable };

  const completeness = evaluateCompleteness(
    dispute.reason,
    collectedFields,
    templateItems,
    orderContext,
  );

  // V2 evaluation: preserves any waived items from the pack row
  const { data: existingPack } = await sb
    .from("evidence_packs")
    .select("waived_items")
    .eq("id", packId)
    .single();
  const waivedItems = (existingPack?.waived_items ?? []) as import("@/lib/types/evidenceItem").WaivedItemRecord[];

  const completenessV2 = evaluateCompletenessV2(
    dispute.reason,
    collectedFields,
    waivedItems,
    templateItems,
    orderContext,
  );

  // Pack status reflects whether the build itself succeeded as a
  // *system operation*, not whether it has enough evidence:
  //   - failed → upstream/system error (e.g., couldn't load the order
  //     from Shopify). Evidence-gap UI is misleading here.
  //   - ready → build completed; submission_readiness encodes whether
  //     evidence is sufficient to submit.
  const packStatus: "ready" | "failed" = orderFetchError ? "failed" : "ready";
  const failureCode: PackFailureCode | null = orderFetchError ? "order_fetch_failed" : null;
  const failureReason: string | null = orderFetchError ? orderFetchError.message : null;

  // Build the pack_json
  const packJson = {
    version: 1,
    generatedAt: new Date().toISOString(),
    disputeGid: dispute.dispute_gid,
    disputeReason: dispute.reason,
    sections: allSections.map((s) => ({
      type: s.type,
      label: s.label,
      source: s.source,
      fieldsProvided: s.fieldsProvided,
      data: s.data,
    })),
    completeness: {
      score: completeness.score,
      evidenceStrengthScore: completeness.evidenceStrengthScore,
      checklist: completeness.checklist,
      blockers: completeness.blockers,
      recommended_actions: completeness.recommended_actions,
    },
    collectorErrors: collectorErrors.length > 0 ? collectorErrors : undefined,
  };

  // Update the pack row (dual-write: v1 checklist + v2 checklist).
  // failure_code/failure_reason are written every time so a successful
  // rebuild after a failure clears the prior failure markers.
  //
  // INVARIANT: evidence-derived fields (completeness_score, checklist,
  // blockers, recommended_actions, checklist_v2, submission_readiness)
  // are meaningful ONLY when status === "ready". When the build failed
  // as a system operation, we must null these out — otherwise stale or
  // partial values can flow to UIs and auto-save gates and make a
  // failed pack look actionable.
  const isFailed = packStatus === "failed";
  await sb
    .from("evidence_packs")
    .update({
      status: packStatus as string,
      pack_json: packJson,
      completeness_score: isFailed ? 0 : completenessV2.completenessScore,
      checklist: isFailed ? null : completenessV2.legacyChecklist,
      blockers: isFailed ? null : completenessV2.legacyBlockers,
      recommended_actions: isFailed ? null : completenessV2.legacyRecommendedActions,
      checklist_v2: isFailed ? null : completenessV2.checklist,
      submission_readiness: isFailed ? null : completenessV2.submissionReadiness,
      failure_code: failureCode,
      failure_reason: failureReason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return {
    packId,
    status: packStatus,
    completenessScore: isFailed ? 0 : completeness.score,
    blockers: isFailed ? [] : completeness.blockers,
    sectionsCollected: allSections.length,
    itemsCreated,
    failureCode,
  };
}
