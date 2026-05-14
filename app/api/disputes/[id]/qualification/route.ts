import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/disputes/:id/qualification
 *
 * Returns the LSE-1 CE 3.0 qualification verdict for a dispute.
 * Verdict structure mirrors the dispute_qualifications row but is
 * shaped for direct UI consumption (camelCase keys, machine codes
 * left as-is so the merchant UI can map to i18n).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: disputeId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const sb = getServiceClient();

  // Verify the dispute belongs to this shop.
  const { data: dispute, error: dErr } = await sb
    .from("disputes")
    .select("id, dispute_gid, network_reason_code, network_reason_code_confidence")
    .eq("id", disputeId)
    .eq("shop_id", shopId)
    .single();
  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const { data: row, error: qErr } = await sb
    .from("dispute_qualifications")
    .select("*")
    .eq("shop_id", shopId)
    .eq("shopify_dispute_id", dispute.dispute_gid)
    .maybeSingle();

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  if (!row) {
    // No verdict yet — usually means the pack build hasn't run for this
    // dispute. Return a `pending` sentinel so the UI can render an
    // appropriate placeholder.
    return NextResponse.json({
      verdict: null,
      pending: true,
      networkReasonCode: dispute.network_reason_code,
      networkReasonCodeConfidence: dispute.network_reason_code_confidence,
    });
  }

  return NextResponse.json({
    pending: false,
    verdict: {
      status: row.ce30_status,
      branch: row.ce30_branch,
      program: row.program_evaluated,
      cardNetwork: row.card_network,
      reasonCode: row.reason_code,
      matchPoints: row.ce30_match_points ?? [],
      hasAnchor: row.ce30_has_anchor,
      qualifyingPriors: row.ce30_qualifying_priors ?? [],
      autoQualificationVia: row.ce30_auto_qualification_via,
      autoQualificationFeeApplies: row.auto_qualification_fee_applies,
      confidence: row.confidence,
      confidenceReasons: row.confidence_reasons ?? [],
      missingEvidence: row.missing_evidence ?? [],
      evaluatedAt: row.evaluated_at,
    },
    networkReasonCode: dispute.network_reason_code,
    networkReasonCodeConfidence: dispute.network_reason_code_confidence,
  });
}
