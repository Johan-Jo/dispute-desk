/**
 * GET /api/defence-packages/:id/preview
 *
 * Streams the defence-package PDF inline. The PDF bytes are fetched
 * server-side from Supabase Storage using the service role and
 * forwarded to the client via this route. The browser only ever sees
 * `disputedesk.app/api/defence-packages/:id/preview` — never the raw
 * Supabase URL, never a signing token.
 *
 * Why proxy and not 302 to a signed URL:
 *   - A redirect would expose `sddzuglxdnkhcnjmcpbj.supabase.co` plus
 *     a JWT-style signing token in the browser address bar / referrer
 *     header. Even short-TTL tokens are still credentials and must
 *     never leak.
 *   - Streaming through our origin keeps the token bound to the
 *     server-side fetch.
 *
 * The previous redirect implementation also used `target="_blank"`
 * + a true user gesture (a link click) to satisfy Shopify Admin's
 * iframe sandbox. The proxy preserves that: the merchant still
 * clicks the link, the browser still opens a new tab, the response
 * just happens to be the PDF bytes instead of a redirect.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

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
  // Download the bytes server-side. `download()` uses the service-role
  // key from the server's `sb` client; the token never enters the
  // response we send to the merchant.
  const { data: blob, error: downloadErr } = await sb.storage
    .from(bucket)
    .download(row.pdf_path as string);
  if (downloadErr || !blob) {
    // Never echo `downloadErr.message` to the client: supabase-js puts the
    // full internal storage object URL (project ref + path) in the error
    // message, and that URL must never reach a merchant. Log it server-side
    // for diagnostics and return a generic, safe message.
    console.error("[defence-preview] storage download failed", {
      id,
      shopId,
      bucket,
      pdfPath: row.pdf_path,
      message: downloadErr?.message,
    });
    return NextResponse.json(
      {
        error: "This PDF is no longer available.",
        code: "PDF_UNAVAILABLE",
      },
      { status: 404 },
    );
  }

  const arrayBuffer = await blob.arrayBuffer();

  // Inline disposition so the browser renders the PDF in the new tab
  // rather than downloading it. Filename mirrors the dispute id
  // segment of the storage path for merchant clarity.
  const pathSegments = (row.pdf_path as string).split("/");
  const filename =
    pathSegments[pathSegments.length - 1] || `defence-${id}.pdf`;

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(arrayBuffer.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      // Short-lived browser cache only — clear when the PDF rotates.
      "Cache-Control": "private, max-age=60, must-revalidate",
      // Defence in depth: never let an embedded PDF preview leak a
      // referrer to a third party.
      "Referrer-Policy": "no-referrer",
    },
  });
}
