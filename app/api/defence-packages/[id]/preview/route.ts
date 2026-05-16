/**
 * GET /api/defence-packages/:id/preview
 *
 * Generates a short-lived signed Supabase Storage URL for the package
 * PDF and 302-redirects to it. The embedded UI links to this endpoint
 * with `target="_blank"` so the browser opens the PDF in a new tab in
 * a true user-gesture context. TTL is 600s.
 *
 * Previously this route returned JSON `{ url }` and the client did
 * `fetch → window.open(url, "_blank")` — that pattern is blocked by
 * Shopify Admin's iframe sandbox (the window.open fires from an async
 * callback, losing user-gesture context). The redirect path moves the
 * URL fetch off the client entirely, so clicking the link is the user
 * gesture and the browser handles the rest.
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
  return NextResponse.redirect(signed.signedUrl, 302);
}
