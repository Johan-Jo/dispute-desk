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

export interface BuildResult {
  packId: string;
  status: "ready" | "failed";
  completenessScore: number;
  blockers: string[];
  sectionsCollected: number;
  itemsCreated: number;
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
  let order: OrderDetailNode | null = null;
  if (dispute.order_gid) {
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
    } catch (err) {
      // Non-fatal — collectors that need the order will receive null
      // and return empty sections, the build continues with whatever
      // policy + manual evidence exists.
      console.warn(
        "[buildPack] order fetch failed:",
        err instanceof Error ? err.message : String(err),
      );
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

  // Packs are always "ready" after successful build. Blockers are
  // metadata only — they gate auto-save, not pack creation.
  const packStatus = "ready" as const;

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

  // Update the pack row (dual-write: v1 checklist + v2 checklist)
  await sb
    .from("evidence_packs")
    .update({
      status: packStatus as string,
      pack_json: packJson,
      completeness_score: completenessV2.completenessScore,
      checklist: completenessV2.legacyChecklist,
      blockers: completenessV2.legacyBlockers,
      recommended_actions: completenessV2.legacyRecommendedActions,
      checklist_v2: completenessV2.checklist,
      submission_readiness: completenessV2.submissionReadiness,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return {
    packId,
    status: packStatus,
    completenessScore: completeness.score,
    blockers: completeness.blockers,
    sectionsCollected: allSections.length,
    itemsCreated,
  };
}
