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
import { merchantNameFromDomain } from "@/lib/defence/orderContext";
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
import {
  isRegenerateBuild,
  stampRebuildOutcome,
} from "@/lib/automation/rebuildOutcome";
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

  /* ── 2. Load dispute (need evidence GID + customer info + window state) ── */

  const { data: dispute } = await sb
    .from("disputes")
    .select(
      "id, dispute_evidence_gid, dispute_gid, reason, amount, currency_code, customer_display_name, customer_email, submission_state, submitted_at",
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

  /* ── 2b. Guard A — early window-closed check ──
   *
   * Resubmission Window: if Shopify has already forwarded evidence to
   * the bank (submission_state = "submitted_confirmed", set by
   * syncDisputes.ts from `evidenceSentOn`), do NOT attempt to overwrite.
   * The prior PDF is what the bank has; that's the final word.
   *
   * This is a non-retriable success exit — we never want this job to
   * keep retrying once the window has closed.
   */
  if (dispute.submission_state === "submitted_confirmed") {
    const skippedAt = new Date().toISOString();
    await sb
      .from("evidence_packs")
      .update({
        status: "saved_to_shopify_verified",
        rebuild_pending: false,
        updated_at: skippedAt,
      })
      .eq("id", packId);
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "system",
      eventType: "save_to_shopify_skipped_window_closed",
      eventPayload: {
        jobId: job.id,
        jobType: "save_to_shopify",
        packId,
        disputeId: pack.dispute_id,
        submittedAt: dispute.submitted_at ?? null,
        reason: "evidence_forwarded_to_bank",
        guardPoint: "early",
      },
    });
    return { ok: true };
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

  // Filename pattern: Defence-{disputeID}-{Merchant}-{submissionDate}.pdf
  // The bank's reviewer sees this in Shopify Admin's dispute-resolution
  // UI; sortable by dispute id, identifies the merchant at a glance,
  // dates by submission (not generation, so the bank knows when it
  // actually reached them). Filename-safe: spaces removed, only [-A-Za-z0-9].
  const merchantSlug =
    merchantNameFromDomain(shopDomain)?.replace(/\s+/g, "") ?? "Merchant";
  const submissionDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const filename = `Defence-${numericDisputeId}-${merchantSlug}-${submissionDate}.pdf`;

  let defencePackagePdfGid: string;
  try {
    const upload = await uploadDisputeFile({
      shopDomain,
      accessToken,
      disputeNumericId: numericDisputeId,
      documentType: "uncategorized_file",
      filename,
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

  /* ── 7b. Guard B — late window-closed re-check ──
   *
   * The PDF has already been uploaded to Shopify (section 6), but
   * before we wire it onto the dispute evidence record via the
   * mutation, re-check `submission_state`. Shopify can flip
   * `evidenceSentOn` at any point — including between our file upload
   * and our mutation call.
   *
   * The orphaned file we just uploaded is harmless: Shopify garbage-
   * collects unreferenced file GIDs. No delete path exists that's
   * idempotent under retry, and the audit row makes the orphan
   * traceable for ops.
   */
  {
    const { data: lateDispute } = await sb
      .from("disputes")
      .select("submission_state, submitted_at")
      .eq("id", pack.dispute_id)
      .single();
    if (lateDispute?.submission_state === "submitted_confirmed") {
      const skippedAt = new Date().toISOString();
      await sb
        .from("evidence_packs")
        .update({
          status: "saved_to_shopify_verified",
          rebuild_pending: false,
          updated_at: skippedAt,
        })
        .eq("id", packId);
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: pack.dispute_id,
        packId,
        actorType: "system",
        eventType: "save_to_shopify_skipped_window_closed",
        eventPayload: {
          jobId: job.id,
          jobType: "save_to_shopify",
          packId,
          disputeId: pack.dispute_id,
          submittedAt: lateDispute.submitted_at ?? null,
          reason: "evidence_forwarded_to_bank",
          guardPoint: "pre_mutation",
          orphanFileGid: defencePackagePdfGid,
        },
      });
      return { ok: true };
    }
  }

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
      if (dispute.submission_state === "saved_to_shopify") {
        await stampRebuildOutcome({
          packId,
          outcome: "failed",
          reason: "shopify_auth_invalid",
        });
      }
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
    if (dispute.submission_state === "saved_to_shopify") {
      await stampRebuildOutcome({
        packId,
        outcome: "failed",
        reason: "shopify_graphql_error",
      });
    }
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
    if (dispute.submission_state === "saved_to_shopify") {
      await stampRebuildOutcome({
        packId,
        outcome: "failed",
        reason: "shopify_user_error",
      });
    }
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

  // Resubmission Window outcome stamp. This save completed without
  // hitting the early/late `submitted_confirmed` guards — at job start
  // the dispute was at `saved_to_shopify`, meaning the merchant had a
  // prior save and this cycle is the regenerate. Stamping `saved` here
  // (not after verification) is correct because verification can fail
  // for read-replica reasons unrelated to the actual save.
  // Note: `isRegenerateBuild` checks live state, which is now back to
  // `saved_to_shopify` (we just set it above at line ~516). That's
  // the intended check — it answers "did this dispute have a prior
  // save before this job ran", and the answer is yes if the dispute
  // had any save before; the line above is idempotent for repeat saves.
  // To avoid a false positive on the very first save, we gate on the
  // pre-save `submission_state` captured in section 2.
  if (dispute.submission_state === "saved_to_shopify") {
    await stampRebuildOutcome({
      packId,
      outcome: "saved",
      reason: verified ? "save_verified" : "save_unverified",
    });
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

  /* ── 14. Coalesce tail — re-enqueue if regenerate is pending ──
   *
   * A merchant who requested a regenerate while THIS save cycle was
   * already in flight (§3 of the Resubmission Window plan) marked
   * `rebuild_pending = true` instead of enqueueing a duplicate
   * build_pack. Now that the current save has settled, kick off the
   * pending regenerate.
   *
   * Idempotency: if a build_pack job for this pack already exists in a
   * non-terminal state (queued/running), skip the insert. This protects
   * against `saveToShopifyJob` being retried after the insert (worker
   * crash, network blip): without the lookup, every retry would stack
   * another job.
   *
   * Window re-check: Shopify may have flipped to `submitted_confirmed`
   * between job start and now. In that case clear the flag and skip —
   * no point regenerating evidence the bank already has.
   *
   * `rebuild_pending` stays `true` across the enqueue and is cleared
   * only at `buildPackJob` start (§5a). That keeps the UI's
   * "Regenerating" banner continuous from request to worker pickup.
   */
  const { data: tailRow } = await sb
    .from("evidence_packs")
    .select("rebuild_pending")
    .eq("id", packId)
    .single();

  if (tailRow?.rebuild_pending) {
    const { data: tailDispute } = await sb
      .from("disputes")
      .select("submission_state")
      .eq("id", pack.dispute_id)
      .single();

    if (tailDispute?.submission_state === "submitted_confirmed") {
      await sb
        .from("evidence_packs")
        .update({
          rebuild_pending: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", packId);
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: pack.dispute_id,
        packId,
        actorType: "system",
        eventType: "pack_regenerate_coalesced_skipped_window_closed",
        eventPayload: {
          jobId: job.id,
          packId,
          disputeId: pack.dispute_id,
          trigger: "rebuild_pending_tail",
        },
      });
    } else {
      const { data: activeBuilds } = await sb
        .from("jobs")
        .select("id, status")
        .eq("entity_id", packId)
        .eq("job_type", "build_pack")
        .in("status", ["queued", "running"]);

      if (activeBuilds && activeBuilds.length > 0) {
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: "pack_regenerate_coalesced_job_already_exists",
          eventPayload: {
            jobId: job.id,
            packId,
            disputeId: pack.dispute_id,
            trigger: "rebuild_pending_tail",
            existingJobIds: activeBuilds.map((j) => j.id as string),
          },
        });
      } else {
        await sb.from("jobs").insert({
          shop_id: pack.shop_id,
          job_type: "build_pack",
          entity_id: packId,
        });
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: "pack_regenerate_coalesced",
          eventPayload: {
            jobId: job.id,
            packId,
            disputeId: pack.dispute_id,
            trigger: "rebuild_pending_tail",
          },
        });
      }
    }
  }

  return { ok: true };
}
