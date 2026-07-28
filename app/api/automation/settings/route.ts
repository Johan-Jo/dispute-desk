import { NextRequest, NextResponse } from "next/server";
import {
  getShopSettings,
  updateShopSettings,
} from "@/lib/automation/settings";
import {
  extractShopId,
  extractShopIdFromBody,
} from "@/lib/middleware/extractShopId";

/**
 * GET /api/automation/settings?shop_id=...
 * Returns automation settings for a shop.
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  try {
    const settings = await getShopSettings(shopId);
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/automation/settings
 * Body: { shop_id, ...fields }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { shop_id: _ignore, ...updates } = body;
  const shop_id = extractShopIdFromBody(req, body);

  if (!shop_id) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  // `auto_save_enabled` is DELIBERATELY absent (2026-07-28). It is now a
  // strict 1:1 mirror of the store-wide handling switch, written only by
  // `writeStoreAutomation` (lib/rules/storeAutomation.ts). Accepting it here
  // would let a client desync the mirror — /app/rules would say auto while
  // the gate said false, which is the exact class of drift the store-wide
  // redesign removed. Change the mode via PUT /api/automation/store instead.
  // Silently filtered rather than 400'd so an older cached client PATCHing
  // the full settings object still succeeds for the fields it does own.
  const allowed = [
    "auto_build_enabled",
    "auto_save_min_score",
    "enforce_no_blockers",
  ];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  try {
    const settings = await updateShopSettings(shop_id, filtered);
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
