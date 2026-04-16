/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence from a pack to Shopify via the disputeEvidenceUpdate
 * GraphQL mutation using the field mapping engine.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { buildEvidenceInputFromRaw, type RawPackSection } from "@/lib/shopify/fieldMapping";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
} from "@/lib/shopify/mutations/disputeEvidenceUpdate";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendPackSavedAlert } from "@/lib/email/sendPackSavedAlert";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import {
  EVIDENCE_SAVED_TO_SHOPIFY,
  EVIDENCE_SAVE_FAILED,
} from "@/lib/disputeEvents/eventTypes";
import type { ClaimedJob } from "../claimJobs";

function decryptAccessToken(encrypted: string): string {
  try {
    return decrypt(deserializeEncrypted(encrypted));
  } catch {
    return encrypted;
  }
}

export async function handleSaveToShopify(job: ClaimedJob): Promise<void> {
  const sb = getServiceClient();
  const packId = job.entityId;
  if (!packId) throw new Error("No entity_id (pack ID) on save_to_shopify job");

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, pack_json")
    .eq("id", packId)
    .single();
  if (!pack) throw new Error(`Pack not found: ${packId}`);

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, dispute_evidence_gid, reason, amount, currency_code")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute?.dispute_evidence_gid) {
    throw new Error("Dispute has no evidence GID — cannot save to Shopify");
  }

  const { data: session } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted, key_version, shop_domain")
    .eq("shop_id", pack.shop_id)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) throw new Error(`No offline session for shop ${pack.shop_id}`);

  const accessToken = decryptAccessToken(session.access_token_encrypted);
  const packJson = pack.pack_json as { sections?: unknown[] } | null;
  const rawSections = Array.isArray(packJson?.sections) ? packJson.sections : [];
  const sections: RawPackSection[] = rawSections.filter(
    (s): s is RawPackSection =>
      typeof s === "object" && s !== null && "type" in s && "label" in s && "data" in s,
  );
  const input = buildEvidenceInputFromRaw(sections);

  // Inject customerPurchaseIp if available in evidence items.
  // Shopify's disputeEvidenceUpdate accepts this as a standalone field.
  const { data: ipItem } = await sb
    .from("evidence_items")
    .select("payload")
    .eq("pack_id", packId)
    .eq("label", "Customer Purchase IP")
    .limit(1)
    .maybeSingle();
  const customerIp = (ipItem?.payload as { ip?: string } | null)?.ip;
  if (customerIp) {
    input.customerPurchaseIp = customerIp;
  }

  if (Object.keys(input).length === 0) {
    throw new Error("No evidence fields to send — pack sections are empty");
  }

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "system",
    eventType: "job_started",
    eventPayload: { jobId: job.id, jobType: "save_to_shopify" },
  });

  const result = await requestShopifyGraphQL<DisputeEvidenceUpdateResult>({
    session: { shopDomain: session.shop_domain ?? "", accessToken },
    query: DISPUTE_EVIDENCE_UPDATE_MUTATION,
    variables: { id: dispute.dispute_evidence_gid, input },
    correlationId: `save-${job.id}`,
  });

  // Check for GraphQL-level errors (auth failures, network issues, etc.)
  if (result.errors?.length) {
    const errMsg = result.errors.map((e: { message: string }) => e.message).join(", ");
    await sb
      .from("evidence_packs")
      .update({ status: "save_failed", updated_at: new Date().toISOString() })
      .eq("id", packId);
    throw new Error(`Shopify GraphQL errors: ${errMsg}`);
  }

  const mutation = result.data?.disputeEvidenceUpdate;
  const userErrors = mutation?.userErrors ?? [];

  if (userErrors.length > 0) {
    await sb
      .from("evidence_packs")
      .update({ status: "save_failed", updated_at: new Date().toISOString() })
      .eq("id", packId);

    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        user_errors: userErrors,
      },
    });

    if (pack.dispute_id) {
      void emitDisputeEvent({
        disputeId: pack.dispute_id,
        shopId: pack.shop_id,
        eventType: EVIDENCE_SAVE_FAILED,
        description: userErrors.map((e) => e.message).join(", "),
        eventAt: new Date().toISOString(),
        actorType: "disputedesk_system",
        sourceType: "pack_engine",
        visibility: "internal_only",
        metadataJson: { pack_id: packId, user_errors: userErrors },
        dedupeKey: `${pack.dispute_id}:${EVIDENCE_SAVE_FAILED}:${packId}:${new Date().toISOString()}`,
      });
    }

    throw new Error(
      `Shopify userErrors: ${userErrors.map((e) => e.message).join(", ")}`
    );
  }

  const now = new Date().toISOString();
  await sb
    .from("evidence_packs")
    .update({
      status: "saved_to_shopify",
      saved_to_shopify_at: now,
      updated_at: now,
    })
    .eq("id", packId);

  // Update dispute submission state (NOT submitted_at — only confirmed submission sets that)
  if (pack.dispute_id) {
    await sb
      .from("disputes")
      .update({
        submission_state: "saved_to_shopify",
        evidence_saved_to_shopify_at: now,
      })
      .eq("id", pack.dispute_id);
  }

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "system",
    eventType: "evidence_saved_to_shopify",
    eventPayload: {
      evidence_gid: dispute.dispute_evidence_gid,
      fields_sent: Object.keys(input),
      job_id: job.id,
    },
  });

  if (pack.dispute_id) {
    void emitDisputeEvent({
      disputeId: pack.dispute_id,
      shopId: pack.shop_id,
      eventType: EVIDENCE_SAVED_TO_SHOPIFY,
      description: `${Object.keys(input).length} evidence fields sent to Shopify`,
      eventAt: now,
      actorType: "disputedesk_system",
      sourceType: "pack_engine",
      metadataJson: {
        pack_id: packId,
        evidence_gid: dispute.dispute_evidence_gid,
        fields_sent: Object.keys(input),
      },
      dedupeKey: `${pack.dispute_id}:${EVIDENCE_SAVED_TO_SHOPIFY}:${packId}`,
    });
    void updateNormalizedStatus(pack.dispute_id);
  }

  // Notify merchant that evidence has been saved — fire-and-forget.
  void sendPackSavedAlert({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    reason: dispute.reason ?? null,
    amount: dispute.amount ?? null,
    currencyCode: dispute.currency_code ?? null,
  });
}
