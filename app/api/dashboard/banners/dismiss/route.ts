/**
 * POST /api/dashboard/banners/dismiss
 *
 * Marks a banner as dismissed for the current shop. Replaces the
 * per-device localStorage flags previously used by the embedded
 * dashboard's dismissible banners (which surfaced the banner again
 * on every other device the merchant signed in from).
 *
 * Body: { bannerId: string }
 *
 * Writes `shops.dismissed_banners[bannerId] = now()`. Idempotent —
 * re-dismissing refreshes the timestamp without erroring. Unknown
 * bannerIds are stored as-is; the dashboard only reads keys it
 * knows about, so a stray write is harmless.
 *
 * Currently-known banner IDs:
 *   scope_upgrade — re-OAuth nudge for read_all_orders
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

// Allowlist of banner IDs the API will accept. Keeps the column
// clean — a typo or malicious client can't write arbitrary keys.
const KNOWN_BANNERS = new Set<string>(["scope_upgrade"]);

export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }
  let body: { bannerId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const bannerId = (body.bannerId ?? "").trim();
  if (!bannerId) {
    return NextResponse.json({ error: "bannerId required" }, { status: 400 });
  }
  if (!KNOWN_BANNERS.has(bannerId)) {
    return NextResponse.json(
      { error: `unknown bannerId: ${bannerId}` },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  // Read-modify-write because PostgREST doesn't expose a clean
  // "merge into JSONB at key" primitive. Concurrent dismissals on
  // the same row are a non-issue (last write wins; both wrote the
  // same key with near-identical timestamps).
  const { data: shop } = await sb
    .from("shops")
    .select("dismissed_banners")
    .eq("id", shopId)
    .single();
  const current = (shop?.dismissed_banners as Record<string, string> | null) ?? {};
  current[bannerId] = new Date().toISOString();

  const { error } = await sb
    .from("shops")
    .update({ dismissed_banners: current })
    .eq("id", shopId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, bannerId, dismissedAt: current[bannerId] });
}
