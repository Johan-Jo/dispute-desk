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

  // `auto_save_enabled` is deliberately NOT writable here.
  //
  // It is a mirror of the store-wide switch, owned by
  // `writeStoreAutomation` (see lib/rules/storeAutomation.ts — "DO NOT add a
  // second surface that writes either of these"). Until 2026-07-28 this route
  // accepted it and the /app/settings page rendered a checkbox bound to it, so
  // a merchant could set the flag false while /app/rules still displayed
  // "Auto-pilot" — the switch said automate, the gate silently blocked every
  // save. Two controls, one field, no way to tell which one won.
  //
  // Change the store-wide mode through PUT /api/automation/store instead.
  // `tests/unit/singleAutoSaveWriter.test.ts` fails the build if this comes
  // back.
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
