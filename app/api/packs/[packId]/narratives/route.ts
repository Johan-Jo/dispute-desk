import { NextRequest, NextResponse } from "next/server";
import { getPackNarratives, upsertPackNarrative } from "@/lib/db/packs";
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
 * GET /api/packs/:packId/narratives
 *
 * Returns all narrative drafts for this pack.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { packId } = await params;
  const denied = await requirePackOwnership(req, packId);
  if (denied) return denied;

  const narratives = await getPackNarratives(packId);
  return NextResponse.json({ narratives });
}

/**
 * PUT /api/packs/:packId/narratives
 *
 * Body: { locale: string, content: string }
 *
 * Upserts a narrative draft for the given locale.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { packId } = await params;
  const denied = await requirePackOwnership(req, packId);
  if (denied) return denied;

  let body: { locale?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.locale || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "locale and content are required" },
      { status: 400 }
    );
  }

  const result = await upsertPackNarrative(packId, body.locale, body.content);

  if (!result) {
    return NextResponse.json(
      { error: "Failed to save narrative" },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
