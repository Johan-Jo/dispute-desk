import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/http/parseJsonBody";
import { logAuditEvent } from "@/lib/audit/logEvent";
import type { RebuttalSection } from "@/lib/argument/types";

export const runtime = "nodejs";

/**
 * PUT /api/disputes/:id/rebuttal
 *
 * Save merchant-edited rebuttal sections.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: disputeId } = await params;
  const sb = getServiceClient();

  const parsed = await parseJsonBody<{
    packId: string;
    sections: RebuttalSection[];
  }>(req);
  if (parsed instanceof NextResponse) return parsed;
  const { packId, sections } = parsed;

  if (!packId || !sections) {
    return NextResponse.json(
      { error: "packId and sections are required" },
      { status: 400 },
    );
  }

  // Verify pack exists
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, shop_id")
    .eq("id", packId)
    .single();

  if (!pack) {
    return NextResponse.json(
      { error: "Pack not found" },
      { status: 404 },
    );
  }

  // Upsert rebuttal draft
  const { error } = await sb.from("rebuttal_drafts").upsert(
    {
      pack_id: packId,
      locale: "en-US",
      sections,
      source: "MERCHANT_EDITED",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pack_id,locale" },
  );

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId,
    packId,
    actorType: "merchant",
    eventType: "admin_override",
    eventPayload: {
      action: "rebuttal_edited",
      sectionCount: sections.length,
    },
  });

  return NextResponse.json({ ok: true });
}
