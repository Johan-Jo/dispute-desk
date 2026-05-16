/**
 * GET /api/defence-packages/:id/preview
 *
 * Returns a short-lived signed Supabase Storage URL for the package PDF.
 * The embedded UI uses this URL inside a Polaris Modal iframe to render
 * the PDF inline. TTL is 600s — enough for the user to preview, not long
 * enough to share.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

const PREVIEW_TTL_SECONDS = 600;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();
  const { data: row } = await sb
    .from("defence_packages")
    .select("id, pdf_path, pdf_storage_bucket")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (!row?.pdf_path) {
    return NextResponse.json({ error: "PDF not available" }, { status: 404 });
  }

  const bucket = (row.pdf_storage_bucket as string) ?? "evidence-packs";
  const { data: signed, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(row.pdf_path as string, PREVIEW_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Signed URL generation failed: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ url: signed.signedUrl, expiresIn: PREVIEW_TTL_SECONDS });
}
