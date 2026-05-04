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
import {
  composeShopifyMutationPayload,
  type ResolvedAttachmentPlanEntry,
} from "@/lib/shopify/composeShopifyMutationPayload";
import { buildRestSupplementFields } from "@/lib/shopify/buildRestSupplementFields";
import { isFileEvidenceAttachmentsEnabled } from "@/lib/featureFlags";
import {
  decideFileAttachments,
  type FileAttachmentCandidate,
} from "@/lib/shopify/decideFileAttachments";
import {
  uploadDisputeFile,
  DOCUMENT_TYPE_TO_MUTATION_FIELD,
  type DisputeFileDocumentType,
  type DisputeEvidenceFileField,
} from "@/lib/shopify/disputeFileUpload";
import { generateEvidenceAttachmentPdf } from "@/lib/packs/generateEvidenceAttachmentPdf";
import { isFileEligible } from "@/lib/argument/canonicalEvidence";
import type { CaseStrengthLevel } from "@/lib/argument/types";
import {
  verifyEvidenceReadback,
  type VerificationDiffOrError,
} from "@/lib/shopify/verifyEvidenceReadback";
import {
  type ManualAttachmentInput,
  type PackPdfInput,
} from "@/lib/shopify/manualAttachments";
import {
  loadChecklistFieldByEvidenceItemIdFromAudit,
  resolveChecklistFieldForManualItem,
} from "@/lib/shopify/manualUploadChecklistFromAudit";
import { ATTACHMENT_LINK_TTL_DAYS } from "@/lib/links/attachmentLinks";
import {
  buildShortAttachmentUrl,
  createShortLink,
} from "@/lib/links/shortLinks";
import {
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
  type DisputeEvidenceUpdateResult,
  type DisputeEvidenceUpdateInput,
} from "@/lib/shopify/mutations/disputeEvidenceUpdate";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { emitSaveToShopifyEvents } from "./saveToShopifyEvents";
import type { ClaimedJob, JobResult } from "../claimJobs";

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

/** Persisted on `pack_json.attachmentUploads` so retries + lifecycle
 *  reads can reuse uploaded GIDs without re-hitting Shopify. */
interface PersistedAttachmentUpload {
  evidenceItemId: string;
  evidenceFieldKey: string;
  targetField: DisputeEvidenceFileField;
  fileGid: string;
  uploadedAt: string;
}

/** Reverse of `DOCUMENT_TYPE_TO_MUTATION_FIELD`. Built once at module
 *  load. Used by the file-evidence pipeline to derive the REST
 *  `document_type` from the planner's `targetField`. */
const MUTATION_FIELD_TO_DOCUMENT_TYPE: Record<
  DisputeEvidenceFileField,
  DisputeFileDocumentType
> = (() => {
  const out = {} as Record<DisputeEvidenceFileField, DisputeFileDocumentType>;
  for (const [docType, fieldName] of Object.entries(DOCUMENT_TYPE_TO_MUTATION_FIELD)) {
    out[fieldName as DisputeEvidenceFileField] = docType as DisputeFileDocumentType;
  }
  return out;
})();

/* ── Main handler ── */

export async function handleSaveToShopify(job: ClaimedJob): Promise<JobResult> {
  const sb = getServiceClient();
  const packId = job.entityId;
  if (!packId) {
    return {
      ok: false,
      retriable: false,
      reason: "No entity_id (pack ID) on save_to_shopify job",
    };
  }

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, pack_json")
    .eq("id", packId)
    .single();
  if (!pack) {
    return {
      ok: false,
      retriable: false,
      reason: `Pack not found: ${packId}`,
    };
  }

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
    return {
      ok: false,
      retriable: false,
      reason: `Refusing to save to Shopify: pack status is "${pack.status}", not a submittable state. Shopify was NOT called.`,
    };
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, dispute_evidence_gid, reason, amount, currency_code")
    .eq("id", pack.dispute_id)
    .single();
  if (!dispute?.dispute_evidence_gid) {
    return {
      ok: false,
      retriable: false,
      reason: "Dispute has no evidence GID — cannot save to Shopify",
    };
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

  // Customer info (schema only accepts firstName + lastName + email)
  const { data: disputeExtra } = await sb
    .from("disputes")
    .select("customer_display_name, customer_email")
    .eq("id", pack.dispute_id)
    .single();

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

  const linkExpiresAt = new Date(
    Date.now() + ATTACHMENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: manualItems } = await sb
    .from("evidence_items")
    .select("id, label, payload, created_at")
    .eq("pack_id", packId)
    .eq("source", "manual_upload")
    .order("created_at", { ascending: false });

  const auditChecklistByItemId =
    await loadChecklistFieldByEvidenceItemIdFromAudit(sb, packId);

  const toBackfill: Array<{
    id: string;
    meta: Record<string, unknown>;
    checklistField: string;
  }> = [];

  const manualAttachments: ManualAttachmentInput[] = [];
  for (const item of manualItems ?? []) {
    const meta = (item.payload ?? {}) as Record<string, unknown>;
    const code = await createShortLink(sb, {
      kind: "item",
      entityId: String(item.id),
      packId,
      shopId: pack.shop_id,
      disputeId: pack.dispute_id ?? null,
      expiresAt: linkExpiresAt,
    });
    const checklistField = resolveChecklistFieldForManualItem(
      String(item.id),
      meta,
      auditChecklistByItemId,
    );
    const hadPayloadField =
      typeof meta.checklistField === "string" && meta.checklistField.trim().length > 0;
    if (!hadPayloadField && checklistField) {
      toBackfill.push({ id: String(item.id), meta, checklistField });
    }
    manualAttachments.push({
      // `id` is consulted by `composeShopifyMutationPayload` to suppress
      // links for items whose bytes (or synthesised PDFs) have been
      // attached natively via the file evidence layer (Q2=A in the
      // conditional file evidence plan). Always set; suppression is
      // a no-op when the file evidence flag is off.
      id: String(item.id),
      checklistField,
      label: (item.label as string | null) ?? null,
      fileName: typeof meta.fileName === "string" ? meta.fileName : null,
      fileSize: typeof meta.fileSize === "number" ? meta.fileSize : null,
      createdAt: (item.created_at as string | null) ?? null,
      url: buildShortAttachmentUrl(code),
    });
  }

  for (const row of toBackfill) {
    await sb
      .from("evidence_items")
      .update({
        payload: { ...row.meta, checklistField: row.checklistField },
      })
      .eq("id", row.id);
  }

  let pdfAttachment: PackPdfInput | null = null;
  const { data: packForPdf } = await sb
    .from("evidence_packs")
    .select("pdf_path")
    .eq("id", packId)
    .single();
  if (packForPdf?.pdf_path) {
    const code = await createShortLink(sb, {
      kind: "pdf",
      entityId: packId,
      packId,
      shopId: pack.shop_id,
      disputeId: pack.dispute_id ?? null,
      expiresAt: linkExpiresAt,
    });
    pdfAttachment = { url: buildShortAttachmentUrl(code) };
  }

  // ═══════════════════════════════════════════════════════════
  //  FILE EVIDENCE PIPELINE (gated by `FILE_EVIDENCE_ATTACHMENTS_ENABLED`)
  //
  //  When the flag is on, run `decideFileAttachments` over the
  //  merchant's manual uploads, generate a focused PDF per native
  //  plan entry, REST-upload it to Shopify, persist the resulting GID
  //  on `pack_json.attachmentUploads` for retry idempotency, and pass
  //  the resolved plan to `composeShopifyMutationPayload`. Compose
  //  sets the matching `*File` fields and suppresses the manual link
  //  for the same `evidence_item_id` (Q2=A — native-only when attached).
  //
  //  When the flag is off (default), `resolvedAttachmentPlan` stays
  //  empty and compose's behaviour is byte-identical to the
  //  text-only path that's been in production since 2026-04-21.
  //
  //  Failure isolation: any error inside this block degrades to
  //  text-only for that specific entry (or the whole pack on a hard
  //  failure) and is recorded via `attachment_pipeline_failed` audit
  //  events. Shopify mutation will still proceed.
  // ═══════════════════════════════════════════════════════════

  let resolvedAttachmentPlan: ResolvedAttachmentPlanEntry[] = [];

  if (isFileEvidenceAttachmentsEnabled()) {
    try {
      const packJson = (pack.pack_json ?? {}) as {
        case_strength?: { overall?: CaseStrengthLevel };
        coverage?: { state?: string };
        fatal_loss?: { triggered?: boolean };
        attachmentUploads?: PersistedAttachmentUpload[];
      };

      const caseStrength: CaseStrengthLevel =
        (packJson.case_strength?.overall as CaseStrengthLevel | undefined) ?? "insufficient";
      const coverageActive = packJson.coverage?.state === "covered_shopify";
      const fatalLossActive = packJson.fatal_loss?.triggered === true;

      const candidates: FileAttachmentCandidate[] = [];
      for (const item of manualItems ?? []) {
        const meta = (item.payload ?? {}) as Record<string, unknown>;
        const checklistField =
          typeof meta.checklistField === "string" && meta.checklistField.trim().length > 0
            ? meta.checklistField
            : null;
        if (!checklistField || !isFileEligible(checklistField)) continue;
        candidates.push({
          evidenceItemId: String(item.id),
          evidenceFieldKey: checklistField,
          payload: meta,
          label: (item.label as string | null) ?? null,
          fileName: typeof meta.fileName === "string" ? meta.fileName : null,
        });
      }

      const plan = decideFileAttachments({
        caseStrength,
        disputeReason: dispute.reason,
        coverageActive,
        fatalLossActive,
        candidates,
      });

      const numericDisputeId = dispute.dispute_evidence_gid.match(/\/(\d+)$/)?.[1];
      const candidateById = new Map(candidates.map(c => [c.evidenceItemId, c]));
      // Idempotency: lifecycle-fresh stash is reused; otherwise re-upload.
      const lifecycleFreshStatuses = new Set(["ready", "saving", "saved_to_shopify_unverified"]);
      const lifecycleFresh = lifecycleFreshStatuses.has(pack.status as string);
      const existingMap = new Map<string, PersistedAttachmentUpload>(
        (packJson.attachmentUploads ?? []).map(u => [u.evidenceItemId, u]),
      );

      const updatedUploads: PersistedAttachmentUpload[] = [];
      const auditAttachments: Array<{
        evidenceItemId: string;
        evidenceFieldKey: string;
        targetField: string;
        slot: string;
        ok: boolean;
        reused?: boolean;
        requestId?: string | null;
      }> = [];

      for (const entry of plan) {
        if (entry.resolvedSlot.kind !== "native") {
          // Link-only entries are recorded in the resolved plan with
          // null GID so the Review & Submit UI can show "queued to
          // narrative" with a reason, but they never trigger an upload.
          resolvedAttachmentPlan.push({
            evidenceItemId: entry.evidenceItemId,
            evidenceFieldKey: entry.evidenceFieldKey,
            resolvedSlot: entry.resolvedSlot,
            fileGid: null,
          });
          continue;
        }

        const targetField = entry.resolvedSlot.targetField;
        const existing = existingMap.get(entry.evidenceItemId);
        let fileGid: string | null = null;
        let reused = false;

        if (
          existing &&
          existing.targetField === targetField &&
          lifecycleFresh
        ) {
          fileGid = existing.fileGid;
          reused = true;
        } else if (numericDisputeId) {
          try {
            const cand = candidateById.get(entry.evidenceItemId);
            const pdfBytes = await generateEvidenceAttachmentPdf({
              attachmentType: entry.attachmentType,
              evidenceFieldKey: entry.evidenceFieldKey,
              reason: entry.reason,
              shopDomain,
              disputeId: numericDisputeId,
              sections,
              label: cand?.label ?? null,
              payload: cand?.payload ?? null,
            });

            const documentType = MUTATION_FIELD_TO_DOCUMENT_TYPE[targetField];
            const upload = await uploadDisputeFile({
              shopDomain,
              accessToken,
              disputeNumericId: numericDisputeId,
              documentType,
              filename: `${entry.evidenceFieldKey}.pdf`,
              mimeType: "application/pdf",
              fileBytes: pdfBytes,
            });
            fileGid = upload.fileGid;
            auditAttachments.push({
              evidenceItemId: entry.evidenceItemId,
              evidenceFieldKey: entry.evidenceFieldKey,
              targetField,
              slot: entry.resolvedSlot.origin,
              ok: true,
              requestId: upload.requestId,
            });
          } catch (err) {
            const requestId =
              err && typeof err === "object" && "requestId" in err
                ? ((err as { requestId?: string | null }).requestId ?? null)
                : null;
            console.error(
              "[saveToShopify] file evidence upload failed (continuing text-only for this entry):",
              err instanceof Error ? err.message : String(err),
              "requestId=",
              requestId,
            );
            auditAttachments.push({
              evidenceItemId: entry.evidenceItemId,
              evidenceFieldKey: entry.evidenceFieldKey,
              targetField,
              slot: entry.resolvedSlot.origin,
              ok: false,
              requestId,
            });
          }
        }

        if (fileGid) {
          updatedUploads.push({
            evidenceItemId: entry.evidenceItemId,
            evidenceFieldKey: entry.evidenceFieldKey,
            targetField,
            fileGid,
            uploadedAt: existing && reused ? existing.uploadedAt : new Date().toISOString(),
          });
        }

        resolvedAttachmentPlan.push({
          evidenceItemId: entry.evidenceItemId,
          evidenceFieldKey: entry.evidenceFieldKey,
          resolvedSlot: entry.resolvedSlot,
          fileGid,
        });
      }

      // Persist GIDs back to pack_json (best-effort; never block save).
      if (updatedUploads.length > 0) {
        const nextPackJson = { ...packJson, attachmentUploads: updatedUploads };
        await sb
          .from("evidence_packs")
          .update({ pack_json: nextPackJson, updated_at: new Date().toISOString() })
          .eq("id", packId);
      }

      if (auditAttachments.length > 0) {
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: "file_evidence_planned",
          eventPayload: {
            jobId: job.id,
            attachments: auditAttachments,
            failures: auditAttachments.filter(a => !a.ok).length,
            reused: auditAttachments.filter(a => a.reused).length,
          },
        });
      }
    } catch (pipelineErr) {
      // Pipeline-level failure (decide, candidate building, etc.).
      // Continue with text-only path.
      console.error(
        "[saveToShopify] file evidence pipeline failed (degrading to text-only):",
        pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr),
      );
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: pack.dispute_id,
        packId,
        actorType: "system",
        eventType: "file_evidence_pipeline_failed",
        eventPayload: {
          jobId: job.id,
          error: pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr),
        },
      });
      resolvedAttachmentPlan = [];
    }
  }

  // Compose the final GraphQL mutation payload via the shared
  // `composeShopifyMutationPayload` builder. The submission-preview
  // endpoint calls the same function so the merchant's "raw view" is
  // byte-equivalent to what's about to ship (modulo the URL tokens,
  // which are inputs to this function — not transformations performed
  // inside it). Plan v3 §3.A.2.
  const input: DisputeEvidenceUpdateInput = composeShopifyMutationPayload({
    sections,
    rebuttalText,
    disputeReason: dispute.reason,
    customer: {
      displayName: disputeExtra?.customer_display_name ?? null,
      email: disputeExtra?.customer_email ?? null,
    },
    manualAttachments,
    pdfAttachment,
    attachmentPlan: resolvedAttachmentPlan,
  });


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

  // REST-only fields are extracted by `buildRestSupplementFields` —
  // see the snapshot harness in lib/jobs/handlers/__tests__/
  // saveToShopify.snapshot.test.ts for byte-equivalence pinning across
  // the four dispute-family fixtures.
  const restOnlyFields = buildRestSupplementFields(sections);

  const inputKeys = Object.keys(input);
  if (inputKeys.length === 0) {
    return {
      ok: false,
      retriable: false,
      reason: "No evidence fields to send — pack sections are empty",
    };
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
  // stable reason and return a non-retriable JobResult — the merchant
  // must reinstall before any retry could succeed.
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
      return {
        ok: false,
        retriable: false,
        reason: `shopify_auth_invalid: ${err.rawMessage}`,
      };
    }
    throw err;
  }

  // Check GraphQL errors (non-auth). These can be transient (rate limit,
  // 5xx) or schema/resource errors. Treat as RETRIABLE — the worker's
  // attempts cap will eventually fail it if the error persists. The
  // pack is flipped to save_failed regardless so the UI doesn't show
  // it as in-progress while the worker waits.
  if (result.errors?.length) {
    const errMsg = result.errors.map((e: { message: string }) => e.message).join(", ");
    await sb.from("evidence_packs").update({ status: "save_failed", updated_at: new Date().toISOString() }).eq("id", packId);
    return {
      ok: false,
      retriable: true,
      reason: `Shopify GraphQL errors: ${errMsg}`,
    };
  }

  // Check userErrors. These are input-validation failures from Shopify
  // (e.g. malformed evidence field, non-text in a text-only column).
  // Retrying with the same payload won't help → non-retriable.
  const userErrors = result.data?.disputeEvidenceUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    await sb.from("evidence_packs").update({ status: "save_failed", updated_at: new Date().toISOString() }).eq("id", packId);
    await logAuditEvent({
      shopId: pack.shop_id, disputeId: pack.dispute_id, packId,
      actorType: "system", eventType: "job_failed",
      eventPayload: { jobId: job.id, jobType: "save_to_shopify", user_errors: userErrors },
    });
    return {
      ok: false,
      retriable: false,
      reason: `Shopify userErrors: ${userErrors.map((e) => e.message).join(", ")}`,
    };
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
  let verificationDiff: VerificationDiffOrError = {
    error: "verification not attempted",
  };

  try {
    // 2-second buffer — mutation responses don't always reflect on the
    // read replica immediately. Empirically every dispute we save shows
    // up cleanly after this wait.
    await new Promise((r) => setTimeout(r, 2000));

    // Query via dispute GID (not evidence GID) — evidence is a nested field
    const { data: disputeData } = await sb
      .from("disputes")
      .select("dispute_gid")
      .eq("id", pack.dispute_id)
      .single();

    const { diff, evidenceNode } = await verifyEvidenceReadback({
      shopDomain,
      accessToken,
      disputeGid: disputeData?.dispute_gid ?? "",
      inputKeys,
      // Pass the full input so file-field GID equality verifies
      // post-flag-on submissions; harmless when no *File fields are set.
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

  const confirmedNativeEntries = resolvedAttachmentPlan.filter(
    e => e.resolvedSlot.kind === "native" && e.fileGid != null,
  );
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
    manualAttachmentCount: manualAttachments.length,
    pdfAttached: pdfAttachment !== null,
    nativeAttachmentCount: confirmedNativeEntries.length,
    nativeAttachmentFields: confirmedNativeEntries.map(e =>
      e.resolvedSlot.kind === "native" ? e.resolvedSlot.targetField : "",
    ).filter(Boolean),
    reason: dispute.reason ?? null,
    amount: dispute.amount ?? null,
    currencyCode: dispute.currency_code ?? null,
    eventAt: now,
  });

  return { ok: true };
}
