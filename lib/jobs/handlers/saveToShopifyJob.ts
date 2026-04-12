/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence from a pack to Shopify via the disputeEvidenceUpdate
 * GraphQL mutation using the field mapping engine.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { buildEvidenceInput, type PackSection } from "@/lib/shopify/fieldMapping";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
} from "@/lib/shopify/mutations/disputeEvidenceUpdate";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendPackSavedAlert } from "@/lib/email/sendPackSavedAlert";
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
    .select("id, shop_id, dispute_id, sections")
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
  const sections: PackSection[] = Array.isArray(pack.sections) ? pack.sections : [];
  const input = buildEvidenceInput(sections);

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
