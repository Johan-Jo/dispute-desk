import { NextRequest, NextResponse } from "next/server";
import {
  getPackNarrativeSettings,
  updatePackNarrativeSettings,
} from "@/lib/db/packs";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

type Ctx = { params: Promise<{ packId: string }> };

async function requirePackOwnership(
  req: NextRequest,
  packId: string,
): Promise<NextResponse | null> {
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
    .maybeSingle();
  if (!pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }
  return null;
}

/**
 * GET /api/packs/:packId/narrative-settings
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { packId } = await params;
  const denied = await requirePackOwnership(req, packId);
  if (denied) return denied;

  const settings = await getPackNarrativeSettings(packId);
  if (!settings) {
    return NextResponse.json(
      { error: "Narrative settings not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(settings);
}

/**
 * PATCH /api/packs/:packId/narrative-settings
 *
 * Body: partial PackNarrativeSettings (omit pack_id).
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { packId } = await params;
  const denied = await requirePackOwnership(req, packId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowed = [
    "store_locale",
    "include_english",
    "include_store_language",
    "attach_translated_customer_messages",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const result = await updatePackNarrativeSettings(packId, updates);

  if (!result) {
    return NextResponse.json(
      { error: "Failed to update narrative settings" },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
