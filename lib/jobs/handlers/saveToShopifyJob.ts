/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence from a pack to Shopify via the disputeEvidenceUpdate
 * GraphQL mutation. Requires an offline session (auto-save path) or
 * online session (manual save path).
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";

import type { ClaimedJob } from "../claimJobs";

const EVIDENCE_UPDATE_MUTATION = `
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    shopifyPaymentsDisputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence { id }
      userErrors { field message }
    }
  }
`;

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
    .select("id, dispute_evidence_gid")
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
    .single();
  if (!session) throw new Error(`No offline session for shop ${pack.shop_id}`);

  const accessToken = session.access_token_encrypted;
  const packJson = (pack.pack_json ?? {}) as Record<string, unknown>;

  // Map internal pack fields to Shopify evidence input
  const input: Record<string, unknown> = {};
  if (packJson.shipping_tracking) {
    input.shippingDocumentation = JSON.stringify(packJson.shipping_tracking);
  }
  if (packJson.refund_policy) {
    input.refundPolicyDisclosure = JSON.stringify(packJson.refund_policy);
  }
  if (packJson.order_confirmation) {
    input.accessActivityLog = JSON.stringify(packJson.order_confirmation);
  }
  if (packJson.customer_communication) {
    input.customerCommunication = JSON.stringify(
      packJson.customer_communication
    );
  }

  const result = await requestShopifyGraphQL<{
    shopifyPaymentsDisputeEvidenceUpdate: {
      disputeEvidence: { id: string } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>({
    session: { shopDomain: session.shop_domain ?? "", accessToken },
    query: EVIDENCE_UPDATE_MUTATION,
    variables: { id: dispute.dispute_evidence_gid, input },
    correlationId: `save-${job.id}`,
  });

  const mutation = result.data?.shopifyPaymentsDisputeEvidenceUpdate;
  const userErrors = mutation?.userErrors ?? [];

  if (userErrors.length > 0) {
    await sb.from("audit_events").insert({
      shop_id: pack.shop_id,
      dispute_id: pack.dispute_id,
      pack_id: packId,
      actor_type: "system",
      event_type: "save_to_shopify_failed",
      event_payload: { user_errors: userErrors, job_id: job.id },
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

  await sb.from("audit_events").insert({
    shop_id: pack.shop_id,
    dispute_id: pack.dispute_id,
    pack_id: packId,
    actor_type: "system",
    event_type: "evidence_saved_to_shopify",
    event_payload: {
      evidence_gid: dispute.dispute_evidence_gid,
      fields_sent: Object.keys(input),
      job_id: job.id,
    },
  });
}
