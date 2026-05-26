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

  // Fetch only the two rows the client actually consumes:
  //   - `latest`:     highest-version row (drives draft preview + actions).
  //   - `bankFacing`: the row in status='submitted' (drives the "Saved to
  //                   Shopify" banner). At most one per pack — submitted
  //                   is terminal per the defence_packages immutability
  //                   trigger, and save_to_shopify only flips one row.
  //
  // Previously this route selected every version with `narrative_json`
  // + `facts_json` included — a regenerated dispute at v5 paid for 5×
  // full LLM narratives + per-fact rows over the wire, only to use
  // `data[0]` and `data.find(status='submitted')`. Two narrow queries
  // hit the existing `(source_pack_id, version desc)` and `(status)`
  // indexes and return a single row each, dropping payload by N×.
  const SELECT_COLS =
    "id, version, status, package_mode, generated_at, generated_by, pdf_path, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, failure_code, failure_reason, submitted_at, narrative_json, facts_json";

  const [latestRes, bankFacingRes] = await Promise.all([
    sb
      .from("defence_packages")
      .select(SELECT_COLS)
      .eq("source_pack_id", packId)
      .eq("shop_id", shopId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("defence_packages")
      .select(SELECT_COLS)
      .eq("source_pack_id", packId)
      .eq("shop_id", shopId)
      .eq("status", "submitted")
      .maybeSingle(),
  ]);

  return NextResponse.json({
    latest: latestRes.data ?? null,
    bankFacing: bankFacingRes.data ?? null,
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
