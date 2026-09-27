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
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuditActor } from "@/lib/audit/resolveActor";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { BANK_CLAIM_MAX_TEXT, clearBankClaimNeeded } from "@/lib/disputes/bankClaim";

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

  const parsed = await parseJsonBody<BankClaimBody>(req);
  if (parsed instanceof NextResponse) return parsed;

  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const noClaimShown = parsed.noClaimShown === true;

  if (!text && !noClaimShown) {
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

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: auditActor.actorType,
    actorId: auditActor.actorId,
    eventType: "bank_claim_recorded",
    // The claim text lives on the evidence item, not in the audit row.
    eventPayload: {
      bankClaimId: row.id,
      cycle,
      noClaimShown,
      textLength: text.length,
    },
  });

  await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
  });

  return NextResponse.json({ ok: true, bankClaimId: row.id }, { status: 201 });
}
