/**
 * POST /api/packs/:packId/bank-claim
 *
 * Records the bank's claim (Shopify's "issuer claim") that the merchant
 * copied from Shopify Admin, or their confirmation that Shopify shows none.
 *
 * Why the merchant: the issuer claim is visible only on the order's
 * chargeback details in Shopify Admin; the Admin API has no field for it.
 * For a reopened dispute, or a `general` one with no network reason code,
 * it is the only statement of what the response has to answer
 * (lib/disputes/bankClaim.ts, plan docs/plans/bank-claim-capture.plan.md).
 *
 * The text is CONTEXT for the letter writer — what to answer — never a fact
 * to cite and never quoted back to the bank.
 *
 * Stored in `dispute_bank_claims`, one row per (dispute, response cycle): a
 * later reopen asks again. NOT an evidence_items row — pack rebuilds delete
 * and re-nest manual items, and untyped manual rows are read as customer
 * correspondence. Then: audit, clear the merchant task, enqueue `build_pack`
 * so the next letter answers the claim with no further merchant action.
 *
 * Two request shapes (Claude Design "Bank Claim Card.dc.html"):
 *   - JSON `{ text, noClaimShown }` — pasted text, or "Shopify shows no claim";
 *   - multipart `file` — the claim file downloaded from Shopify (PDF, TXT,
 *     DOC, DOCX, RTF, EML or image, ≤ 10 MB). Stored in `evidence-packs`;
 *     its text is read (lib/disputes/bankClaimFile.ts) for the letter writer.
 *     A file whose text cannot be read still counts as the answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuditActor } from "@/lib/audit/resolveActor";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import {
  BANK_CLAIM_DISPUTE_COLUMNS,
  BANK_CLAIM_MAX_TEXT,
  bankClaimInputFromRow,
  bankClaimTrigger,
  clearBankClaimNeeded,
  markBankClaimNeeded,
} from "@/lib/disputes/bankClaim";
import {
  BANK_CLAIM_FILE_MAX_BYTES,
  BANK_CLAIM_FILE_TYPES,
  bankClaimFileExt,
  extractBankClaimText,
} from "@/lib/disputes/bankClaimFile";
import { ensureBankClaimAnalysis } from "@/lib/disputes/bankClaimAnalysisStore";

/** Same bucket as pack PDFs and manual uploads (see packs/upload/route.ts). */
const STORAGE_BUCKET = "evidence-packs";

export const runtime = "nodejs";

interface BankClaimBody {
  text?: string | null;
  noClaimShown?: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const auditActor = await resolveAuditActor(req);
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  let text = "";
  let noClaimShown = false;
  let file: File | null = null;
  const isMultipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  if (isMultipart) {
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    file = f && typeof f === "object" && "arrayBuffer" in f ? (f as File) : null;
    if (!file) {
      return NextResponse.json({ error: "No file received.", code: "FILE_REQUIRED" }, { status: 400 });
    }
  } else {
    const parsed = await parseJsonBody<BankClaimBody>(req);
    if (parsed instanceof NextResponse) return parsed;
    text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    noClaimShown = parsed.noClaimShown === true;
  }

  const fileExt = file ? bankClaimFileExt(file.name) : null;
  if (file && !fileExt) {
    return NextResponse.json(
      {
        error: "Upload a PDF, TXT, DOC, DOCX, RTF, EML or image file.",
        code: "FILE_TYPE",
      },
      { status: 400 },
    );
  }
  if (file && file.size > BANK_CLAIM_FILE_MAX_BYTES) {
    return NextResponse.json(
      { error: "The file is larger than 10 MB.", code: "FILE_TOO_LARGE" },
      { status: 400 },
    );
  }

  if (!file && !text && !noClaimShown) {
    return NextResponse.json(
      {
        error: "Paste the bank's claim, or confirm that Shopify shows none.",
        code: "CLAIM_REQUIRED",
      },
      { status: 400 },
    );
  }
  if (text.length > BANK_CLAIM_MAX_TEXT) {
    return NextResponse.json(
      {
        error: `The claim exceeds the ${BANK_CLAIM_MAX_TEXT}-character limit.`,
        code: "CLAIM_TOO_LONG",
      },
      { status: 400 },
    );
  }

  const { data: pack, error: packErr } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (packErr || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }
  if (pack.status === "building" || pack.status === "queued") {
    return NextResponse.json(
      { error: "Cannot add evidence while pack is building", code: "PACK_BUILDING" },
      { status: 409 },
    );
  }
  if (!pack.dispute_id) {
    return NextResponse.json({ error: "Pack has no dispute" }, { status: 409 });
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("submission_state, response_cycle")
    .eq("id", pack.dispute_id)
    .single();
  // Same window guard as the other manual-evidence routes: once Shopify has
  // forwarded the evidence, nothing added here can reach anybody.
  if (dispute?.submission_state === "submitted_confirmed") {
    return NextResponse.json(
      {
        error: "WINDOW_CLOSED",
        code: "WINDOW_CLOSED",
        message:
          "Shopify has already forwarded this dispute evidence to the bank, so the claim can no longer be added.",
      },
      { status: 409 },
    );
  }
  const cycle = (dispute?.response_cycle as number | null) ?? 1;
  const answeredAt = new Date().toISOString();

  // File: store it, then read its text for the letter writer. Reading can
  // fail (DOC/DOCX, a scan with no text, a model error) — the upload still
  // counts as the merchant's answer.
  let filePath: string | null = null;
  let textSource: "pasted" | "file_text" | "file_ai" | null = text ? "pasted" : null;
  let extractError: string | undefined;
  if (file && fileExt) {
    const buffer = Buffer.from(await file.arrayBuffer());
    filePath = `${pack.shop_id}/${pack.dispute_id}/bank-claim-c${cycle}-${Date.now()}.${fileExt}`;
    const { error: uploadErr } = await sb.storage.from(STORAGE_BUCKET).upload(filePath, buffer, {
      contentType: file.type || BANK_CLAIM_FILE_TYPES[fileExt],
      upsert: false,
    });
    if (uploadErr) {
      console.error("[bank-claim] storage upload failed", { filePath, message: uploadErr.message });
      return NextResponse.json(
        { error: "We couldn't store this file. Please try again, or paste the text instead.", code: "UPLOAD_FAILED" },
        { status: 500 },
      );
    }
    const extracted = await extractBankClaimText(buffer, fileExt);
    text = extracted.text ?? "";
    textSource = extracted.source;
    extractError = extracted.error;
  }

  // Re-answering within the same cycle replaces the earlier answer.
  const { data: row, error: rowErr } = await sb
    .from("dispute_bank_claims")
    .upsert(
      {
        dispute_id: pack.dispute_id,
        shop_id: pack.shop_id,
        response_cycle: cycle,
        claim_text: text || null,
        no_claim_shown: noClaimShown,
        file_path: filePath,
        file_name: file ? file.name.slice(0, 255) : null,
        file_size: file ? file.size : null,
        file_mime: file ? file.type || (fileExt ? BANK_CLAIM_FILE_TYPES[fileExt] : null) : null,
        text_source: textSource,
        // A new answer is analysed afresh (below).
        analysis: null,
        answered_at: answeredAt,
        answered_by: "merchant",
      },
      { onConflict: "dispute_id,response_cycle" },
    )
    .select("id")
    .single();
  if (rowErr || !row) {
    return NextResponse.json(
      {
        error: `Failed to record the bank's claim: ${rowErr?.message ?? "unknown error"}`,
        code: "PERSIST_FAILED",
      },
      { status: 500 },
    );
  }

  await clearBankClaimNeeded(sb, pack.dispute_id as string);

  // Read what the claim disputes BEFORE the rebuild is queued, so the next
  // letter and checklist follow it (lib/disputes/bankClaimAnalysis.ts). A
  // failed analysis is not fatal: the builders retry it lazily.
  const analysis = text
    ? await ensureBankClaimAnalysis(sb, pack.dispute_id as string, cycle).catch(() => null)
    : null;

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: auditActor.actorType,
    actorId: auditActor.actorId,
    eventType: "bank_claim_recorded",
    // The claim text and file live on the dispute_bank_claims row, not here.
    eventPayload: {
      bankClaimId: row.id,
      cycle,
      noClaimShown,
      textLength: text.length,
      file: file ? { ext: fileExt, size: file.size, textSource, extractError: extractError ?? null } : null,
      analysis: analysis
        ? {
            reason: analysis.reason,
            authorizationDisputed: analysis.authorizationDisputed,
            returnOrRefundRequested: analysis.returnOrRefundRequested,
          }
        : null,
    },
  });

  await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
  });

  return NextResponse.json(
    { ok: true, bankClaimId: row.id, textRead: file ? text.length > 0 : undefined },
    { status: 201 },
  );
}

/**
 * DELETE /api/packs/:packId/bank-claim — withdraw the claim saved for the
 * dispute's current response cycle ("Cancel" on the collapsed card, Claude
 * Design "Bank Claim Card.dc.html"). The task comes back, filing is held
 * again, and the letter is rebuilt without the claim. The stored file is
 * kept (audit); only the answer row goes.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const auditActor = await resolveAuditActor(req);
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (!pack?.dispute_id) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }
  const { data: dispute } = await sb
    .from("disputes")
    .select(`submission_state, ${BANK_CLAIM_DISPUTE_COLUMNS}`)
    .eq("id", pack.dispute_id)
    .single();
  if (dispute?.submission_state === "submitted_confirmed") {
    return NextResponse.json({ error: "WINDOW_CLOSED", code: "WINDOW_CLOSED" }, { status: 409 });
  }
  const cycle = (dispute?.response_cycle as number | null) ?? 1;
  const { error } = await sb
    .from("dispute_bank_claims")
    .delete()
    .eq("dispute_id", pack.dispute_id)
    .eq("response_cycle", cycle);
  if (error) {
    return NextResponse.json({ error: error.message, code: "DELETE_FAILED" }, { status: 500 });
  }

  const trigger = dispute ? bankClaimTrigger(bankClaimInputFromRow(dispute as Record<string, unknown>)) : null;
  if (trigger) await markBankClaimNeeded(sb, pack.dispute_id as string, { trigger, cycle });

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: auditActor.actorType,
    actorId: auditActor.actorId,
    eventType: "bank_claim_withdrawn",
    eventPayload: { cycle },
  });
  await sb.from("jobs").insert({ shop_id: pack.shop_id, job_type: "build_pack", entity_id: packId });
  return NextResponse.json({ ok: true });
}
