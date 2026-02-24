import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/packs/:packId/download
 *
 * Returns a time-limited signed URL (1 hour) for the pack PDF.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  const { data: pack, error } = await db
    .from("evidence_packs")
    .select("pdf_path")
    .eq("id", packId)
    .single();

  if (error || !pack?.pdf_path) {
    return NextResponse.json(
      { error: "PDF not available. Generate or render PDF first." },
      { status: 404 }
    );
  }

  const { data: signedUrl, error: signErr } = await db.storage
    .from("evidence-packs")
    .createSignedUrl(pack.pdf_path, 3600);

  if (signErr || !signedUrl) {
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: signedUrl.signedUrl, expiresIn: 3600 });
}
