import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

/**
 * GET /api/packs/:packId/download
 *
 * Streams the pack PDF inline. The PDF bytes are fetched server-side
 * from Supabase Storage using the service role and forwarded to the
 * client through this route. The browser only ever sees
 * `disputedesk.app/api/packs/:packId/download` — never the raw
 * Supabase URL, never a signing token.
 *
 * Mirrors the same proxy pattern as
 * `app/api/defence-packages/[id]/preview/route.ts`. Prior versions
 * of this route returned `{ url, expiresIn }` JSON containing a
 * Supabase signed URL; the client then did `window.open(url)`,
 * exposing the supabase.co host + signing token in the address bar
 * and any referrer header. That pattern is now retired.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const db = getServiceClient();

  const { data: pack, error } = await db
    .from("evidence_packs")
    .select("pdf_path")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();

  if (error || !pack?.pdf_path) {
    return NextResponse.json(
      { error: "PDF not available. Generate or render PDF first." },
      { status: 404 }
    );
  }

  const { data: blob, error: downloadErr } = await db.storage
    .from("evidence-packs")
    .download(pack.pdf_path);
  if (downloadErr || !blob) {
    return NextResponse.json(
      { error: `PDF download failed: ${downloadErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  const pathSegments = (pack.pdf_path as string).split("/");
  const filename =
    pathSegments[pathSegments.length - 1] || `pack-${packId}.pdf`;

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(arrayBuffer.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=60, must-revalidate",
      "Referrer-Policy": "no-referrer",
    },
  });
}
