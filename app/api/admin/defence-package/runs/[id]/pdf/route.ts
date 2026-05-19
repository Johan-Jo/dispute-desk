/**
 * GET /api/admin/defence-package/runs/:id/pdf
 *
 * Streams the PDF bytes for the package attached to this LLM run.
 * Authorized by the admin session.
 *
 * Replaces the older pattern where the run-detail route returned a raw
 * Supabase signed URL that the admin page rendered as a clickable
 * `<a href>`. The URL + signing token ended up in the browser address
 * bar, browser history, and any referrer header that downstream
 * services received. This route streams bytes through the origin so
 * the supabase.co host + token never leave the server.
 *
 * Mirrors the proxy pattern in `app/api/packs/[packId]/download/route.ts`
 * and `app/api/policies/[id]/file/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const sb = getServiceClient();

  const { data: run, error: runErr } = await sb
    .from("defence_package_runs")
    .select("package_id")
    .eq("id", id)
    .single();
  if (runErr || !run?.package_id) {
    return NextResponse.json(
      { error: "Run or package not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const { data: pkg } = await sb
    .from("defence_packages")
    .select("pdf_path, pdf_storage_bucket")
    .eq("id", run.package_id)
    .single();

  if (!pkg?.pdf_path) {
    return NextResponse.json(
      { error: "PDF not available for this package", code: "PDF_MISSING" },
      { status: 404 },
    );
  }

  const bucket = (pkg.pdf_storage_bucket as string | null) ?? "evidence-packs";

  const { data: blob, error: downloadErr } = await sb.storage
    .from(bucket)
    .download(pkg.pdf_path as string);
  if (downloadErr || !blob) {
    return NextResponse.json(
      {
        error: `PDF download failed: ${downloadErr?.message ?? "unknown"}`,
        code: "DOWNLOAD_FAILED",
      },
      { status: 500 },
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  const pathSegments = (pkg.pdf_path as string).split("/");
  const filename =
    pathSegments[pathSegments.length - 1] || `defence-package-${id}.pdf`;

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
