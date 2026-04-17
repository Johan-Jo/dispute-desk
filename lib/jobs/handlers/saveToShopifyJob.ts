/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence from a pack to Shopify via the disputeEvidenceUpdate
 * GraphQL mutation using the field mapping engine.
 *
 * REQUIRES AN ONLINE SESSION. Shopify's disputeEvidenceUpdate mutation
 * silently ignores input when called with an offline access token.
 * The job will fail loudly if no online session is available.
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
  } catch (err) {
    console.error(
      "[saveToShopify] Failed to decrypt access token:",
      err instanceof Error ? err.message : String(err),
    );
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

  // ── Session retrieval: ONLINE required ──
  // Shopify's disputeEvidenceUpdate mutation silently ignores input
  // when called with an offline token. We must use an online session.
  const { data: onlineSession } = await sb
    .from("shop_sessions")
    .select("id, session_type, user_id, access_token_encrypted, shop_domain, created_at")
    .eq("shop_id", pack.shop_id)
    .eq("session_type", "online")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!onlineSession) {
    const errorMsg = `No ONLINE session available for shop ${pack.shop_id}. ` +
      "Shopify's disputeEvidenceUpdate requires an online (user-context) session. " +
      "A merchant must open the app in Shopify Admin to create an online session.";

    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        reason: "no_online_session",
        message: errorMsg,
      },
    });

    await sb
      .from("evidence_packs")
      .update({ status: "save_failed", updated_at: new Date().toISOString() })
      .eq("id", packId);

    throw new Error(errorMsg);
  }

  // Defensive assertion — should never fail given the query above
  if (onlineSession.session_type !== "online") {
    throw new Error(
      `Session ${onlineSession.id} is ${onlineSession.session_type}, not online. ` +
      "Shopify evidence mutation requires an online user-context session.",
    );
  }

  console.log(
    `[saveToShopify] Using session: shop=${pack.shop_id} ` +
    `type=${onlineSession.session_type} user=${onlineSession.user_id} ` +
    `created=${onlineSession.created_at}`,
  );

  const accessToken = decryptAccessToken(onlineSession.access_token_encrypted);

  // ── Build evidence input ──
  const packJson = pack.pack_json as { sections?: unknown[] } | null;
  const rawSections = Array.isArray(packJson?.sections) ? packJson.sections : [];
  const sections: RawPackSection[] = rawSections.filter(
    (s): s is RawPackSection =>
      typeof s === "object" && s !== null && "type" in s && "label" in s && "data" in s,
  );
  const input = buildEvidenceInputFromRaw(sections);

  // Inject customerPurchaseIp if available
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

  // Inject rebuttal draft into cancellationRebuttal
  const { data: rebuttalDraft } = await sb
    .from("rebuttal_drafts")
    .select("sections")
    .eq("pack_id", packId)
    .eq("locale", "en-US")
    .maybeSingle();
  if (rebuttalDraft?.sections) {
    const rebuttalSections = rebuttalDraft.sections as Array<{ text: string }>;
    const rebuttalText = rebuttalSections.map((s) => s.text).join("\n\n");
    if (rebuttalText.trim()) {
      input.cancellationRebuttal = rebuttalText;
    }
  }

  if (Object.keys(input).length === 0) {
    throw new Error("No evidence fields to send — pack sections are empty");
  }

  const inputKeys = Object.keys(input);
  console.log(
    `[saveToShopify] Sending ${inputKeys.length} fields: ${inputKeys.join(", ")}`,
  );

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "system",
    eventType: "job_started",
    eventPayload: {
      jobId: job.id,
      jobType: "save_to_shopify",
      session_type: onlineSession.session_type,
      fields_to_send: inputKeys,
    },
  });

  // ── Call Shopify mutation ──
  const result = await requestShopifyGraphQL<DisputeEvidenceUpdateResult>({
    session: { shopDomain: onlineSession.shop_domain ?? "", accessToken },
    query: DISPUTE_EVIDENCE_UPDATE_MUTATION,
    variables: { id: dispute.dispute_evidence_gid, input },
    correlationId: `save-${job.id}`,
  });

  // Log full response for debugging
  console.log(
    `[saveToShopify] Shopify response:`,
    JSON.stringify({
      hasErrors: !!result.errors?.length,
      hasUserErrors: !!(result.data?.disputeEvidenceUpdate?.userErrors?.length),
      evidenceId: result.data?.disputeEvidenceUpdate?.disputeEvidence?.id ?? null,
    }),
  );

  // ── Check for GraphQL-level errors ──
  if (result.errors?.length) {
    const errMsg = result.errors.map((e: { message: string }) => e.message).join(", ");
    await sb
      .from("evidence_packs")
      .update({ status: "save_failed", updated_at: new Date().toISOString() })
      .eq("id", packId);
    throw new Error(`Shopify GraphQL errors: ${errMsg}`);
  }

  // ── Check for userErrors ──
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
      `Shopify userErrors: ${userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  // ── Success ──
  const now = new Date().toISOString();
  await sb
    .from("evidence_packs")
    .update({
      status: "saved_to_shopify",
      saved_to_shopify_at: now,
      updated_at: now,
    })
    .eq("id", packId);

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
      fields_sent: inputKeys,
      field_count: inputKeys.length,
      job_id: job.id,
      session_type: onlineSession.session_type,
    },
  });

  if (pack.dispute_id) {
    void emitDisputeEvent({
      disputeId: pack.dispute_id,
      shopId: pack.shop_id,
      eventType: EVIDENCE_SAVED_TO_SHOPIFY,
      description: `${inputKeys.length} evidence fields sent to Shopify (${inputKeys.join(", ")})`,
      eventAt: now,
      actorType: "disputedesk_system",
      sourceType: "pack_engine",
      metadataJson: {
        pack_id: packId,
        evidence_gid: dispute.dispute_evidence_gid,
        fields_sent: inputKeys,
      },
      dedupeKey: `${pack.dispute_id}:${EVIDENCE_SAVED_TO_SHOPIFY}:${packId}`,
    });
    void updateNormalizedStatus(pack.dispute_id);
  }

  void sendPackSavedAlert({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    reason: dispute.reason ?? null,
    amount: dispute.amount ?? null,
    currencyCode: dispute.currency_code ?? null,
  });
}
