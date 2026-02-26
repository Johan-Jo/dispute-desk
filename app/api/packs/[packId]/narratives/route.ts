import { NextRequest, NextResponse } from "next/server";
import { getPackNarratives, upsertPackNarrative } from "@/lib/db/packs";

type Ctx = { params: Promise<{ packId: string }> };

/**
 * GET /api/packs/:packId/narratives
 *
 * Returns all narrative drafts for this pack.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { packId } = await params;

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
