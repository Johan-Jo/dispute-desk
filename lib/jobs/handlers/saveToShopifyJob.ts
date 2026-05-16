/**
 * Job handler: save_to_shopify (post-retirement minimal contract).
 *
 * Pushes ONE artifact to Shopify: the defence-package PDF. Mutation
 * input contains exactly customerFirstName / customerLastName /
 * customerEmailAddress (optional) + uncategorizedFile.id +
 * submitEvidence:true. The bank reads the PDF; no structured text
 * fields, no merchant-upload native slot routing.
 *
 * Status flow:
 *   saving → saved_to_shopify_unverified → saved_to_shopify_verified
 *                                        → save_failed (on hard failure)
 *
 * Hard prerequisites for entering this handler:
 *   - evidence_packs.status ∈ {ready, saving, saved_to_shopify}
 *   - disputes.dispute_evidence_gid is set
 *   - latest defence_packages row for the dispute is status=final with pdf_path set
 *   - PDF bytes ≤ MAX_FILE_SIZE_BYTES (2 MiB — Shopify Admin UI ceiling)
 *
 * Each failure mode below short-circuits with a non-retriable JobResult
 * — there's no fallback path now that the legacy text rebuttal engine
 * is retired.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  assertNotAuthInvalid,
  getShopBackgroundSession,
  ShopifyAuthInvalidError,
} from "@/lib/shopify/sessions/getShopBackgroundSession";
import { composeShopifyMutationPayload } from "@/lib/shopify/composeShopifyMutationPayload";
import {
  uploadDisputeFile,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/shopify/disputeFileUpload";
import { downloadDefencePdf } from "@/lib/defence/storage";
import {
  verifyEvidenceReadback,
  type VerificationDiffOrError,
} from "@/lib/shopify/verifyEvidenceReadback";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
  type DisputeEvidenceUpdateInput,
} from "@/lib/shopify/mutations/disputeEvidenceUpdate";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { emitSaveToShopifyEvents } from "./saveToShopifyEvents";
import type { ClaimedJob, JobResult } from "../claimJobs";

const ALLOWED_PACK_STATUSES = new Set(["ready", "saving", "saved_to_shopify"]);

export async function handleSaveToShopify(
  job: ClaimedJob,
): Promise<JobResult> {
  const sb = getServiceClient();
  const packId = job.entityId;
  if (!packId) {
    return {
      ok: false,
      retriable: false,
      reason: "No entity_id (pack ID) on save_to_shopify job",
    };
  }

  /* ── 1. Load pack + status guard ── */

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status")
    .eq("id", packId)
    .single();
  if (!pack) {
    return {
      ok: false,
      retriable: false,
      reason: `Pack not found: ${packId}`,
    };
  }

  if (!ALLOWED_PACK_STATUSES.has(pack.status as string)) {
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
    return {
      ok: false,
      retriable: false,
      reason: `Refusing to save to Shopify: pack status is "${pack.status}", not a submittable state.`,
    };
  }

  /* ── 2. Load dispute (need evidence GID + customer info) ── */

  const { data: dispute } = await sb
    .from("disputes")
    .select(
      "id, dispute_evidence_gid, dispute_gid, reason, amount, currency_code, customer_display_name, customer_email",
    )
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute?.dispute_evidence_gid) {
    return {
      ok: false,
      retriable: false,
      reason: "Dispute has no evidence GID — cannot save to Shopify",
    };
  }
  const numericDisputeId = dispute.dispute_gid?.match(/\/(\d+)$/)?.[1];
  if (!numericDisputeId) {
    return {
      ok: false,
      retriable: false,
      reason: "Dispute has no numeric Shopify ID — cannot upload file evidence",
    };
  }

  /* ── 3. Load latest defence_packages row — must be FINAL ── */

  const { data: dpkg } = await sb
    .from("defence_packages")
    .select("id, version, status, pdf_path")
    .eq("dispute_id", pack.dispute_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!dpkg) {
    return {
      ok: false,
      retriable: false,
      reason:
        "No defence_packages row exists for this dispute. Build the defence package first (or wait for the auto-build to complete).",
    };
  }
  if (dpkg.status !== "final") {
    return {
      ok: false,
      retriable: false,
      reason: `Defence package is in status "${dpkg.status}", not final. Finalize the latest draft (or wait for regeneration) before submitting.`,
    };
  }
  if (!dpkg.pdf_path) {
    return {
      ok: false,
      retriable: false,
      reason: "Defence package is final but has no PDF path. Regenerate the package and try again.",
    };
  }

  const activeDefencePackageId = dpkg.id as string;
  const activeDefencePackageVersion = dpkg.version as number;

  /* ── 4. Download PDF + check size ── */

  let pdfBytes: Buffer;
  try {
    pdfBytes = await downloadDefencePdf(dpkg.pdf_path as string);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      retriable: true,
      reason: `defence_pdf_download_failed: ${message}`,
    };
  }
  if (pdfBytes.length > MAX_FILE_SIZE_BYTES) {
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        reason: "defence_pdf_too_large",
        size_bytes: pdfBytes.length,
        max_bytes: MAX_FILE_SIZE_BYTES,
      },
    });
    return {
      ok: false,
      retriable: false,
      reason: `defence_pdf_too_large: ${pdfBytes.length} bytes exceeds Shopify Admin's ${MAX_FILE_SIZE_BYTES}-byte file-upload ceiling. Regenerate with a tighter narrative or compress the PDF.`,
    };
  }

  /* ── 5. Session ── */

  const session = await getShopBackgroundSession(pack.shop_id);
  const accessToken = session.accessToken;
  const shopDomain = session.shopDomain;

  /* ── 6. Upload PDF to Shopify → fileGid ── */

  let defencePackagePdfGid: string;
  try {
    const upload = await uploadDisputeFile({
      shopDomain,
      accessToken,
      disputeNumericId: numericDisputeId,
      documentType: "uncategorized_file",
      filename: `defence-package-v${activeDefencePackageVersion}.pdf`,
      mimeType: "application/pdf",
      fileBytes: pdfBytes,
    });
    defencePackagePdfGid = upload.fileGid;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "job_failed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        reason: "defence_pdf_upload_failed",
        error: message.slice(0, 500),
      },
    });
    return {
      ok: false,
      retriable: true,
      reason: `defence_pdf_upload_failed: ${message}`,
    };
  }

  /* ── 7. Build 4-field input ── */

  const input: DisputeEvidenceUpdateInput = composeShopifyMutationPayload({
    customer: {
      displayName: dispute.customer_display_name ?? null,
      email: dispute.customer_email ?? null,
    },
    defencePackagePdfGid,
  });
  const inputKeys = Object.keys(input);

  console.log(
    `[saveToShopify] input payload (${inputKeys.length} fields):`,
    JSON.stringify(inputKeys),
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
      session_type: session.sessionType,
      user_id: session.userId,
      fields_to_send: inputKeys,
      defence_package_id: activeDefencePackageId,
      defence_package_version: activeDefencePackageVersion,
    },
  });

  /* ── 8. Call mutation ── */

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

  /* ── 9. Auth + GraphQL + userErrors handling ── */

  try {
    assertNotAuthInvalid(pack.shop_id, session.sessionType, {
      errors: result.errors,
    });
  } catch (err) {
    if (err instanceof ShopifyAuthInvalidError) {
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
          reason: "shopify_auth_invalid",
          session_type: err.sessionType,
          shopify_message: err.rawMessage,
        },
      });
      return {
        ok: false,
        retriable: false,
        reason: `shopify_auth_invalid: ${err.rawMessage}`,
      };
    }
    throw err;
  }

  if (result.errors?.length) {
    const errMsg = result.errors.map((e: { message: string }) => e.message).join(", ");
    await sb
      .from("evidence_packs")
      .update({ status: "save_failed", updated_at: new Date().toISOString() })
      .eq("id", packId);
    return {
      ok: false,
      retriable: true,
      reason: `Shopify GraphQL errors: ${errMsg}`,
    };
  }

  const userErrors = result.data?.disputeEvidenceUpdate?.userErrors ?? [];
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
      eventPayload: { jobId: job.id, jobType: "save_to_shopify", user_errors: userErrors },
    });
    return {
      ok: false,
      retriable: false,
      reason: `Shopify userErrors: ${userErrors.map((e) => e.message).join(", ")}`,
    };
  }

  /* ── 10. Mark unverified, then verify ── */

  const now = new Date().toISOString();
  await sb
    .from("evidence_packs")
    .update({
      status: "saved_to_shopify_unverified",
      saved_to_shopify_at: now,
      updated_at: now,
    })
    .eq("id", packId);

  let verified = false;
  let verificationDiff: VerificationDiffOrError = {
    error: "verification not attempted",
  };

  try {
    // Read-replica lag buffer — empirically 2 seconds is enough.
    await new Promise((r) => setTimeout(r, 2000));

    const { diff, evidenceNode } = await verifyEvidenceReadback({
      shopDomain,
      accessToken,
      disputeGid: dispute.dispute_gid ?? "",
      inputKeys,
      inputValues: input as unknown as Record<string, unknown>,
      correlationId: `verify-${job.id}`,
    });

    verificationDiff = diff;
    if ("verified" in diff) {
      verified = diff.verified;
      console.log(`[saveToShopify] verification:`, JSON.stringify(diff));
    } else if (!evidenceNode) {
      console.log("[saveToShopify] verification: could not fetch evidence from Shopify");
    }
  } catch (verifyErr) {
    const message = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
    console.error("[saveToShopify] verification error:", message);
    verificationDiff = { error: message };
  }

  /* ── 11. Final status ── */

  const finalStatus = verified ? "saved_to_shopify_verified" : "saved_to_shopify_unverified";

  await sb
    .from("evidence_packs")
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
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

  /* ── 12. Mark the defence package submitted (when verified) ── */

  if (verified) {
    await sb
      .from("defence_packages")
      .update({
        status: "submitted",
        submitted_at: now,
        submitted_by: "system",
        shopify_response: {
          verified,
          finalStatus,
          evidenceGid: dispute.dispute_evidence_gid,
          fileGid: defencePackagePdfGid,
        },
        updated_at: now,
      })
      .eq("id", activeDefencePackageId);
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "defence_package_submitted",
      eventPayload: {
        packageId: activeDefencePackageId,
        version: activeDefencePackageVersion,
        evidenceGid: dispute.dispute_evidence_gid,
        fileGid: defencePackagePdfGid,
        verified,
      },
    });
  }

  /* ── 13. Success-path event burst ── */

  await emitSaveToShopifyEvents({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    jobId: job.id,
    evidenceGid: dispute.dispute_evidence_gid,
    finalStatus,
    inputKeys,
    verified,
    verificationDiff,
    manualAttachmentCount: 0,
    pdfAttached: true,
    nativeAttachmentCount: 0,
    nativeAttachmentFields: [],
    reason: dispute.reason ?? null,
    amount: dispute.amount ?? null,
    currencyCode: dispute.currency_code ?? null,
    eventAt: now,
  });

  return { ok: true };
}
