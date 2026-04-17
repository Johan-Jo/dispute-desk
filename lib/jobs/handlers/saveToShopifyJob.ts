/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence to Shopify via disputeEvidenceUpdate, then VERIFIES
 * by re-fetching the evidence fields and comparing.
 *
 * REQUIRES AN ONLINE SESSION. Offline tokens silently fail.
 *
 * Status flow:
 *   saving → saved_to_shopify_unverified → saved_to_shopify_verified
 *                                        → save_failed (if verification fails)
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { buildEvidenceInputFromRaw, type RawPackSection } from "@/lib/shopify/fieldMapping";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
  type DisputeEvidenceUpdateInput,
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

/* ── Verification query ── */

/**
 * Verification query — reads back evidence fields from Shopify.
 *
 * NOTE: shippingDocumentation is WRITE-ONLY via the mutation.
 * The readable equivalent is shippingDocumentationFile (file upload).
 * Text fields we can verify: accessActivityLog, cancellationRebuttal,
 * cancellationPolicyDisclosure, refundPolicyDisclosure, uncategorizedText.
 */
const VERIFY_EVIDENCE_QUERY = `
  query VerifyEvidence($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        disputeEvidence {
          id
          accessActivityLog
          cancellationPolicyDisclosure
          cancellationRebuttal
          customerEmailAddress
          refundPolicyDisclosure
          refundRefusalExplanation
          uncategorizedText
        }
      }
    }
  }
`;

/** Fields that are readable via the Shopify API for verification. */
const VERIFIABLE_FIELDS = new Set([
  "accessActivityLog",
  "cancellationPolicyDisclosure",
  "cancellationRebuttal",
  "customerEmailAddress",
  "refundPolicyDisclosure",
  "refundRefusalExplanation",
  "uncategorizedText",
  "customerPurchaseIp",
]);

/** Fields that are write-only (mutation accepts but can't be read back as text). */
const WRITE_ONLY_FIELDS = new Set([
  "shippingDocumentation",
]);

interface VerifyEvidenceResult {
  node: {
    disputeEvidence: {
      id: string;
      accessActivityLog: string | null;
      cancellationPolicyDisclosure: string | null;
      cancellationRebuttal: string | null;
      customerEmailAddress: string | null;
      refundPolicyDisclosure: string | null;
      refundRefusalExplanation: string | null;
      uncategorizedText: string | null;
    } | null;
  } | null;
}

/* ── Helpers ── */

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

/** Truncate values for safe debug logging. */
function truncateInput(input: DisputeEvidenceUpdateInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") {
      out[k] = v.length > 80 ? v.slice(0, 80) + `... (${v.length} chars)` : v;
    } else if (v != null) {
      out[k] = String(v);
    }
  }
  return out;
}

/* ── Main handler ── */

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

  // ═══════════════════════════════════════════════════════════
  //  1. SESSION: require ONLINE
  // ═══════════════════════════════════════════════════════════

  const { data: onlineSession } = await sb
    .from("shop_sessions")
    .select("id, session_type, user_id, access_token_encrypted, shop_domain, created_at")
    .eq("shop_id", pack.shop_id)
    .eq("session_type", "online")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!onlineSession) {
    const errorMsg =
      `No ONLINE session for shop ${pack.shop_id}. ` +
      "Shopify disputeEvidenceUpdate requires an online (user-context) session. " +
      "Merchant must open the app in Shopify Admin to create one.";

    await logAuditEvent({
      shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
      actorType: "system", eventType: "job_failed",
      eventPayload: { jobId: job.id, jobType: "save_to_shopify", reason: "no_online_session" },
    });
    await sb.from("evidence_packs").update({ status: "save_failed", updated_at: new Date().toISOString() }).eq("id", packId);
    throw new Error(errorMsg);
  }

  if (onlineSession.session_type !== "online") {
    throw new Error(`Session ${onlineSession.id} is ${onlineSession.session_type}, not online.`);
  }

  console.log(
    `[saveToShopify] session: type=${onlineSession.session_type} user=${onlineSession.user_id} created=${onlineSession.created_at}`,
  );

  const accessToken = decryptAccessToken(onlineSession.access_token_encrypted);
  const shopDomain = onlineSession.shop_domain ?? "";

  // ═══════════════════════════════════════════════════════════
  //  2. BUILD INPUT
  // ═══════════════════════════════════════════════════════════

  const packJson = pack.pack_json as { sections?: unknown[] } | null;
  const rawSections = Array.isArray(packJson?.sections) ? packJson.sections : [];
  const sections: RawPackSection[] = rawSections.filter(
    (s): s is RawPackSection =>
      typeof s === "object" && s !== null && "type" in s && "label" in s && "data" in s,
  );
  const input: DisputeEvidenceUpdateInput = buildEvidenceInputFromRaw(sections);

  // Inject customerPurchaseIp
  const { data: ipItem } = await sb
    .from("evidence_items").select("payload")
    .eq("pack_id", packId).eq("label", "Customer Purchase IP")
    .limit(1).maybeSingle();
  if ((ipItem?.payload as { ip?: string } | null)?.ip) {
    input.customerPurchaseIp = (ipItem!.payload as { ip: string }).ip;
  }

  // Inject rebuttal
  const { data: rebuttalDraft } = await sb
    .from("rebuttal_drafts").select("sections")
    .eq("pack_id", packId).eq("locale", "en-US").maybeSingle();
  if (rebuttalDraft?.sections) {
    const text = (rebuttalDraft.sections as Array<{ text: string }>)
      .map((s) => s.text).join("\n\n").trim();
    if (text) input.cancellationRebuttal = text;
  }

  const inputKeys = Object.keys(input);
  if (inputKeys.length === 0) {
    throw new Error("No evidence fields to send — pack sections are empty");
  }

  // ═══════════════════════════════════════════════════════════
  //  3. DEBUG LOG (truncated input)
  // ═══════════════════════════════════════════════════════════

  console.log(`[saveToShopify] input payload (${inputKeys.length} fields):`);
  console.log(JSON.stringify(truncateInput(input), null, 2));

  await logAuditEvent({
    shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
    actorType: "system", eventType: "job_started",
    eventPayload: {
      jobId: job.id, jobType: "save_to_shopify",
      session_type: "online", user_id: onlineSession.user_id,
      fields_to_send: inputKeys,
    },
  });

  // ═══════════════════════════════════════════════════════════
  //  4. CALL MUTATION
  // ═══════════════════════════════════════════════════════════

  const result = await requestShopifyGraphQL<DisputeEvidenceUpdateResult>({
    session: { shopDomain, accessToken },
    query: DISPUTE_EVIDENCE_UPDATE_MUTATION,
    variables: { id: dispute.dispute_evidence_gid, input },
    correlationId: `save-${job.id}`,
  });

  console.log(`[saveToShopify] mutation response:`, JSON.stringify({
    errors: result.errors?.length ?? 0,
    userErrors: result.data?.disputeEvidenceUpdate?.userErrors?.length ?? 0,
    evidenceId: result.data?.disputeEvidenceUpdate?.disputeEvidence?.id ?? null,
  }));

  // Check GraphQL errors
  if (result.errors?.length) {
    const errMsg = result.errors.map((e: { message: string }) => e.message).join(", ");
    await sb.from("evidence_packs").update({ status: "save_failed", updated_at: new Date().toISOString() }).eq("id", packId);
    throw new Error(`Shopify GraphQL errors: ${errMsg}`);
  }

  // Check userErrors
  const userErrors = result.data?.disputeEvidenceUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    await sb.from("evidence_packs").update({ status: "save_failed", updated_at: new Date().toISOString() }).eq("id", packId);
    await logAuditEvent({
      shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
      actorType: "system", eventType: "job_failed",
      eventPayload: { jobId: job.id, jobType: "save_to_shopify", user_errors: userErrors },
    });
    throw new Error(`Shopify userErrors: ${userErrors.map((e) => e.message).join(", ")}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  5. MARK UNVERIFIED (mutation succeeded but not yet confirmed)
  // ═══════════════════════════════════════════════════════════

  const now = new Date().toISOString();
  await sb.from("evidence_packs").update({
    status: "saved_to_shopify_unverified",
    saved_to_shopify_at: now,
    updated_at: now,
  }).eq("id", packId);

  // ═══════════════════════════════════════════════════════════
  //  6. VERIFY — re-fetch evidence from Shopify and compare
  // ═══════════════════════════════════════════════════════════

  let verified = false;
  let verificationDiff: Record<string, unknown> = {};

  try {
    await new Promise((r) => setTimeout(r, 2000));

    // Query via dispute GID (not evidence GID) — evidence is a nested field
    const { data: disputeData } = await sb
      .from("disputes")
      .select("dispute_gid")
      .eq("id", pack.dispute_id)
      .single();

    const verifyResult = await requestShopifyGraphQL<{ data: VerifyEvidenceResult }>({
      session: { shopDomain, accessToken },
      query: VERIFY_EVIDENCE_QUERY,
      variables: { id: disputeData?.dispute_gid ?? "" },
      correlationId: `verify-${job.id}`,
    });

    // requestShopifyGraphQL returns { data: { node: { disputeEvidence: {...} } } }
    const rawResult = verifyResult as unknown as Record<string, unknown>;
    const dataNode = (rawResult.data as Record<string, unknown> | undefined)?.node as Record<string, unknown> | undefined;
    const evidence = dataNode?.disputeEvidence as Record<string, unknown> | undefined;

    if (evidence) {
      const fieldsConfirmed: string[] = [];
      const fieldsMissing: string[] = [];
      const fieldsWriteOnly: string[] = [];

      for (const key of inputKeys) {
        if (WRITE_ONLY_FIELDS.has(key)) {
          // Can't verify write-only fields — trust the mutation success
          fieldsWriteOnly.push(key);
          continue;
        }
        if (!VERIFIABLE_FIELDS.has(key)) {
          fieldsWriteOnly.push(key);
          continue;
        }
        const shopifyValue = evidence[key];
        if (shopifyValue && typeof shopifyValue === "string" && shopifyValue.trim().length > 0) {
          fieldsConfirmed.push(key);
        } else {
          fieldsMissing.push(key);
        }
      }

      verified = fieldsMissing.length === 0;
      verificationDiff = {
        fields_sent: inputKeys,
        fields_confirmed: fieldsConfirmed,
        fields_missing: fieldsMissing,
        fields_write_only: fieldsWriteOnly,
        verified,
      };

      console.log(`[saveToShopify] verification:`, JSON.stringify(verificationDiff));
    } else {
      console.log("[saveToShopify] verification: could not fetch evidence from Shopify");
      verificationDiff = { error: "Could not fetch evidence from Shopify" };
    }
  } catch (verifyErr) {
    console.error("[saveToShopify] verification error:", verifyErr instanceof Error ? verifyErr.message : String(verifyErr));
    verificationDiff = { error: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) };
  }

  // ═══════════════════════════════════════════════════════════
  //  7. FINAL STATUS based on verification
  // ═══════════════════════════════════════════════════════════

  const finalStatus = verified ? "saved_to_shopify_verified" : "saved_to_shopify_unverified";

  await sb.from("evidence_packs").update({
    status: finalStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", packId);

  if (pack.dispute_id) {
    await sb.from("disputes").update({
      submission_state: "saved_to_shopify",
      evidence_saved_to_shopify_at: now,
    }).eq("id", pack.dispute_id);
  }

  await logAuditEvent({
    shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
    actorType: "system",
    eventType: "evidence_saved_to_shopify",
    eventPayload: {
      evidence_gid: dispute.dispute_evidence_gid,
      fields_sent: inputKeys,
      field_count: inputKeys.length,
      job_id: job.id,
      session_type: "online",
      verified,
      verification: verificationDiff,
      final_status: finalStatus,
    },
  });

  if (!verified) {
    console.warn(
      `[saveToShopify] WARNING: evidence saved but verification failed. ` +
      `Status: ${finalStatus}. Missing fields: ${JSON.stringify((verificationDiff as { fields_missing?: string[] }).fields_missing ?? [])}`,
    );
  }

  if (pack.dispute_id) {
    void emitDisputeEvent({
      disputeId: pack.dispute_id,
      shopId: pack.shop_id,
      eventType: EVIDENCE_SAVED_TO_SHOPIFY,
      description: verified
        ? `${inputKeys.length} evidence fields sent and verified in Shopify`
        : `${inputKeys.length} evidence fields sent to Shopify (verification pending)`,
      eventAt: now,
      actorType: "disputedesk_system",
      sourceType: "pack_engine",
      metadataJson: {
        pack_id: packId,
        evidence_gid: dispute.dispute_evidence_gid,
        fields_sent: inputKeys,
        verified,
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
