import { NextRequest, NextResponse } from "next/server";
import {
  getPackNarrativeSettings,
  updatePackNarrativeSettings,
} from "@/lib/db/packs";

type Ctx = { params: Promise<{ packId: string }> };

/**
 * GET /api/packs/:packId/narrative-settings
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { packId } = await params;

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
