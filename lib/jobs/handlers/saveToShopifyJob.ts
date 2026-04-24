/**
 * Job handler: save_to_shopify
 *
 * Pushes evidence to Shopify via disputeEvidenceUpdate, then VERIFIES
 * by re-fetching the evidence fields and comparing.
 *
 * Uses the shop's durable OFFLINE session via `getShopBackgroundSession`.
 * Earlier code insisted this mutation required an ONLINE session, but
 * verified 2026-04-21 (see scripts/verify-offline-evidence-update.mjs):
 * offline tokens successfully call `disputeEvidenceUpdate` with
 * empty `userErrors` — the online requirement was not real.
 *
 * Status flow:
 *   saving → saved_to_shopify_unverified → saved_to_shopify_verified
 *                                        → save_failed (if verification fails
 *                                          or Shopify returns userErrors)
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  assertNotAuthInvalid,
  getShopBackgroundSession,
  ShopifyAuthInvalidError,
} from "@/lib/shopify/sessions/getShopBackgroundSession";
import { type RawPackSection } from "@/lib/shopify/fieldMapping";
import { buildEvidenceForShopify } from "@/lib/shopify/formatEvidenceForShopify";
import {
  formatManualAttachmentsBlock,
  type ManualAttachmentInput,
  type PackPdfInput,
} from "@/lib/shopify/manualAttachments";
import {
  ATTACHMENT_LINK_TTL_DAYS,
  buildAttachmentUrl,
  requireEvidenceLinkSecret,
  signAttachmentToken,
} from "@/lib/links/attachmentLinks";
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
]);

/** Fields that are write-only (mutation accepts but can't be verified via read-back). */
const WRITE_ONLY_FIELDS = new Set([
  "submitEvidence",
  "customerFirstName",
  "customerLastName",
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
    .select("id, shop_id, dispute_id, status, pack_json")
    .eq("id", packId)
    .single();
  if (!pack) throw new Error(`Pack not found: ${packId}`);

  // ═══════════════════════════════════════════════════════════
  //  DEFENSE-IN-DEPTH STATUS GUARD
  //
  //  The API routes (save-to-shopify, approve) already reject
  //  pack.status !== "ready". But a job can also be inserted
  //  directly (internal admin tool, race conditions, future code
  //  paths). Failed packs must never reach Shopify.
  //
  //  Allowed statuses at job-start time:
  //    - "ready"               → approve flow (status unchanged)
  //    - "saving"              → save-to-shopify API flips to this
  //    - "saved_to_shopify"    → pipeline auto-save flips to this
  //
  //  Everything else (failed, queued, building, archived,
  //  save_failed, saved_to_shopify_verified, saved_to_shopify_unverified)
  //  indicates either an invariant violation or a duplicate
  //  submission — bail safely, never call Shopify.
  // ═══════════════════════════════════════════════════════════

  const ALLOWED_STATUSES = new Set(["ready", "saving", "saved_to_shopify"]);
  if (!ALLOWED_STATUSES.has(pack.status as string)) {
    const reason =
      pack.status === "failed"
        ? "pack_status_failed"
        : "pack_status_not_submittable";
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        reason,
        pack_status: pack.status,
      },
    });
    throw new Error(
      `Refusing to save to Shopify: pack status is "${pack.status}", not a submittable state. Shopify was NOT called.`,
    );
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, dispute_evidence_gid, reason, amount, currency_code")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute?.dispute_evidence_gid) {
    throw new Error("Dispute has no evidence GID — cannot save to Shopify");
  }

  // ═══════════════════════════════════════════════════════════
  //  1. SESSION: durable shop-level (offline) — this is background work
  // ═══════════════════════════════════════════════════════════

  const session = await getShopBackgroundSession(pack.shop_id);
  const accessToken = session.accessToken;
  const shopDomain = session.shopDomain;

  // ═══════════════════════════════════════════════════════════
  //  2. BUILD INPUT
  // ═══════════════════════════════════════════════════════════

  const packJson = pack.pack_json as { sections?: unknown[] } | null;
  const rawSections = Array.isArray(packJson?.sections) ? packJson.sections : [];
  const sections: RawPackSection[] = rawSections.filter(
    (s): s is RawPackSection =>
      typeof s === "object" && s !== null && "type" in s && "label" in s && "data" in s,
  );
  // Get rebuttal text
  const { data: rebuttalDraft } = await sb
    .from("rebuttal_drafts").select("sections")
    .eq("pack_id", packId).eq("locale", "en-US").maybeSingle();
  const rebuttalText = rebuttalDraft?.sections
    ? (rebuttalDraft.sections as Array<{ text: string }>).map((s) => s.text).join("\n\n").trim() || null
    : null;

  // Build evidence using reason-aware formatter
  const input: DisputeEvidenceUpdateInput = buildEvidenceForShopify(
    sections,
    rebuttalText,
    dispute.reason,
  );

  // Inject customer info from dispute (only schema-valid fields)
  const { data: disputeExtra } = await sb
    .from("disputes")
    .select("customer_display_name, customer_email")
    .eq("id", pack.dispute_id)
    .single();
  if (disputeExtra?.customer_display_name) {
    // customerName does NOT exist — split into firstName/lastName
    const parts = disputeExtra.customer_display_name.split(" ");
    input.customerFirstName = parts[0] ?? "";
    input.customerLastName = parts.slice(1).join(" ") ?? "";
  }
  if (disputeExtra?.customer_email) {
    input.customerEmailAddress = disputeExtra.customer_email;
  }

  // The raw `customerPurchaseIp` injection that used to live here was
  // removed on 2026-04-21. The IP & Location Check evidence block now
  // owns all IP-related submission text via `formatEvidenceForShopify.ts`,
  // which gates output through `bankEligible`. Raw-dumping the IP string
  // would bypass that gate and leak negative signals (e.g. a Brazilian IP
  // on a US-shipping order) into the bank's view of the case.


  // ═══════════════════════════════════════════════════════════
  //  MANUAL ATTACHMENTS → DisputeDesk URLs in uncategorizedText
  //
  //  Shopify's public Admin API does not let third-party apps attach
  //  files to disputes (see lib/shopify/disputeFileUpload.ts). Instead
  //  we cite time-limited DisputeDesk URLs (`https://disputedesk.app/e/<token>`)
  //  that stream bytes through our origin via `app/e/[token]/route.ts`.
  //  The Supabase storage host is never exposed to the bank.
  //
  //  evidence_items is queried here — not pack_json.sections — because
  //  pack_json is a build-time snapshot and does not include files the
  //  merchant uploaded after the initial build.
  // ═══════════════════════════════════════════════════════════

  const linkSecret = requireEvidenceLinkSecret();
  const linkExp =
    Math.floor(Date.now() / 1000) + ATTACHMENT_LINK_TTL_DAYS * 24 * 60 * 60;

  const { data: manualItems } = await sb
    .from("evidence_items")
    .select("id, label, payload, created_at")
    .eq("pack_id", packId)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: false });

  const manualAttachments: ManualAttachmentInput[] = (manualItems ?? []).map(
    (item) => {
      const meta = (item.payload ?? {}) as Record<string, unknown>;
      const token = signAttachmentToken(
        { k: "item", id: String(item.id), p: packId, exp: linkExp },
        linkSecret,
      );
      return {
        label: (item.label as string | null) ?? null,
        fileName: typeof meta.fileName === "string" ? meta.fileName : null,
        fileSize: typeof meta.fileSize === "number" ? meta.fileSize : null,
        createdAt: (item.created_at as string | null) ?? null,
        url: buildAttachmentUrl(token),
      };
    },
  );

  let pdfAttachment: PackPdfInput | null = null;
  const { data: packForPdf } = await sb
    .from("evidence_packs")
    .select("pdf_path")
    .eq("id", packId)
    .single();
  if (packForPdf?.pdf_path) {
    const token = signAttachmentToken(
      { k: "pdf", id: packId, p: packId, exp: linkExp },
      linkSecret,
    );
    pdfAttachment = { url: buildAttachmentUrl(token) };
  }

  const attachmentsBlock = formatManualAttachmentsBlock(
    manualAttachments,
    pdfAttachment,
  );
  if (attachmentsBlock) {
    input.uncategorizedText = input.uncategorizedText
      ? `${input.uncategorizedText}\n\n${attachmentsBlock}`
      : attachmentsBlock;
  }


  // ═══════════════════════════════════════════════════════════
  //  REST-ONLY FIELDS (not available via GraphQL)
  //
  //  Shopify's GraphQL schema rejects: product_description,
  //  shipping_carrier, shipping_tracking_number, shipping_date.
  //  But the REST PUT /dispute_evidences.json endpoint accepts them.
  //
  //  File uploads are not available via any currently-public Shopify
  //  API path (verified 2026-04-21). REST
  //  /shopify_payments/disputes/:id/dispute_file_uploads.json returns
  //  HTTP 404 on 2024-10 / 2025-04 / 2026-01. GraphQL stagedUploadsCreate
  //  rejects the DISPUTE_FILE_UPLOAD resource. All evidence is therefore
  //  text-only. See lib/shopify/disputeFileUpload.ts for the full record.
  // ═══════════════════════════════════════════════════════════

  const restOnlyFields: Record<string, string> = {};

  // Product description from line items
  const orderSections = sections.filter(s => s.type === "order");
  for (const s of orderSections) {
    const items = s.data?.lineItems as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      const desc = items.map(li => {
        const parts: string[] = [];
        if (li.title) parts.push(`Product name: ${String(li.title)}`);
        if (li.variantTitle) parts.push(`Size: ${String(li.variantTitle)}`);
        if (li.quantity) parts.push(`Quantity: ${String(li.quantity)}`);
        if (li.price) parts.push(`Price: ${String(li.price)}`);
        if (li.sku) parts.push(`SKU: ${String(li.sku)}`);
        return parts.join("\n");
      }).join("\n\n");
      if (desc) restOnlyFields.product_description = desc;
    }
  }

  // Shipping data from fulfillment sections
  const shipSections = sections.filter(s => s.type === "shipping" || s.type === "fulfillment");
  for (const s of shipSections) {
    const fulfillments = s.data?.fulfillments as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(fulfillments)) continue;
    for (const f of fulfillments) {
      if (f.createdAt) restOnlyFields.shipping_date = String(f.createdAt).split("T")[0];
      const tracking = f.tracking as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(tracking)) {
        for (const t of tracking) {
          if (t.carrier) restOnlyFields.shipping_carrier = String(t.carrier);
          if (t.number) restOnlyFields.shipping_tracking_number = String(t.number);
        }
      }
    }
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
      session_type: session.sessionType, user_id: session.userId,
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

  // Auth-class errors get their own dedicated code path so the failure
  // mode is unambiguous (distinguishable from userErrors or other
  // Shopify-side rejections). On match, persist save_failed with a
  // stable reason and rethrow the typed error.
  try {
    assertNotAuthInvalid(pack.shop_id, session.sessionType, {
      errors: result.errors,
    });
  } catch (err) {
    if (err instanceof ShopifyAuthInvalidError) {
      console.error(
        `[saveToShopify] auth invalid mode=${err.sessionType} shop=${err.shopId}: ${err.rawMessage}`,
      );
      await sb
        .from("evidence_packs")
        .update({ status: "save_failed", updated_at: new Date().toISOString() })
        .eq("id", packId);
      await logAuditEvent({
        shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
        actorType: "system", eventType: "job_failed",
        eventPayload: {
          jobId: job.id,
          jobType: "save_to_shopify",
          reason: "shopify_auth_invalid",
          session_type: err.sessionType,
          shopify_message: err.rawMessage,
        },
      });
    }
    throw err;
  }

  // Check GraphQL errors (non-auth)
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
  //  5. REST SUPPLEMENT — fields GraphQL doesn't support
  // ═══════════════════════════════════════════════════════════

  if (Object.keys(restOnlyFields).length > 0) {
    try {
      const { data: dForRest } = await sb
        .from("disputes")
        .select("dispute_gid")
        .eq("id", pack.dispute_id)
        .single();
      const numericDisputeId = dForRest?.dispute_gid?.match(/\/(\d+)$/)?.[1];

      if (numericDisputeId) {
        const restUrl = `https://${shopDomain}/admin/api/2026-01/shopify_payments/disputes/${numericDisputeId}/dispute_evidences.json`;
        const restRes = await fetch(restUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ dispute_evidence: restOnlyFields }),
        });

        console.log(
          `[saveToShopify] REST supplement (${Object.keys(restOnlyFields).join(", ")}): ${restRes.status}`,
        );
      }
    } catch (restErr) {
      // Non-fatal — GraphQL fields are already saved
      console.error(
        "[saveToShopify] REST supplement failed (non-fatal):",
        restErr instanceof Error ? restErr.message : String(restErr),
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  6. MARK UNVERIFIED (mutation succeeded but not yet confirmed)
  // ═══════════════════════════════════════════════════════════

  const now = new Date().toISOString();
  await sb.from("evidence_packs").update({
    status: "saved_to_shopify_unverified",
    saved_to_shopify_at: now,
    updated_at: now,
  }).eq("id", packId);

  // ═══════════════════════════════════════════════════════════
  //  7. VERIFY — re-fetch evidence from Shopify and compare
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
      manual_attachment_count: manualAttachments.length,
      pdf_attached: pdfAttachment !== null,
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
