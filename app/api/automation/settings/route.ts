import { NextRequest, NextResponse } from "next/server";
import {
  getShopSettings,
  updateShopSettings,
} from "@/lib/automation/settings";

/**
 * GET /api/automation/settings?shop_id=...
 * Returns automation settings for a shop.
 */
export async function GET(req: NextRequest) {
  const shopId =
    req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
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
  const { shop_id: bodyShopId, ...updates } = body;
  const shop_id = bodyShopId ?? req.headers.get("x-shop-id");

  if (!shop_id) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  const allowed = [
    "auto_build_enabled",
    "auto_save_enabled",
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
