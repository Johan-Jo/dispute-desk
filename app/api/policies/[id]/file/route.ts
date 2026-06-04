import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops } from "@/lib/portal/activeShop";

export const runtime = "nodejs";

/**
 * GET /api/policies/:id/file
 *
 * Streams the policy file inline. Bytes are fetched server-side from
 * the `policy-uploads` Supabase Storage bucket using the service role
 * and forwarded to the client through this route.
 *
 * The browser only ever sees `disputedesk.app/api/policies/:id/file` —
 * never the raw `supabase.co` host, never a 1-year signing token.
 *
 * Authorization: requires a portal session whose linked shops include
 * the snapshot's shop_id. Mirrors the auth model in `DELETE
 * /api/policies` so all policy I/O lives behind the same boundary.
 *
 * Prior versions of the Policies page consumed
 * `policy_snapshots.url`, a 1-year Supabase signed URL minted at
 * upload time. That URL + token reached the browser via
 * `GET /api/policies` and any logs that captured it. This route is
 * the replacement — see also commit 4dcca13 (the dispute PDF
 * equivalent) and the migration that added `policy_snapshots.storage_path`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getPortalUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const sb = getServiceClient();

  const { data: snapshot, error } = await sb
    .from("policy_snapshots")
    .select("shop_id, storage_path, policy_type")
    .eq("id", id)
    .single();

  if (error || !snapshot) {
    return NextResponse.json(
      { error: "Policy not found", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const shops = await getLinkedShops(user.id);
  const hasAccess = shops.some((s) => s.shop_id === snapshot.shop_id);
  if (!hasAccess) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  if (!snapshot.storage_path) {
    return NextResponse.json(
      {
        error:
          "Policy file is not available. Re-upload the policy to refresh it.",
        code: "STORAGE_PATH_MISSING",
      },
      { status: 410 },
    );
  }

  const { data: blob, error: downloadErr } = await sb.storage
    .from("policy-uploads")
    .download(snapshot.storage_path);
  if (downloadErr || !blob) {
    // supabase-js embeds the internal storage URL in `downloadErr.message`;
    // never surface it to the merchant. Log server-side, return generic copy.
    console.error("[policy-file] storage download failed", {
      storagePath: snapshot.storage_path,
      message: downloadErr?.message,
    });
    return NextResponse.json(
      {
        error: "This file is no longer available.",
        code: "FILE_UNAVAILABLE",
      },
      { status: 404 },
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  const pathSegments = snapshot.storage_path.split("/");
  const filename =
    pathSegments[pathSegments.length - 1] || `${snapshot.policy_type}.bin`;

  const contentType = blob.type || guessContentType(filename);

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(arrayBuffer.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=60, must-revalidate",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain; charset=utf-8";
    case "md":
      return "text/markdown; charset=utf-8";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}
