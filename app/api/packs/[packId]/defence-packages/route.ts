/**
 * GET /api/packs/:packId/defence-packages
 *
 * Lists defence packages for a pack and returns the latest. Used by the
 * embedded ReviewSubmitTab to render the CompleteDefencePackageCard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
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
    .select("id")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });

  const { data } = await sb
    .from("defence_packages")
    .select(
      "id, version, status, package_mode, generated_at, generated_by, pdf_path, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, failure_code, failure_reason, submitted_at, narrative_json, facts_json",
    )
    .eq("source_pack_id", packId)
    .eq("shop_id", shopId)
    .order("version", { ascending: false });

  // `bankFacing` is the row whose PDF the bank actually has — the one
  // with `status = "submitted"`. There is at most one per pack (the
  // finalize route supersedes the prior `final` row but never touches
  // `submitted` rows, and save_to_shopify flips the row to `submitted`
  // immutably). When `latest.id !== bankFacing.id`, a newer draft has
  // been generated but not yet sent — the embedded card must render
  // `bankFacing` under the "Submitted to bank" banner to avoid showing
  // body copy that the bank does not have.
  const bankFacing =
    (data ?? []).find((r) => r.status === "submitted") ?? null;

  return NextResponse.json({
    latest: data?.[0] ?? null,
    bankFacing,
    all: data ?? [],
    // Surfaces "is regenerating worthwhile?" for the embedded card.
    // When the submitted row's prompt_version lags behind the current
    // code, a fresh draft will pick up new prompt guidance / module
    // updates. Pairs with `status === 'stale'` (evidence drifted) on
    // the client to gate the Regenerate overflow on a submitted row.
    serverState: {
      currentPromptVersion: CURRENT_PROMPT_VERSION,
    },
  });
}
