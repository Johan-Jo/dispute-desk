import { NextRequest, NextResponse } from "next/server";
import { installTemplate } from "@/lib/db/packs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/templates/:id/install
 *
 * Body: { shopId: string, overrides?: { name?: string } }
 *
 * Creates a new pack from the global template for the given shop.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;

  let body: { shopId?: string; overrides?: { name?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Embedded UI calls this without relying on reading httpOnly cookies in the browser.
  // The embedded middleware forwards the per-request shop id via `x-shop-id`.
  const shopId =
    body.shopId ??
    req.headers.get("x-shop-id") ??
    req.cookies.get("shopify_shop_id")?.value ??
    null;
  if (!shopId) {
    return NextResponse.json({ error: "shopId is required" }, { status: 400 });
  }

  const pack = await installTemplate(id, shopId, body.overrides);

  if (!pack) {
    return NextResponse.json(
      { error: "Failed to install template. Template may not exist." },
      { status: 500 }
    );
  }

  return NextResponse.json(pack, { status: 201 });
}
